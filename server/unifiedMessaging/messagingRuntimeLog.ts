/**
 * Safe structured logging for unified messaging runtime events.
 * Never logs message bodies, phones, tokens, signatures, envelopes, or DB URLs.
 */
export type MessagingRuntimeLogEvent =
  | "inbound_persisted"
  | "inbound_duplicate"
  | "outbound_created"
  | "outbound_duplicate"
  | "provider_accepted"
  | "provider_failed"
  | "normalized_persistence_failed";

export type MessagingRuntimeLogFields = {
  event: MessagingRuntimeLogEvent;
  organizationId?: string;
  connectionId?: string;
  conversationId?: string;
  messageId?: string;
  externalMessageId?: string;
  clientIdempotencyKeyHash?: string;
  code?: string;
  detail?: string;
};

function scrub(value: string | undefined, max = 80): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Emit one structured log line with safe fields only. */
export function logMessagingRuntime(fields: MessagingRuntimeLogFields): void {
  const payload: Record<string, string> = {
    scope: "unified-messaging-runtime",
    event: fields.event,
  };
  if (fields.organizationId) {
    payload.organizationId = scrub(fields.organizationId, 64)!;
  }
  if (fields.connectionId) {
    payload.connectionId = scrub(fields.connectionId, 96)!;
  }
  if (fields.conversationId) {
    payload.conversationId = scrub(fields.conversationId, 96)!;
  }
  if (fields.messageId) {
    payload.messageId = scrub(fields.messageId, 96)!;
  }
  if (fields.externalMessageId) {
    payload.externalMessageId = scrub(fields.externalMessageId, 96)!;
  }
  if (fields.clientIdempotencyKeyHash) {
    payload.clientIdempotencyKeyHash = scrub(
      fields.clientIdempotencyKeyHash,
      64
    )!;
  }
  if (fields.code) payload.code = scrub(fields.code, 64)!;
  if (fields.detail) payload.detail = scrub(fields.detail, 120)!;

  if (fields.event === "normalized_persistence_failed" || fields.event === "provider_failed") {
    console.error(JSON.stringify(payload));
    return;
  }
  console.info(JSON.stringify(payload));
}
