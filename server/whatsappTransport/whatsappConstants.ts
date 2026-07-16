/** Placeholder company scope — not an active multi-tenant isolation boundary. */
export const DEFAULT_COMPANY_ID = "sunchaser";

/**
 * Replaceable development fallback for Graph API version.
 * Always prefer WHATSAPP_GRAPH_API_VERSION in real deployments.
 */
export const WHATSAPP_GRAPH_API_VERSION_FALLBACK = "v21.0";

/** Meta WhatsApp Cloud API plain-text message limit. */
export const WHATSAPP_MAX_TEXT_LENGTH = 4096;

/**
 * Finite raw-body limit for PR-1 text/status webhooks only.
 * Large enough for legitimate Meta envelopes; rejects oversized media-heavy payloads.
 */
export const WHATSAPP_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

/** Bounded Graph API request timeout (ms). */
export const WHATSAPP_GRAPH_TIMEOUT_MS = 15_000;

/** Bounded retries when Meta accepted but final DB status update fails. */
export const WHATSAPP_OUTBOUND_DB_RETRY_ATTEMPTS = 3;
export const WHATSAPP_OUTBOUND_DB_RETRY_DELAY_MS = 50;

export const WHATSAPP_WEBHOOK_PATH = "/api/integrations/whatsapp/webhook";

export const SUPPORTED_STATUS_VALUES = [
  "sent",
  "delivered",
  "read",
  "failed",
] as const;

export type SupportedStatusValue = (typeof SUPPORTED_STATUS_VALUES)[number];

export const AUDIT_EVENTS = {
  WEBHOOK_RECEIVED: "webhook_received",
  WEBHOOK_DUPLICATE_COMPLETED: "webhook_duplicate_completed",
  WEBHOOK_REPROCESSING_INCOMPLETE: "webhook_reprocessing_incomplete",
  WEBHOOK_PROCESSED: "webhook_processed",
  SIGNATURE_REJECTED: "signature_rejected",
  INBOUND_MESSAGE_STORED: "inbound_message_stored",
  UNSUPPORTED_MESSAGE_IGNORED: "unsupported_message_ignored",
  STATUS_EVENT_STORED: "status_event_stored",
  STATUS_MESSAGE_NOT_FOUND: "status_message_not_found",
  OUTBOUND_QUEUED: "outbound_queued",
  OUTBOUND_SENDING: "outbound_sending",
  OUTBOUND_SENT: "outbound_sent",
  OUTBOUND_FAILED: "outbound_failed",
  OUTBOUND_TIMEOUT: "outbound_timeout",
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

export const MESSAGE_DIRECTIONS = {
  INBOUND: "inbound",
  OUTBOUND: "outbound",
} as const;

export const MESSAGE_STATUSES = {
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
  TIMEOUT: "timeout",
  RECEIVED: "received",
} as const;
