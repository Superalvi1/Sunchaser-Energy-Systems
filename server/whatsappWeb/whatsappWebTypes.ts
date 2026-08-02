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

export const WHATSAPP_WEB_LEASE_NOT_OWNED_CODE = "whatsapp_lease_not_owned";

export const WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE =
  "This process does not own the WhatsApp session lease. Retry against the lease owner or wait for deploy overlap to finish.";

export type WhatsAppWebLeaseNotOwnedDetails = {
  code: typeof WHATSAPP_WEB_LEASE_NOT_OWNED_CODE;
  servingProcessInstanceId: string;
  ownerProcessInstanceId: string | null;
  sessionLeaseStatus: string;
  sessionLeaseOwnerMatch: false;
  fencingVersion: number | null;
  retryGuidance: string;
};

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
  lastRawUpsertAt: string | null;
  lastInboundEventAt: string | null;
  lastInboundStoredAt: string | null;
  lastIgnoredAt: string | null;
  lastIgnoredReason: string | null;
  lastPersistFailureAt: string | null;
  lastPersistFailureCode: string | null;
  /** True when the active socket reports open / CONNECTED. */
  socketOpen: boolean;
  /** True when the active handle has an inbound messages.upsert listener. */
  inboundListenerAttached: boolean;
  /**
   * True when CONNECTED, socket open, and exactly one operational
   * messages.upsert listener is bound to the active generation.
   */
  inboundListenerOperational: boolean;
  /** Active socket generation (monotonic; no secrets). */
  activeSocketGeneration: number;
  /** Opaque company/session identifier (no phone/credentials). */
  activeSessionKey: string;
  /** True when a reconnect timer is armed (not yet attempting). */
  reconnectScheduled: boolean;
  /** True while a reconnect socket start is in progress. */
  reconnectAttemptInProgress: boolean;
  /** Bounded retry index (0 after successful open / terminal stop). */
  reconnectAttempt: number;
  /** Sanitized last disconnect classification (no secrets). */
  lastDisconnectClassification: string | null;
  /** Whether saved Baileys credentials are known present on disk. */
  credentialsAvailable: boolean;
  /** Opaque process/instance id (Render instance hash or boot id). */
  processInstanceId: string;
  /** Process pid for multi-instance diagnosis. */
  processPid: number;
  /** Hashed hostname (never raw host). */
  hostHash: string | null;
  /** Last Baileys connection.update timestamp. */
  lastConnectionUpdateAt: string | null;
  /** Last sanitized connection.update state. */
  lastConnectionState: string | null;
  /** Last sanitized connection reason/classification. */
  lastConnectionReason: string | null;
  /** Last credentials.update persistence timestamp. */
  lastCredentialsUpdateAt: string | null;
  /** SHA-256 prefix of authenticated user JID (never phone plaintext). */
  authenticatedUserJidHash: string | null;
  /** When the active socket handle was created. */
  socketCreatedAt: string | null;
  /** Exclusive session-dir lease status. */
  sessionLeaseStatus: string | null;
  /** True when this process holds the session lease. */
  sessionLeaseOwnerMatch: boolean;
  /** Opaque lease owner id (truncated). */
  sessionLeaseOwnerId: string | null;
  /** Opaque fencing token hash for the held acquisition. */
  sessionLeaseFencingTokenHash: string | null;
  sessionLeaseAcquiredAt: string | null;
  sessionLeaseHeartbeatAt: string | null;
  /** Whether creds.json exists (contents never exposed). */
  credentialsFilePresent: boolean | null;
  /** Count of Baileys key JSON files beside creds (no contents). */
  authKeyFileCount: number | null;
  /**
 * True when CONNECTED with an operational listener but no messages.upsert
 * has been observed since socket creation (silence threshold).
 */
  listeningSilent: boolean;
  /**
   * Inbound readiness classification. LIVE_INBOUND_CONFIRMED requires an
   * observed upsert/accepted/stored event — never inferred from socketOpen alone.
   */
  inboundHealth:
    | "CONNECTED_SOCKET"
    | "LISTENER_READY"
    | "LIVE_INBOUND_CONFIRMED"
    | "INBOUND_SILENT"
    | "LEASE_NOT_OWNED";
  /** Process that answered this HTTP request. */
  servingProcessInstanceId: string;
  /** Durable lease owner process id (when known). */
  ownerProcessInstanceId: string | null;
  /** Durable fencing version (never the owner_token secret). */
  fencingVersion: number | null;
  /** Deploy/build identity (Render git commit / SOURCE_VERSION). */
  buildIdentity: string | null;
  /** True when durable lease owner matches the serving process. */
  durableOwnerMatch: boolean;
  /** Operator guidance when lease is not owned by this process. */
  leaseRetryGuidance: string | null;
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
