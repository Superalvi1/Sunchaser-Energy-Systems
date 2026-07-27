/**
 * Process-local privacy-safe inbound operational diagnostics.
 * Never stores phones, names, JIDs, message text, tokens, or payloads.
 */

export type WhatsAppWebInboundDiagnosticsSnapshot = {
  lastInboundEventAt: string | null;
  lastInboundStoredAt: string | null;
  lastIgnoredReason: string | null;
  lastPersistFailureCode: string | null;
};

const ALLOWED_IGNORE_REASONS = new Set([
  "from_me",
  "group",
  "status_or_newsletter",
  "no_text",
  "bad_jid",
  "missing_provider_id",
]);

const ALLOWED_FAILURE_CODES = new Set([
  "persistence_unavailable",
  "insert_failed",
  "unexpected_persist_failure",
]);

let snapshot: WhatsAppWebInboundDiagnosticsSnapshot = {
  lastInboundEventAt: null,
  lastInboundStoredAt: null,
  lastIgnoredReason: null,
  lastPersistFailureCode: null,
};

function nowIso(): string {
  return new Date().toISOString();
}

export function noteInboundEventReceived(): void {
  snapshot = { ...snapshot, lastInboundEventAt: nowIso() };
}

export function noteInboundStored(): void {
  snapshot = {
    ...snapshot,
    lastInboundEventAt: snapshot.lastInboundEventAt ?? nowIso(),
    lastInboundStoredAt: nowIso(),
  };
}

export function noteInboundIgnored(reason: string): void {
  const safe = ALLOWED_IGNORE_REASONS.has(reason) ? reason : "ignored";
  snapshot = {
    ...snapshot,
    lastInboundEventAt: snapshot.lastInboundEventAt ?? nowIso(),
    lastIgnoredReason: safe,
  };
}

export function noteInboundPersistFailed(code: string): void {
  const safe = ALLOWED_FAILURE_CODES.has(code)
    ? code
    : "unexpected_persist_failure";
  snapshot = {
    ...snapshot,
    lastInboundEventAt: snapshot.lastInboundEventAt ?? nowIso(),
    lastPersistFailureCode: safe,
  };
}

export function getWhatsAppWebInboundDiagnostics(): WhatsAppWebInboundDiagnosticsSnapshot {
  return { ...snapshot };
}

/** Test-only reset. */
export function __resetWhatsAppWebInboundDiagnostics(): void {
  snapshot = {
    lastInboundEventAt: null,
    lastInboundStoredAt: null,
    lastIgnoredReason: null,
    lastPersistFailureCode: null,
  };
}
