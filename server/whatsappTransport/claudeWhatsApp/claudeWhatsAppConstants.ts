/** Stable provider tag written into raw_payload / raw_metadata. */
export const CLAUDE_WHATSAPP_PROVIDER = "claude_whatsapp" as const;

/** Single-session id for the business number live test. */
export const CLAUDE_WHATSAPP_SESSION_ID = "default";

/**
 * Synthetic Meta-shaped channel key. Keeps Claude traffic out of the
 * Meta Cloud API phone_number_id namespace without altering existing tables.
 */
export const CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID = "claude_whatsapp";

/** DB settings.key for the abort toggle (jsonb boolean). */
export const CLAUDE_WHATSAPP_ENABLED_SETTINGS_KEY = "claude_whatsapp_enabled";

/** Kill-switch poll interval — sub-few-second latency without redeploy. */
export const CLAUDE_WHATSAPP_KILL_SWITCH_POLL_MS = 2_000;

/** Hard floor between outbound sends per conversation (1–2s range). */
export const CLAUDE_WHATSAPP_MIN_SEND_GAP_MS = 1_500;

/** Reconnect backoff base / cap. */
export const CLAUDE_WHATSAPP_RECONNECT_BASE_MS = 1_500;
export const CLAUDE_WHATSAPP_RECONNECT_MAX_MS = 30_000;

export type ClaudeWhatsAppLiveStatus =
  | "connected"
  | "awaiting_qr"
  | "disconnected";

export type ClaudeWhatsAppDisconnectKind =
  | "reconnecting"
  | "logged_out"
  | "idle"
  | "none";
