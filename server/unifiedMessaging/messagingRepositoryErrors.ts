/**
 * Predictable repository errors for normalized messaging persistence.
 * Never include connection strings, SQL text, or secrets in public messages.
 */

export const MESSAGING_REPOSITORY_ERROR_CODES = [
  "invalid_input",
  "not_found",
  "tenant_mismatch",
  "constraint_violation",
  "unique_violation",
  "database_failure",
] as const;

export type MessagingRepositoryErrorCode =
  (typeof MESSAGING_REPOSITORY_ERROR_CODES)[number];

export type MessagingRepositoryErrorInit = {
  code: MessagingRepositoryErrorCode;
  message: string;
  /** Optional stable machine detail (never secrets / SQL). */
  detail?: string;
  cause?: unknown;
};

export class MessagingRepositoryError extends Error {
  readonly code: MessagingRepositoryErrorCode;
  readonly detail?: string;
  readonly cause?: unknown;

  constructor(init: MessagingRepositoryErrorInit) {
    super(init.message);
    this.name = "MessagingRepositoryError";
    this.code = init.code;
    this.detail = init.detail;
    this.cause = init.cause;
  }
}

export function isMessagingRepositoryError(
  err: unknown
): err is MessagingRepositoryError {
  return err instanceof MessagingRepositoryError;
}

type PgErrorLike = {
  code?: string;
  constraint?: string;
  table?: string;
};

export function asPgError(err: unknown): PgErrorLike | null {
  if (!err || typeof err !== "object") return null;
  const e = err as PgErrorLike;
  return typeof e.code === "string" ? e : null;
}

/** Map a driver/database error into a repository error (no SQL leakage). */
export function mapDatabaseError(
  err: unknown,
  fallbackMessage = "Messaging persistence failed"
): MessagingRepositoryError {
  if (err instanceof MessagingRepositoryError) return err;
  const pg = asPgError(err);
  if (pg?.code === "23505") {
    return new MessagingRepositoryError({
      code: "unique_violation",
      message: "Unique constraint violated",
      detail: pg.constraint,
      cause: err,
    });
  }
  if (pg?.code === "23503") {
    return new MessagingRepositoryError({
      code: "constraint_violation",
      message: "Foreign key or referential constraint violated",
      detail: pg.constraint,
      cause: err,
    });
  }
  if (pg?.code === "23514") {
    return new MessagingRepositoryError({
      code: "constraint_violation",
      message: "Check constraint violated",
      detail: pg.constraint,
      cause: err,
    });
  }
  if (pg?.code === "23502") {
    return new MessagingRepositoryError({
      code: "invalid_input",
      message: "Required database column was null",
      detail: pg.constraint,
      cause: err,
    });
  }
  return new MessagingRepositoryError({
    code: "database_failure",
    message: fallbackMessage,
    cause: err,
  });
}
