/**
 * Normalized transport error taxonomy.
 * Safe for gateway logging / browser-facing summaries — never raw secrets or PII.
 */

export const TRANSPORT_ERROR_CATEGORIES = [
  "unauthorized",
  "forbidden",
  "invalid_request",
  "signature_invalid",
  "disconnected",
  "session_expired",
  "capability_unsupported",
  "rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "provider_rejected",
  "media_failure",
  "credential_failure",
  "internal_failure",
] as const;

export type TransportErrorCategory =
  (typeof TRANSPORT_ERROR_CATEGORIES)[number];

/** Categories that are generally retryable after backoff (not guaranteed success). */
export const RETRYABLE_ERROR_CATEGORIES: ReadonlySet<TransportErrorCategory> =
  new Set([
    "rate_limited",
    "provider_timeout",
    "provider_unavailable",
  ]);

/** Categories that are permanent / require operator or client correction. */
export const PERMANENT_ERROR_CATEGORIES: ReadonlySet<TransportErrorCategory> =
  new Set([
    "unauthorized",
    "forbidden",
    "invalid_request",
    "signature_invalid",
    "capability_unsupported",
    "provider_rejected",
    "credential_failure",
  ]);

export type RedactedDiagnosticContext = Readonly<
  Record<string, string | number | boolean | null>
>;

export type TransportErrorInit = {
  category: TransportErrorCategory;
  /** Override default retryability derived from category. */
  retryable?: boolean;
  safeMessage: string;
  diagnostic?: RedactedDiagnosticContext;
  providerCode?: string | null;
};

function defaultRetryable(category: TransportErrorCategory): boolean {
  if (RETRYABLE_ERROR_CATEGORIES.has(category)) return true;
  if (PERMANENT_ERROR_CATEGORIES.has(category)) return false;
  // disconnected / session_expired / media_failure / internal_failure:
  // reconnect or remediation may help — treat as conditionally retryable.
  return (
    category === "disconnected" ||
    category === "session_expired" ||
    category === "media_failure" ||
    category === "internal_failure"
  );
}

/**
 * Typed transport failure. Thrown or returned by adapters/gateway helpers.
 * `safeMessage` is browser/operator safe; `diagnostic` must be redacted.
 */
export class TransportContractError extends Error {
  readonly category: TransportErrorCategory;
  readonly retryable: boolean;
  readonly safeMessage: string;
  readonly diagnostic: RedactedDiagnosticContext;
  readonly providerCode: string | null;

  constructor(init: TransportErrorInit) {
    super(init.safeMessage);
    this.name = "TransportContractError";
    this.category = init.category;
    this.retryable = init.retryable ?? defaultRetryable(init.category);
    this.safeMessage = init.safeMessage;
    this.diagnostic = Object.freeze({ ...(init.diagnostic ?? {}) });
    this.providerCode = init.providerCode ?? null;
  }

  toJSON(): {
    name: string;
    category: TransportErrorCategory;
    retryable: boolean;
    safeMessage: string;
    diagnostic: RedactedDiagnosticContext;
    providerCode: string | null;
  } {
    return {
      name: this.name,
      category: this.category,
      retryable: this.retryable,
      safeMessage: this.safeMessage,
      diagnostic: this.diagnostic,
      providerCode: this.providerCode,
    };
  }
}

export type TransportResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TransportContractError };

export function okResult<T>(value: T): TransportResult<T> {
  return { ok: true, value };
}

export function errResult(
  init: TransportErrorInit
): TransportResult<never> {
  return { ok: false, error: new TransportContractError(init) };
}

export function isTransportContractError(
  value: unknown
): value is TransportContractError {
  return value instanceof TransportContractError;
}

export function isRetryableTransportError(error: TransportContractError): boolean {
  return error.retryable === true;
}

export function isPermanentTransportError(error: TransportContractError): boolean {
  return error.retryable === false;
}

/** Reject outbound envelopes missing an idempotency key before dispatch. */
export function requireOutboundIdempotencyKey(
  idempotencyKey: unknown
): TransportResult<string> {
  if (typeof idempotencyKey !== "string") {
    return errResult({
      category: "invalid_request",
      retryable: false,
      safeMessage: "Outbound operations require a string idempotency key",
      diagnostic: { reason: "idempotency_key_missing_or_wrong_type" },
    });
  }
  const trimmed = idempotencyKey.trim();
  if (!trimmed) {
    return errResult({
      category: "invalid_request",
      retryable: false,
      safeMessage: "Outbound operations require a non-empty idempotency key",
      diagnostic: { reason: "idempotency_key_empty" },
    });
  }
  return okResult(trimmed);
}
