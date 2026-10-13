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
  // Only whole "." / ".." segments are dangerous: fetch() collapses them after the request was signed
  // (SignatureDoesNotMatch) and they are the only traversal form. File names such as "scan..pdf" are valid keys.
  if (!raw || raw.length > 1024 || raw.includes("\\") || raw.split("/").some((part) => part === "." || part === "..")) {
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
  options: { body?: Buffer; contentType?: string; ifMatch?: string; ifNoneMatch?: string } = {},
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
  if (options.ifMatch) headers["if-match"] = options.ifMatch;
  if (options.ifNoneMatch) headers["if-none-match"] = options.ifNoneMatch;

  const timeoutMs = Number(process.env.RAILWAY_S3_TIMEOUT_MS) > 0 ? Number(process.env.RAILWAY_S3_TIMEOUT_MS) : 60_000;
  try {
    return await fetch(url, {
      method,
      headers,
      body: method === "PUT" ? body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Say why (timeout, refused, DNS, TLS) without echoing hosts, keys or request details.
    const e = err as { name?: string; cause?: { code?: string } };
    const reason = e?.name === "TimeoutError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : e?.cause?.code || "network error";
    throw new Error(`Railway object storage unreachable (${reason}).`);
  }
}

/** The S3 error code (e.g. SignatureDoesNotMatch, NoSuchBucket) from an XML error body; never the message text. */
async function s3ErrorCode(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, 4096);
    return /<Code>([A-Za-z0-9]{1,64})<\/Code>/.exec(text)?.[1] ?? "";
  } catch {
    return "";
  }
}

async function failure(res: Response, action: string, knownCode?: string): Promise<Error> {
  const code = knownCode ?? (await s3ErrorCode(res));
  return new Error(`Railway object ${action} failed (HTTP ${res.status}${code ? ` ${code}` : ""}).`);
}

export async function putRailwayObject(
  namespace: RailwayObjectNamespace,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const res = await signedBucketRequest("PUT", namespace, key, { body, contentType });
  if (!res.ok) throw await failure(res, "upload");
}

export async function deleteRailwayObject(
  namespace: RailwayObjectNamespace,
  key: string,
): Promise<void> {
  const res = await signedBucketRequest("DELETE", namespace, key);
  if (res.ok) return;
  // A missing key is success; a missing BUCKET (wrong configuration) must not look like a completed delete.
  const code = await s3ErrorCode(res);
  if (res.status === 404 && code !== "NoSuchBucket") return;
  throw await failure(res, "delete", code);
}

/** Atomic metadata update; false means another writer changed the object. */
export async function putRailwayObjectConditional(namespace: RailwayObjectNamespace, key: string, body: Buffer, contentType: string, etag: string | null): Promise<boolean> {
  const res = await signedBucketRequest("PUT", namespace, key, { body, contentType, ...(etag ? { ifMatch: etag } : { ifNoneMatch: "*" }) });
  if (res.status === 412 || res.status === 409) return false;
  if (!res.ok) throw await failure(res, "update");
  return true;
}

export async function getRailwayObject(
  namespace: RailwayObjectNamespace,
  key: string,
): Promise<{ body: Buffer; contentType: string; etag: string | null } | null> {
  const res = await signedBucketRequest("GET", namespace, key);
  if (res.status === 404) {
    const code = await s3ErrorCode(res);
    if (code !== "NoSuchBucket") return null;
    throw await failure(res, "read", code); // wrong bucket name is a configuration fault, not "file not found"
  }
  if (!res.ok) throw await failure(res, "read");
  return {
    body: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "application/octet-stream",
    etag: res.headers.get("etag"),
  };
}

function hmacProxySignature(secret: string, namespace: RailwayObjectNamespace, key: string): string {
  return createHmac("sha256", secret).update(`${namespace}\n${key}`).digest("hex");
}

function proxySignature(
  namespace: RailwayObjectNamespace,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = String(env.RAILWAY_OBJECT_PROXY_SECRET || "").trim();
  if (!secret) throw new Error("RAILWAY_OBJECT_PROXY_SECRET is not configured.");
  return hmacProxySignature(secret, namespace, key);
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
  // During a secret rotation RAILWAY_OBJECT_PROXY_SECRET_PREVIOUS keeps links issued before the change working.
  // Leave it unset to revoke every earlier link at once (e.g. after a leak). Every candidate is compared, no early exit.
  const secrets = [env.RAILWAY_OBJECT_PROXY_SECRET, env.RAILWAY_OBJECT_PROXY_SECRET_PREVIOUS]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!secrets.length) throw new Error("RAILWAY_OBJECT_PROXY_SECRET is not configured.");
  const a = Buffer.from(supplied, "hex");
  let valid = false;
  for (const secret of secrets) {
    const b = Buffer.from(hmacProxySignature(secret, namespaceRaw, key), "hex");
    if (a.length === b.length && timingSafeEqual(a, b)) valid = true;
  }
  if (!valid) return { ok: false };
  return { ok: true, namespace: namespaceRaw, key };
}

/**
 * A NEW customer_documents row may only point at that customer's own folder or at a Smart Quote PDF archive.
 * Without this a staff-supplied storage_path could name another customer's (or an internal) object.
 */
export function isStoragePathForCustomer(customerId: string | null | undefined, storagePath: string): boolean {
  const owner = String(customerId || "").trim();
  const key = String(storagePath || "").trim().replace(/^\/+/, "");
  return Boolean(owner) && (key.startsWith(`${owner}/`) || key.startsWith("smart-quotes/"));
}

/** Objects the app keeps for itself (sales-agent settings, pending conversations). Never signed for a document row. */
const INTERNAL_KEY_PREFIXES = ["whatsapp-agent/"];

/**
 * Turns a stored document URL into a currently valid signed proxy link. It never throws: a malformed legacy row
 * (bad %-escape, ".." in a name, misconfigured endpoint) keeps its original URL instead of failing the whole list.
 */
export function rewriteLegacyStorageUrl(
  url: string | null | undefined,
  storagePath?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const original = String(url || "").trim();
  try {
    if (!resolveRailwayObjectStorageConfig(env)) return original;
    const fallbackPath = String(storagePath || "").trim().replace(/^\/+/, "");
    const signable = (key: string) => !INTERNAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

    if (original.includes("/api/storage/object/")) {
      // Re-issue a stored link that points at the row's own object, so rotating RAILWAY_OBJECT_PROXY_SECRET
      // (or changing the public host) does not leave every stored link dead.
      const stored = /\/api\/storage\/object\/(customer-documents|quote-assets)\/([A-Za-z0-9_-]+)/.exec(original);
      if (stored && fallbackPath && signable(fallbackPath) && Buffer.from(stored[2], "base64url").toString("utf8") === fallbackPath) {
        return buildRailwayObjectProxyUrl(stored[1] as RailwayObjectNamespace, fallbackPath, env);
      }
      return original;
    }

    const match = original.match(
      /\/storage\/v1\/object\/public\/(customer-documents|quote-assets)\/(.+)$/i,
    );
    const namespace = (match?.[1] || "") as RailwayObjectNamespace;
    const matchedKey = match?.[2] ? decodeURIComponent(match[2]) : "";
    if (namespace) {
      const key = fallbackPath || matchedKey;
      return signable(key) ? buildRailwayObjectProxyUrl(namespace, key, env) : original;
    }
    if (fallbackPath && original.includes("customer-documents") && signable(fallbackPath)) {
      return buildRailwayObjectProxyUrl("customer-documents", fallbackPath, env);
    }
    return original;
  } catch {
    return original;
  }
}
