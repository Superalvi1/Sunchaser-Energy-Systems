import { ProviderError } from "./errors.ts";
import { redactString } from "../logging/redact.ts";

export type HttpMethod = "GET" | "POST" | "PUT";

export type HttpRequest = {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
  timeoutMs: number;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyBytes?: Uint8Array;
};

export type FetchLike = (req: HttpRequest, signal: AbortSignal) => Promise<HttpResponse>;

/**
 * Conservative timeout rule:
 * once the request has been handed to the transport, an abort cannot prove
 * the provider did not accept the post → timeout_after_possible_accept.
 */
export async function sendHttp(
  fetchLike: FetchLike,
  req: HttpRequest
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  let handedOff = false;
  try {
    const pending = fetchLike(req, controller.signal);
    handedOff = true;
    return await pending;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (controller.signal.aborted) {
      throw new ProviderError({
        message: "Provider request timed out",
        category: handedOff ? "timeout_after_possible_accept" : "timeout_before_request",
        retryClass: handedOff ? "retry_same_attempt_unknown" : "retry_new_attempt",
      });
    }
    const msg = err instanceof Error ? err.message : "network error";
    throw new ProviderError({
      message: redactString(msg, 200),
      category: "provider_unavailable",
      retryClass: "retry_new_attempt",
    });
  } finally {
    clearTimeout(timer);
  }
}

function toBodyInit(body: HttpRequest["body"]): BodyInit | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  return Buffer.from(body);
}

export async function nodeFetchAdapter(req: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: toBodyInit(req.body),
    signal,
    redirect: "error",
  });
  const bodyText = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { status: res.status, headers, bodyText };
}

export function parseJsonBody(bodyText: string): unknown {
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText);
  } catch {
    return { __malformed: true, preview: bodyText.slice(0, 120) };
  }
}

export function isMalformedJson(parsed: unknown): boolean {
  return Boolean(parsed && typeof parsed === "object" && parsed !== null && "__malformed" in parsed);
}

/**
 * Host allowlist — adapters must only call these. Prevents SSRF via redirect/config.
 * TikTok FILE_UPLOAD returns upload_url on open-upload.tiktokapis.com (official example).
 * Facebook Reels resumable upload uses rupload.facebook.com.
 */
export const PROVIDER_ALLOWED_HOSTS = new Set([
  "graph.facebook.com",
  "www.facebook.com",
  "rupload.facebook.com",
  "open.tiktokapis.com",
  "open-upload.tiktokapis.com",
  "www.tiktok.com",
]);

export function assertAllowedProviderUrl(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new ProviderError({
      message: "Invalid provider URL",
      category: "invalid_request",
      retryClass: "do_not_retry",
    });
  }
  if (url.protocol !== "https:") {
    throw new ProviderError({
      message: "Provider URL must be https",
      category: "invalid_request",
      retryClass: "do_not_retry",
    });
  }
  if (!PROVIDER_ALLOWED_HOSTS.has(url.hostname)) {
    throw new ProviderError({
      message: "Provider hostname is not allowlisted",
      category: "invalid_request",
      retryClass: "do_not_retry",
    });
  }
  return url;
}
