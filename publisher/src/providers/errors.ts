export type ProviderErrorCategory =
  | "auth_expired"
  | "auth_revoked"
  | "permission_denied"
  | "rate_limited"
  | "invalid_request"
  | "provider_unavailable"
  | "timeout_before_request"
  | "timeout_after_possible_accept"
  | "malformed_response"
  | "media_rejected"
  | "spam_risk"
  | "unknown";

export type RetryClass = "do_not_retry" | "retry_same_attempt_unknown" | "retry_new_attempt" | "refresh_then_retry";

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly retryClass: RetryClass;
  readonly httpStatus: number | null;
  readonly providerCode: string | null;
  readonly retryAfterMs: number | null;

  constructor(input: {
    message: string;
    category: ProviderErrorCategory;
    retryClass: RetryClass;
    httpStatus?: number | null;
    providerCode?: string | null;
    retryAfterMs?: number | null;
  }) {
    super(input.message);
    this.name = "ProviderError";
    this.category = input.category;
    this.retryClass = input.retryClass;
    this.httpStatus = input.httpStatus ?? null;
    this.providerCode = input.providerCode ?? null;
    this.retryAfterMs = input.retryAfterMs ?? null;
  }
}

export function classifyHttpStatus(
  status: number,
  providerCode?: string | null
): { category: ProviderErrorCategory; retryClass: RetryClass } {
  const code = (providerCode ?? "").toLowerCase();

  if (code.includes("expired") || status === 401 && code.includes("190")) {
    return { category: "auth_expired", retryClass: "refresh_then_retry" };
  }
  if (
    code.includes("revoked") ||
    code.includes("session_invalidated") ||
    code === "access_token_invalid" && /revok|invalidat/.test(code)
  ) {
    return { category: "auth_revoked", retryClass: "do_not_retry" };
  }

  if (status === 401) {
    return { category: "auth_expired", retryClass: "refresh_then_retry" };
  }
  if (status === 403) {
    return { category: "permission_denied", retryClass: "do_not_retry" };
  }
  if (status === 429) {
    return { category: "rate_limited", retryClass: "retry_new_attempt" };
  }
  if (status === 400) {
    if (code.includes("spam")) {
      return { category: "spam_risk", retryClass: "do_not_retry" };
    }
    return { category: "invalid_request", retryClass: "do_not_retry" };
  }
  if (status >= 500) {
    return { category: "provider_unavailable", retryClass: "retry_new_attempt" };
  }
  return { category: "unknown", retryClass: "do_not_retry" };
}

/** Meta Graph error.code mapping (current production handling). */
export function classifyFacebookGraphError(error: {
  code?: number;
  error_subcode?: number;
  type?: string;
  message?: string;
  httpStatus?: number;
}): { category: ProviderErrorCategory; retryClass: RetryClass } {
  const code = error.code ?? 0;
  const sub = error.error_subcode ?? 0;
  const msg = (error.message ?? "").toLowerCase();

  // 190 = invalid/expired OAuth token. Subcodes distinguish revoke vs expiry.
  if (code === 190) {
    // 458 app not installed / 460 password change / 490 user checkpoint
    if ([458, 460, 490, 452, 467].includes(sub) || msg.includes("revok") || msg.includes("session has been invalidated")) {
      return { category: "auth_revoked", retryClass: "do_not_retry" };
    }
    if ([463, 464, 467].includes(sub) || msg.includes("expired")) {
      return { category: "auth_expired", retryClass: "refresh_then_retry" };
    }
    return { category: "auth_expired", retryClass: "refresh_then_retry" };
  }
  if (code === 10 || code === 200 || code === 230) {
    return { category: "permission_denied", retryClass: "do_not_retry" };
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return { category: "rate_limited", retryClass: "retry_new_attempt" };
  }
  if (code === 368) {
    return { category: "spam_risk", retryClass: "do_not_retry" };
  }
  if (code === 1 || code === 2) {
    return { category: "provider_unavailable", retryClass: "retry_new_attempt" };
  }
  if (code === 100) {
    return { category: "invalid_request", retryClass: "do_not_retry" };
  }
  return classifyHttpStatus(error.httpStatus ?? 400, String(code));
}

export function classifyTikTokError(error: {
  code?: string;
  message?: string;
  httpStatus?: number;
}): { category: ProviderErrorCategory; retryClass: RetryClass } {
  const code = (error.code ?? "").toLowerCase();
  if (code === "ok") {
    return { category: "unknown", retryClass: "do_not_retry" };
  }
  if (code === "access_token_invalid" || code === "invalid_grant") {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("revok") || msg.includes("expired refresh")) {
      return { category: "auth_revoked", retryClass: "do_not_retry" };
    }
    return { category: "auth_expired", retryClass: "refresh_then_retry" };
  }
  if (code === "scope_not_authorized" || code === "spam_risk_user_banned_from_posting") {
    return { category: "permission_denied", retryClass: "do_not_retry" };
  }
  if (code === "rate_limit_exceeded" || code.includes("rate_limit")) {
    return { category: "rate_limited", retryClass: "retry_new_attempt" };
  }
  if (code.startsWith("spam_risk")) {
    return { category: "spam_risk", retryClass: "do_not_retry" };
  }
  if (
    code.includes("file_format") ||
    code.includes("duration_check") ||
    code.includes("picture_size")
  ) {
    return { category: "media_rejected", retryClass: "do_not_retry" };
  }
  if (error.httpStatus && error.httpStatus >= 500) {
    return { category: "provider_unavailable", retryClass: "retry_new_attempt" };
  }
  return classifyHttpStatus(error.httpStatus ?? 400, code);
}
