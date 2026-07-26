/**
 * SSRF-safe HTTPS client for authorized supplier catalogue hosts.
 *
 * DNS TOCTOU mitigation: resolve + validate addresses once, then bind the
 * outbound TCP connection to those validated IPs via a pinned dns.lookup
 * override on node:https. TLS SNI / certificate hostname verification still
 * use the original allowlisted hostname (rejectUnauthorized remains default).
 *
 * No cookies, credentials, or embedded secrets.
 */
import dnsCallback from "node:dns";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { URL } from "node:url";
import type { IncomingMessage } from "node:http";
import { SUPPLIER_MONITOR_USER_AGENT } from "./liveCatalogueTypes.ts";

export const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
export const DEFAULT_RESPONSE_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2_500_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_REDIRECTS = 3;

/** Always true — TLS certificate verification is never disabled. */
export const TLS_REJECT_UNAUTHORIZED = true as const;

/** Exact hostname allowlist for catalogue fetches. */
export const SUPPLIER_CATALOGUE_HOSTS = new Set([
  "kamalsolar.pk",
  "www.kamalsolar.pk",
  "alladin.pk",
  "www.alladin.pk",
]);

/** Verified image/CDN hosts discovered from Kamal + Alladin storefronts. */
export const SUPPLIER_IMAGE_HOSTS = new Set([
  "cdn.shopify.com",
  "kamalsolar.pk",
  "www.kamalsolar.pk",
  "alladin.pk",
  "www.alladin.pk",
]);

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRetries?: number;
  maxRedirects?: number;
  allowedHosts?: ReadonlySet<string>;
  userAgent?: string;
  /** Injected DNS lookup for tests. */
  lookupFn?: (hostname: string) => Promise<string[]>;
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Injected pinned request for tests. Receives the already-validated
   * destination addresses — production path uses node:https with pinned lookup.
   */
  pinnedRequestFn?: PinnedHttpsRequestFn;
};

export type PinnedHttpsRequestArgs = {
  url: URL;
  /** Public IPs from the single validated DNS lookup for this hop. */
  validatedAddresses: string[];
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
  /** Optional observer for tests (which IP the pinned lookup returned). */
  onPinnedLookup?: (ip: string, family: number) => void;
};

export type PinnedHttpsRequestResult = {
  status: number;
  headers: globalThis.Headers;
  body: string;
};

export type PinnedHttpsRequestFn = (
  args: PinnedHttpsRequestArgs,
) => Promise<PinnedHttpsRequestResult>;

export class SafeHttpError extends Error {
  constructor(
    readonly code:
      | "INVALID_URL"
      | "PROTOCOL_DENIED"
      | "HOST_DENIED"
      | "PRIVATE_IP"
      | "REDIRECT_DENIED"
      | "TIMEOUT"
      | "RESPONSE_TOO_LARGE"
      | "HTTP_ERROR"
      | "DNS_ERROR"
      | "NETWORK_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "SafeHttpError";
  }
}

function isPrivateOrLocalIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (!family) return true;
  if (family === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // IPv6
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  // Unspecified address (equivalent forms)
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  if (normalized.startsWith("fe80")) return true; // link-local
  if (normalized.startsWith("ff")) return true; // multicast
  if (normalized.startsWith("::ffff:")) {
    const v4 = normalized.slice("::ffff:".length);
    return isPrivateOrLocalIp(v4);
  }
  return false;
}

export function assertSafeAbsoluteUrl(
  raw: string,
  allowedHosts: ReadonlySet<string>,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeHttpError("INVALID_URL", "URL is not absolute/valid.");
  }
  if (url.protocol !== "https:") {
    throw new SafeHttpError("PROTOCOL_DENIED", "Only HTTPS is allowed.");
  }
  if (url.username || url.password) {
    throw new SafeHttpError("INVALID_URL", "URL credentials are not allowed.");
  }
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.has(host)) {
    throw new SafeHttpError("HOST_DENIED", `Host not allowlisted: ${host}`);
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    throw new SafeHttpError("HOST_DENIED", "Localhost destinations blocked.");
  }
  return url;
}

