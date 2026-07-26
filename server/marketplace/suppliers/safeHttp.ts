/**
 * SSRF-safe HTTPS client for authorized supplier catalogue hosts.
 * No cookies, credentials, or embedded secrets.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { SUPPLIER_MONITOR_USER_AGENT } from "./liveCatalogueTypes.ts";

export const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
export const DEFAULT_RESPONSE_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2_500_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_REDIRECTS = 3;

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
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Injected DNS lookup for tests. */
  lookupFn?: (hostname: string) => Promise<string[]>;
  sleepFn?: (ms: number) => Promise<void>;
};

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
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  if (normalized.startsWith("fe80")) return true; // link-local
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

async function resolveAndAssertPublic(
  hostname: string,
  lookupFn: (hostname: string) => Promise<string[]>,
): Promise<void> {
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
  for (const ip of addresses) {
    if (isPrivateOrLocalIp(ip)) {
      throw new SafeHttpError(
        "PRIVATE_IP",
        `Blocked private/link-local destination: ${ip}`,
      );
    }
  }
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new SafeHttpError("RESPONSE_TOO_LARGE", "Response exceeds max size.");
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new SafeHttpError(
          "RESPONSE_TOO_LARGE",
          "Response exceeds max size.",
        );
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Fetch an allowlisted HTTPS URL with DNS/private-IP checks, redirect validation,
 * timeouts, size limits, and bounded retries.
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
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lookupFn = opts.lookupFn ?? defaultLookup;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const userAgent = opts.userAgent ?? SUPPLIER_MONITOR_USER_AGENT;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      let current = assertSafeAbsoluteUrl(rawUrl, allowedHosts);
      await resolveAndAssertPublic(current.hostname, lookupFn);

      for (let redirect = 0; redirect <= maxRedirects; redirect++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetchImpl(current.toString(), {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              Accept: "application/json, text/plain, */*",
              "User-Agent": userAgent,
            },
          });
        } catch (err) {
          if (
            err instanceof Error &&
            (err.name === "AbortError" || /aborted|timeout/i.test(err.message))
          ) {
            throw new SafeHttpError("TIMEOUT", "Request timed out.");
          }
          throw new SafeHttpError(
            "NETWORK_ERROR",
            err instanceof Error ? err.message : "Network error",
          );
        } finally {
          clearTimeout(timer);
        }

        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const loc = res.headers.get("location");
          if (!loc) {
            throw new SafeHttpError("REDIRECT_DENIED", "Redirect missing Location.");
          }
          const next = new URL(loc, current);
          current = assertSafeAbsoluteUrl(next.toString(), allowedHosts);
          await resolveAndAssertPublic(current.hostname, lookupFn);
          if (redirect === maxRedirects) {
            throw new SafeHttpError("REDIRECT_DENIED", "Too many redirects.");
          }
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

        const body = await readBodyWithLimit(res, maxBytes);
        return {
          url: current.toString(),
          status: res.status,
          body,
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
