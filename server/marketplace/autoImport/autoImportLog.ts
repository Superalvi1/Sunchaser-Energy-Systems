/**
 * Safe structured logging for CEO marketplace auto-import.
 * Never logs auth headers, cookies/tokens, Supabase keys, customer PII,
 * or complete supplier response bodies.
 */

export type AutoImportLogStage =
  | "run_start"
  | "feature_gate"
  | "supplier_fetch_start"
  | "supplier_fetch_done"
  | "supplier_fetch_failed"
  | "normalize"
  | "matching"
  | "plan"
  | "plan_phase_timing"
  | "persist_start"
  | "persist_done"
  | "persist_failed"
  | "persist_rollback"
  | "health_save_failed"
  | "rpc_failed"
  | "job_timeout"
  | "run_complete"
  | "route_error"
  | "unexpected_error";

export type AutoImportLogFields = {
  runId: string;
  stage: AutoImportLogStage;
  supplier?: "kamal" | "alladin" | "none";
  elapsedMs?: number;
  status?: "succeeded" | "failed" | "partial" | "never" | "running";
  errorClass?: string;
  errorCode?: string;
  detail?: string;
  pagesFetched?: number;
  discovered?: number;
  plannedUpserts?: number;
  /** Sanitized stage durations (ms). Never include secrets or payloads. */
  fetchMs?: number;
  normalizeMs?: number;
  matchingMs?: number;
  aiPlanMs?: number;
  planMs?: number;
  totalMs?: number;
};

const SENSITIVE_FRAGMENT =
  /authorization|cookie|bearer|apikey|api[_-]?key|service[_-]?role|supabase|jwt|token|password|secret|phone|email|@/i;

/** Cap and scrub free-text so logs never carry secrets or bulky payloads. */
export function sanitizeLogText(value: string | undefined, max = 120): string | undefined {
  if (value == null) return undefined;
  let trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  if (SENSITIVE_FRAGMENT.test(trimmed)) {
    return "[redacted]";
  }
  // Drop anything that looks like a raw JSON body dump.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "[redacted_payload]";
  }
  if (trimmed.length > max) trimmed = `${trimmed.slice(0, max)}…`;
  return trimmed;
}

export function sanitizeAutoImportError(err: unknown): {
  errorClass: string;
  errorCode: string;
  message: string;
} {
  if (err && typeof err === "object" && "code" in err && "name" in err) {
    const named = err as { name?: string; code?: string; message?: string };
    const errorClass = sanitizeLogText(String(named.name || "Error"), 64) || "Error";
    const errorCode =
      sanitizeLogText(String(named.code || "UNKNOWN"), 64) || "UNKNOWN";
    const message =
      sanitizeLogText(String(named.message || "error"), 160) || "error";
    return { errorClass, errorCode, message };
  }
  if (err instanceof Error) {
    const errorClass = sanitizeLogText(err.name, 64) || "Error";
    const message = sanitizeLogText(err.message, 160) || "error";
    // Map common timeout / network wording into stable codes.
    let errorCode = "UNEXPECTED";
    if (/timeout|aborted/i.test(err.message)) errorCode = "TIMEOUT";
    else if (/HTTP \d+/i.test(err.message)) errorCode = "HTTP_ERROR";
    else if (/JSON|catalogue|products array/i.test(err.message)) {
      errorCode = "MALFORMED_RESPONSE";
    } else if (/rpc|upsert|supabase|postgres|PGRST|function/i.test(err.message)) {
      errorCode = "RPC_FAILURE";
    }
    return { errorClass, errorCode, message };
  }
  return {
    errorClass: "UnknownError",
    errorCode: "UNEXPECTED",
    message: "non_error_throw",
  };
}

/** Emit one structured JSON log line (info or error). */
export function logAutoImport(fields: AutoImportLogFields): void {
  const payload: Record<string, string | number> = {
    scope: "marketplace-ceo-auto-import",
    runId: sanitizeLogText(fields.runId, 48) || "unknown",
    stage: fields.stage,
  };
  if (fields.supplier) payload.supplier = fields.supplier;
  if (typeof fields.elapsedMs === "number" && Number.isFinite(fields.elapsedMs)) {
    payload.elapsedMs = Math.max(0, Math.round(fields.elapsedMs));
  }
  if (fields.status) payload.status = fields.status;
  if (fields.errorClass) {
    payload.errorClass = sanitizeLogText(fields.errorClass, 64) || "Error";
  }
  if (fields.errorCode) {
    payload.errorCode = sanitizeLogText(fields.errorCode, 64) || "UNKNOWN";
  }
  if (fields.detail) {
    const detail = sanitizeLogText(fields.detail, 160);
    if (detail) payload.detail = detail;
  }
  if (typeof fields.pagesFetched === "number") {
    payload.pagesFetched = fields.pagesFetched;
  }
  if (typeof fields.discovered === "number") {
    payload.discovered = fields.discovered;
  }
  if (typeof fields.plannedUpserts === "number") {
    payload.plannedUpserts = fields.plannedUpserts;
  }
  for (const key of [
    "fetchMs",
    "normalizeMs",
    "matchingMs",
    "aiPlanMs",
    "planMs",
    "totalMs",
  ] as const) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      payload[key] = Math.max(0, Math.round(value));
    }
  }

  const isError =
    fields.stage === "route_error" ||
    fields.stage === "unexpected_error" ||
    fields.stage === "persist_failed" ||
    fields.stage === "persist_rollback" ||
    fields.stage === "health_save_failed" ||
    fields.stage === "rpc_failed" ||
    fields.stage === "job_timeout" ||
    fields.stage === "supplier_fetch_failed" ||
    fields.status === "failed";

  if (isError) {
    console.error(JSON.stringify(payload));
    return;
  }
  console.info(JSON.stringify(payload));
}