export function isAllowedSupplierImageUrl(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("file:") ||
    trimmed.startsWith("blob:")
  ) {
    return false;
  }
  try {
    const absolute = trimmed.startsWith("//")
      ? `https:${trimmed}`
      : trimmed;
    assertSafeAbsoluteUrl(absolute, SUPPLIER_IMAGE_HOSTS);
    return true;
  } catch {
    return false;
  }
}

export function normalizeSupplierImageUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  if (!isAllowedSupplierImageUrl(absolute)) return null;
  return absolute;
}

/**
 * Prefer IPv4 then IPv6 from a validated address list (deterministic).
 * Never invents addresses outside the provided validated set.
 */
export function selectPinnedAddress(validatedAddresses: string[]): {
  address: string;
  family: number;
} {
  const unique = [...new Set(validatedAddresses.filter((a) => net.isIP(a)))];
  const v4 = unique.find((a) => net.isIP(a) === 4);
  const v6 = unique.find((a) => net.isIP(a) === 6);
  const pick = v4 || v6;
  if (!pick) {
    throw new SafeHttpError("DNS_ERROR", "No usable validated addresses.");
  }
  return { address: pick, family: net.isIP(pick) };
}

/**
 * Build a dns.lookup-compatible function that only returns validated IPs.
 * Supports both legacy `(err, address, family)` and `{ all: true }` forms
 * used by Node's net/https connect path.
 */
export function createPinnedLookup(
  validatedAddresses: string[],
  onPinnedLookup?: (ip: string, family: number) => void,
): (
  hostname: string,
  options: unknown,
  callback?: (...args: any[]) => void,
) => void {
  const pinned = selectPinnedAddress(validatedAddresses);
  return (hostname, options, callback) => {
    let opts: { all?: boolean } = {};
    let cb = callback as ((...args: any[]) => void) | undefined;
    if (typeof options === "function") {
      cb = options as (...args: any[]) => void;
      opts = {};
    } else if (options && typeof options === "object") {
      opts = options as { all?: boolean };
    }
    if (typeof cb !== "function") {
      throw new SafeHttpError("DNS_ERROR", "Pinned lookup missing callback.");
    }
    onPinnedLookup?.(pinned.address, pinned.family);
    // Intentionally ignore hostname — connection is bound to validated IPs only.
    if (opts.all) {
      cb(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    cb(null, pinned.address, pinned.family);
  };
}

async function lookupPublicAddresses(
  hostname: string,
  lookupFn: (hostname: string) => Promise<string[]>,
): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = await lookupFn(hostname);
  } catch (err) {
    throw new SafeHttpError(
      "DNS_ERROR",
      err instanceof Error ? err.message : "DNS lookup failed",
    );
  }
  if (!addresses.length) {
    throw new SafeHttpError("DNS_ERROR", `No addresses for ${hostname}`);
  }
  // DNS-rebinding safety: reject the hop if ANY answer is prohibited.
  for (const ip of addresses) {
    if (isPrivateOrLocalIp(ip)) {
      throw new SafeHttpError(
        "PRIVATE_IP",
        `Blocked private/link-local destination: ${ip}`,
      );
    }
  }
  return [...new Set(addresses)];
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headersFromIncoming(msg: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(msg.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readIncomingBody(
  res: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    res.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.byteLength;
      if (total > maxBytes) {
        res.destroy();
        reject(
          new SafeHttpError("RESPONSE_TOO_LARGE", "Response exceeds max size."),
        );
        return;
      }
      chunks.push(buf);
    });
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", (err) =>
      reject(
        new SafeHttpError(
          "NETWORK_ERROR",
          err instanceof Error ? err.message : "Response stream error",
        ),
      ),
    );
  });
}

/**
 * Production pinned HTTPS request: connects only to validatedAddresses while
 * presenting the original hostname for Host + TLS SNI / certificate checks.
 */
