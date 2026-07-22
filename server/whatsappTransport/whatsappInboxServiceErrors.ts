/** Typed service-layer errors for PR 2 inbox (no HTTP coupling). */
export type InboxServiceErrorCode =
  | "not_found"
  | "forbidden"
  | "conflict"
  | "invalid_transition"
  | "invalid_argument"
  | "free_form_closed"
  | "idempotency_processing"
  | "idempotency_outcome_unknown"
  | "already_linked"
  | "service_unavailable";

export class InboxServiceError extends Error {
  readonly code: InboxServiceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: InboxServiceErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "InboxServiceError";
    this.code = code;
    this.details = details;
  }
}

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: InboxServiceError };
