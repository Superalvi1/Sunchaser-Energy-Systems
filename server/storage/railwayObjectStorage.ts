import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export type RailwayObjectNamespace = "customer-documents" | "quote-assets";

type StorageConfig = {
  endpoint: URL;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  proxySecret: string;
};

function readEnv(env: NodeJS.ProcessEnv, preferred: string, fallback: string): string {
  return String(env[preferred] || env[fallback] || "").trim();
}

export function resolveRailwayObjectStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageConfig | null {
  const endpointRaw = readEnv(env, "RAILWAY_S3_ENDPOINT", "ENDPOINT");
  const bucket = readEnv(env, "RAILWAY_S3_BUCKET", "BUCKET");
  const accessKeyId = readEnv(env, "RAILWAY_S3_ACCESS_KEY_ID", "ACCESS_KEY_ID");
  const secretAccessKey = readEnv(env, "RAILWAY_S3_SECRET_ACCESS_KEY", "SECRET_ACCESS_KEY");
  const region = readEnv(env, "RAILWAY_S3_REGION", "REGION") || "auto";
  const proxySecret = String(env.RAILWAY_OBJECT_PROXY_SECRET || "").trim();
  if (!endpointRaw || !bucket || !accessKeyId || !secretAccessKey || !proxySecret) return null;
  let endpoint: URL;
  try {
    endpoint = new URL(endpointRaw);
  } catch {
    throw new Error("RAILWAY_S3_ENDPOINT/ENDPOINT must be a valid URL.");
  }
  if (endpoint.protocol !== "https:") {
    throw new Error("Railway object storage endpoint must use HTTPS.");
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey, region, proxySecret };
}

export function isRailwayObjectStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveRailwayObjectStorageConfig(env) !== null;
}

function normalizeObjectKey(namespace: RailwayObjectNamespace, key: string): string {
  const raw = String(key || "").trim().replace(/^\/+/, "");
  if (!raw || raw.length > 1024 || raw.includes("..") || raw.includes("\\")) {
    throw new Error("Invalid object key.");
  }
  return `${namespace}/${raw}`;
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function encodePath(key: string): string {
  return "/" + key.split("/").map(rfc3986).join("/");
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secret: string, date: string, region: string): Buffer {
  const kDate = hmac("AWS4" + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function amzTimestamp(now = new Date()): { full: string; short: string } {
  const full = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { full, short: full.slice(0, 8) };
}

async function signedBucketRequest(
  method: "GET" | "PUT" | "DELETE",
  namespace: RailwayObjectNamespace,
  objectKey: string,
  options: { body?: Buffer; contentType?: string } = {},
): Promise<Response> {
  const config = resolveRailwayObjectStorageConfig();
  if (!config) throw new Error("Railway object storage is not configured.");

  const fullKey = normalizeObjectKey(namespace, objectKey);
  const endpointHost = config.endpoint.host;
  const host = `${config.bucket}.${endpointHost}`;
  const canonicalUri = encodePath(fullKey);
  const url = `${config.endpoint.protocol}//${host}${canonicalUri}`;
  const body = options.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const { full: xAmzDate, short: date } = amzTimestamp();

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${xAmzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    xAmzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(config.secretAccessKey, date, config.region),
  ).update(stringToSign).digest("hex");

  const headers: Record<string, string> = {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": xAmzDate,
  };
  if (options.contentType) headers["content-type"] = options.contentType;

  return fetch(url, {
    method,
    headers,
    body: method === "PUT" ? body : undefined,
  });
}

export async function putRailwayObject(
  namespace: RailwayObjectNamespace,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const res = await signedBucketRequest("PUT", namespace, key, { body, contentType });
  if (!res.ok) {
    throw new Error(`Railway object upload failed (HTTP ${res.status}).`);
  }
}

export async function deleteRailwayObject(
  namespace: RailwayObjectNamespace,
  key: string,
): Promise<void> {
  const res = await signedBucketRequest("DELETE", namespace, key);
  if (!res.ok && res.status !== 404) {
    throw new Error(`Railway object delete failed (HTTP ${res.status}).`);
  }
}

export async function getRailwayObject(
  namespace: RailwayObjectNamespace,
  key: string,
): Promise<{ body: Buffer; contentType: string; etag: string | null } | null> {
  const res = await signedBucketRequest("GET", namespace, key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Railway object read failed (HTTP ${res.status}).`);
  return {
    body: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "application/octet-stream",
    etag: res.headers.get("etag"),
  };
}

function proxySignature(
  namespace: RailwayObjectNamespace,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = String(env.RAILWAY_OBJECT_PROXY_SECRET || "").trim();
  if (!secret) throw new Error("RAILWAY_OBJECT_PROXY_SECRET is not configured.");
  return createHmac("sha256", secret)
    .update(`${namespace}\n${key}`)
    .digest("hex");
}

export function buildRailwayObjectProxyUrl(
  namespace: RailwayObjectNamespace,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const normalized = String(key || "").trim().replace(/^\/+/, "");
  normalizeObjectKey(namespace, normalized);
  const encoded = Buffer.from(normalized, "utf8").toString("base64url");
  const sig = proxySignature(namespace, normalized, env);
  const relative = `/api/storage/object/${namespace}/${encoded}?sig=${sig}`;
  const explicit = String(env.APP_PUBLIC_URL || env.API_BASE_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit + relative;
  const railwayDomain = String(env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  return railwayDomain ? `https://${railwayDomain}${relative}` : relative;
}

export function verifyRailwayObjectProxySignature(
  namespaceRaw: string,
  encodedKey: string,
  signature: string,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; namespace: RailwayObjectNamespace; key: string } | { ok: false } {
  if (namespaceRaw !== "customer-documents" && namespaceRaw !== "quote-assets") {
    return { ok: false };
  }
  let key = "";
  try {
    key = Buffer.from(String(encodedKey || ""), "base64url").toString("utf8");
    normalizeObjectKey(namespaceRaw, key);
  } catch {
    return { ok: false };
  }
  const supplied = String(signature || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return { ok: false };
  const expected = proxySignature(namespaceRaw, key, env);
  const a = Buffer.from(supplied, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, namespace: namespaceRaw, key };
}

export function rewriteLegacyStorageUrl(
  url: string | null | undefined,
  storagePath?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const original = String(url || "").trim();
  if (!resolveRailwayObjectStorageConfig(env)) return original;
  if (original.includes("/api/storage/object/")) return original;

  const match = original.match(
    /\/storage\/v1\/object\/public\/(customer-documents|quote-assets)\/(.+)$/i,
  );
  const namespace = (match?.[1] || "") as RailwayObjectNamespace;
  const matchedKey = match?.[2] ? decodeURIComponent(match[2]) : "";
  const fallbackPath = String(storagePath || "").trim().replace(/^\/+/, "");
  if (namespace) {
    return buildRailwayObjectProxyUrl(namespace, fallbackPath || matchedKey, env);
  }
  if (fallbackPath && original.includes("customer-documents")) {
    return buildRailwayObjectProxyUrl("customer-documents", fallbackPath, env);
  }
  return original;
}