export async function pinnedHttpsRequest(
  args: PinnedHttpsRequestArgs,
): Promise<PinnedHttpsRequestResult> {
  const { url, validatedAddresses, headers, timeoutMs, maxBytes, onPinnedLookup } =
    args;
  if (url.protocol !== "https:") {
    throw new SafeHttpError("PROTOCOL_DENIED", "Only HTTPS is allowed.");
  }

  const pinnedLookup = createPinnedLookup(validatedAddresses, onPinnedLookup);

  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        servername: url.hostname, // TLS SNI — keeps cert hostname verification
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          ...headers,
          Host: url.host,
        },
        // Never disable TLS verification / never set NODE_TLS_REJECT_UNAUTHORIZED=0.
        rejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
        lookup: pinnedLookup as unknown as typeof dnsCallback.lookup,
      },
      (res) => {
        readIncomingBody(res, maxBytes)
          .then((body) =>
            resolve({
              status: res.statusCode || 0,
              headers: headersFromIncoming(res),
              body,
            }),
          )
          .catch(reject);
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("aborted"));
    });
    req.on("error", (err) => {
      if (
        err instanceof Error &&
        (err.name === "AbortError" || /aborted|timeout/i.test(err.message))
      ) {
        reject(new SafeHttpError("TIMEOUT", "Request timed out."));
        return;
      }
      reject(
        new SafeHttpError(
          "NETWORK_ERROR",
          err instanceof Error ? err.message : "Network error",
        ),
      );
    });
    req.end();
  });
}

/**
 * Fetch an allowlisted HTTPS URL with DNS validation + connection pinning,
 * redirect re-validation, timeouts, size limits, and bounded retries.
 */
export async function safeFetchText(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<{ url: string; status: number; body: string; contentType: string | null }> {
  const allowedHosts = opts.allowedHosts ?? SUPPLIER_CATALOGUE_HOSTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const lookupFn = opts.lookupFn ?? defaultLookup;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const userAgent = opts.userAgent ?? SUPPLIER_MONITOR_USER_AGENT;
  const requestFn = opts.pinnedRequestFn ?? pinnedHttpsRequest;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      let current = assertSafeAbsoluteUrl(rawUrl, allowedHosts);

      for (let redirect = 0; redirect <= maxRedirects; redirect++) {
        // Fresh DNS validation + pin for every hop (including redirects).
        const validatedAddresses = await lookupPublicAddresses(
          current.hostname,
          lookupFn,
        );

        const res = await requestFn({
          url: current,
          validatedAddresses,
          headers: {
            Accept: "application/json, text/plain, */*",
            "User-Agent": userAgent,
          },
          timeoutMs,
          maxBytes,
        });

        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get("location");
          if (!loc) {
            throw new SafeHttpError("REDIRECT_DENIED", "Redirect missing Location.");
          }
          if (redirect === maxRedirects) {
            throw new SafeHttpError("REDIRECT_DENIED", "Too many redirects.");
          }
          const next = new URL(loc, current);
          current = assertSafeAbsoluteUrl(next.toString(), allowedHosts);
          continue;
        }

        if (res.status === 429 || res.status >= 500) {
          throw new SafeHttpError(
            "HTTP_ERROR",
            `Upstream HTTP ${res.status}`,
          );
        }
        if (res.status < 200 || res.status >= 300) {
          throw new SafeHttpError(
            "HTTP_ERROR",
            `Upstream HTTP ${res.status}`,
          );
        }

        return {
          url: current.toString(),
          status: res.status,
          body: res.body,
          contentType: res.headers.get("content-type"),
        };
      }
      throw new SafeHttpError("REDIRECT_DENIED", "Redirect loop exhausted.");
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof SafeHttpError &&
        (err.code === "TIMEOUT" ||
          err.code === "NETWORK_ERROR" ||
          (err.code === "HTTP_ERROR" && /HTTP (429|5\d\d)/.test(err.message)));
      if (!retryable || attempt >= maxRetries) break;
      const backoff = 250 * 2 ** attempt;
      await sleepFn(backoff);
      attempt += 1;
    }
  }

  if (lastError instanceof SafeHttpError) throw lastError;
  throw new SafeHttpError(
    "NETWORK_ERROR",
    lastError instanceof Error ? lastError.message : "Fetch failed",
  );
}

export { isPrivateOrLocalIp };
