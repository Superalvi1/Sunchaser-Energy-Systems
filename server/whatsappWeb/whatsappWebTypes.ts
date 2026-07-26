/**
 * WhatsApp Web QR connection lifecycle (QR-1).
 * Browser-safe status never includes credentials, QR secrets, or session keys.
 */

export const WHATSAPP_WEB_LIFECYCLE_STATES = [
  "DISCONNECTED",
  "QR_READY",
  "CONNECTING",
  "CONNECTED",
  "RECONNECTING",
  "LOGGED_OUT",
  "ERROR",
] as const;

export type WhatsAppWebLifecycleState =
  (typeof WHATSAPP_WEB_LIFECYCLE_STATES)[number];

/** Safe status payload for Admin API / CRM panel. */
export type WhatsAppWebSafeStatus = {
  enabled: boolean;
  state: WhatsAppWebLifecycleState;
  /** Masked connected phone, e.g. +92******321. Null when unknown/disconnected. */
  phoneMasked: string | null;
  /** ISO timestamp of last state transition. */
  updatedAt: string;
  /** True when a short-lived QR is currently available. */
  qrAvailable: boolean;
  /** ISO expiry of current QR, when available. */
  qrExpiresAt: string | null;
  /** Non-secret operator hint (never credentials). */
  safeMessage: string | null;
  /** Privacy-safe inbound ops diagnostics (timestamps + codes only). */
  lastInboundEventAt: string | null;
  lastInboundStoredAt: string | null;
  lastIgnoredReason: string | null;
  lastPersistFailureCode: string | null;
};

export type WhatsAppWebQrPayload = {
  /** PNG data URL suitable for <img src>. Short-lived. */
  qrDataUrl: string;
  expiresAt: string;
  state: WhatsAppWebLifecycleState;
};

/** Fields that must never appear on browser-facing WhatsApp Web payloads. */
export const FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS = [
  "creds",
  "keys",
  "authState",
  "noiseKey",
  "signedIdentityKey",
  "signedPreKey",
  "registrationId",
  "advSecretKey",
  "me",
  "account",
  "signalIdentities",
  "appStateSyncKeys",
  "session",
  "authDir",
  "WHATSAPP_WEB_AUTH_DIR",
] as const;

export function maskPhoneNumber(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  const visible = 3;
  const prefix = digits.slice(0, Math.min(2, digits.length - visible));
  const suffix = digits.slice(-visible);
  const maskedLen = Math.max(4, digits.length - prefix.length - suffix.length);
  return `+${prefix}${"*".repeat(maskedLen)}${suffix}`;
}
