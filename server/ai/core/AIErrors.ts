/**
 * Typed error hierarchy for the AI Engine.
 *
 * Every failure that crosses a module boundary (provider, tool, permission,
 * routing) is normalized into one of these classes so callers can branch on
 * `instanceof` instead of string-matching messages.
 */

export type AIErrorCode =
  | "provider_error"
  | "provider_not_configured"
  | "model_not_found"
  | "agent_not_found"
  | "tool_not_found"
  | "tool_not_bound"
  | "permission_denied"
  | "retry_exhausted"
  | "conversation_not_found"
  | "invalid_request"
  | "aborted";

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AIErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.details = details;
  }
}

/** A provider (Anthropic / OpenAI / Gemini / local) failed to serve a request. */
export class AIProviderError extends AIError {
  readonly providerId: string;
  readonly status?: number;
  /** True when the failure class is transient (429 / 5xx / network) and safe to retry. */
  readonly retryable: boolean;

  constructor(args: {
    providerId: string;
    message: string;
    status?: number;
    retryable: boolean;
    details?: Record<string, unknown>;
  }) {
    super("provider_error", args.message, args.details);
    this.name = "AIProviderError";
    this.providerId = args.providerId;
    this.status = args.status;
    this.retryable = args.retryable;
  }
}

export class AIPermissionDeniedError extends AIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("permission_denied", message, details);
    this.name = "AIPermissionDeniedError";
  }
}

export class AIAgentNotFoundError extends AIError {
  constructor(agentId: string) {
    super("agent_not_found", `Unknown agent: ${agentId}`, { agentId });
    this.name = "AIAgentNotFoundError";
  }
}

export class AIModelNotFoundError extends AIError {
  constructor(model: string) {
    super("model_not_found", `No configured provider serves model: ${model}`, { model });
    this.name = "AIModelNotFoundError";
  }
}

export class AIToolNotFoundError extends AIError {
  constructor(toolName: string) {
    super("tool_not_found", `Unknown tool: ${toolName}`, { toolName });
    this.name = "AIToolNotFoundError";
  }
}

export class AIRetryExhaustedError extends AIError {
  readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    super("retry_exhausted", `AI call failed after ${attempts} attempt(s).`);
    this.name = "AIRetryExhaustedError";
    this.lastError = lastError;
  }
}

/** Classify an HTTP status as retryable per standard API semantics. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true; // network-level failure
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
