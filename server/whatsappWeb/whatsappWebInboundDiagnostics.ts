/**
 * Process-local privacy-safe inbound operational diagnostics.
 * Never stores phones, names, JIDs, message text, tokens, or payloads.
 */

export type WhatsAppWebInboundDiagnosticsSnapshot = {
  /** Last messages.upsert seen by the live listener (any type). */
  lastRawUpsertAt: string | null;
  /** Last inbound accepted into the persist handler. */
  lastInboundEventAt: string | null;
  lastInboundStoredAt: string | null;
  lastIgnoredAt: string | null;
  lastIgnoredReason: string | null;
  lastPersistFailureAt: string | null;
  lastPersistFailureCode: string | null;
};

const ALLOWED_IGNORE_REASONS = new Set([
  "from_me",
  "group",
  "status_or_newsletter",
  "no_text",
  "bad_jid",
  "missing_provider_id",
  "unsupported_upsert_type",
  "stale_socket",
  "missing_remote_jid",
  "system_or_empty",
]);

const ALLOWED_FAILURE_CODES = new Set([
  "persistence_unavailable",
  "insert_failed",
  "unexpected_persist_failure",
]);

let snapshot: WhatsAppWebInboundDiagnosticsSnapshot = {
  lastRawUpsertAt: null,
  lastInboundEventAt: null,
  lastInboundStoredAt: null,
  lastIgnoredAt: null,
  lastIgnoredReason: null,
  lastPersistFailureAt: null,
  lastPersistFailureCode: null,
};

function nowIso(): string {
  return new Date().toISOString();
}

export function noteInboundRawUpsert(): void {
  snapshot = { ...snapshot, lastRawUpsertAt: nowIso() };
}

export function noteInboundEventReceived(): void {
  snapshot = { ...snapshot, lastInboundEventAt: nowIso() };
}

export function noteInboundStored(): void {
  const at = nowIso();
  snapshot = {
    ...snapshot,
    lastInboundEventAt: snapshot.lastInboundEventAt ?? at,
    lastInboundStoredAt: at,
  };
}

export function noteInboundIgnored(reason: string): void {
  const safe = ALLOWED_IGNORE_REASONS.has(reason) ? reason : "ignored";
  const at = nowIso();
  snapshot = {
    ...snapshot,
    lastInboundEventAt: snapshot.lastInboundEventAt ?? at,
    lastIgnoredAt: at,
    lastIgnoredReason: safe,
  };
}

export function noteInboundPersistFailed(code: string): void {
  const safe = ALLOWED_FAILURE_CODES.has(code)
    ? code
    : "unexpected_persist_failure";
  const at = nowIso();
  snapshot = {
    ...snapshot,
    lastInboundEventAt: snapshot.lastInboundEventAt ?? at,
    lastPersistFailureAt: at,
    lastPersistFailureCode: safe,
  };
}

export function getWhatsAppWebInboundDiagnostics(): WhatsAppWebInboundDiagnosticsSnapshot {
  return { ...snapshot };
}

/** Test-only reset. */
export function __resetWhatsAppWebInboundDiagnostics(): void {
  snapshot = {
    lastRawUpsertAt: null,
    lastInboundEventAt: null,
    lastInboundStoredAt: null,
    lastIgnoredAt: null,
    lastIgnoredReason: null,
    lastPersistFailureAt: null,
    lastPersistFailureCode: null,
  };
}
