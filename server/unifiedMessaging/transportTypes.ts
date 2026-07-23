/**
 * Transport-neutral messaging types for Sunchaser unified inbox.
 *
 * Contracts only — no adapter implementations, no CRM/AI wiring, no provider SDKs.
 * Official Meta production path remains under server/whatsappTransport/ until a later phase.
 */

// ---------------------------------------------------------------------------
// Channel / transport identifiers
// ---------------------------------------------------------------------------

/** Canonical transport channel identifiers. Exhaustive for type narrowing. */
export const MESSAGING_TRANSPORTS = [
  "meta_whatsapp_cloud",
  "whatsapp_web_qr",
  "website_chat",
  "instagram",
  "messenger",
] as const;

export type MessagingTransport = (typeof MESSAGING_TRANSPORTS)[number];

export type TransportVisibility = "production" | "experimental";
export type TransportAudience = "customer_facing" | "internal_only";

export type TransportChannelDescriptor = {
  transport: MessagingTransport;
  /** Human-readable label for admin/diagnostics (not a secret). */
  label: string;
  visibility: TransportVisibility;
  audience: TransportAudience;
  /**
   * When true, the channel may be turned off independently without affecting
   * other transports. QR must always be independently disableable.
   */
  independentlyDisableable: boolean;
  /** Short classification for policy gates (no credentials). */
  classificationNotes: string;
};

/**
 * Static channel registry. QR is experimental, internal-only, and independently
 * disableable. No QR session handling is implemented in this module.
 */
export const TRANSPORT_CHANNEL_DESCRIPTORS: Readonly<
  Record<MessagingTransport, TransportChannelDescriptor>
> = {
  meta_whatsapp_cloud: {
    transport: "meta_whatsapp_cloud",
    label: "Official Meta WhatsApp Cloud API (Coexistence)",
    visibility: "production",
    audience: "customer_facing",
    independentlyDisableable: true,
    classificationNotes:
      "Official Meta Cloud API / Business App Coexistence path.",
  },
  whatsapp_web_qr: {
    transport: "whatsapp_web_qr",
    label: "Experimental WhatsApp Web QR",
    visibility: "experimental",
    audience: "internal_only",
    independentlyDisableable: true,
    classificationNotes:
      "Experimental internal-only QR transport. Independently disableable. No connector in this phase.",
  },
  website_chat: {
    transport: "website_chat",
    label: "Website chat",
    visibility: "production",
    audience: "customer_facing",
    independentlyDisableable: true,
    classificationNotes: "First-party website chat channel (future).",
  },
  instagram: {
    transport: "instagram",
    label: "Instagram Messaging",
    visibility: "production",
    audience: "customer_facing",
    independentlyDisableable: true,
    classificationNotes: "Meta Instagram messaging (future).",
  },
  messenger: {
    transport: "messenger",
    label: "Facebook Messenger",
    visibility: "production",
    audience: "customer_facing",
    independentlyDisableable: true,
    classificationNotes: "Meta Messenger (future).",
  },
};

export function isMessagingTransport(
  value: unknown
): value is MessagingTransport {
  return (
    typeof value === "string" &&
    (MESSAGING_TRANSPORTS as readonly string[]).includes(value)
  );
}

export function getTransportChannelDescriptor(
  transport: MessagingTransport
): TransportChannelDescriptor {
  return TRANSPORT_CHANNEL_DESCRIPTORS[transport];
}

export function isExperimentalInternalTransport(
  transport: MessagingTransport
): boolean {
  const d = TRANSPORT_CHANNEL_DESCRIPTORS[transport];
  return d.visibility === "experimental" && d.audience === "internal_only";
}

// ---------------------------------------------------------------------------
// Connection contracts
// ---------------------------------------------------------------------------

export const CONNECTION_STATES = [
  "unconfigured",
  "connecting",
  "awaiting_qr",
  "connected",
  "degraded",
  "reconnecting",
  "disconnected",
  "expired",
  "disabled",
  "failed",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const CONNECTION_HEALTH_STATES = [
  "unknown",
  "healthy",
  "degraded",
  "unhealthy",
] as const;

export type ConnectionHealthState = (typeof CONNECTION_HEALTH_STATES)[number];

export const CONNECTION_ERROR_CATEGORIES = [
  "none",
  "unauthorized",
  "forbidden",
  "signature_invalid",
  "disconnected",
  "session_expired",
  "capability_unsupported",
  "rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "provider_rejected",
  "media_failure",
  "credential_failure",
  "internal_failure",
  "invalid_request",
] as const;

export type ConnectionErrorCategory =
  (typeof CONNECTION_ERROR_CATEGORIES)[number];

/**
 * Opaque server-side reference to credentials. Resolvers live outside adapters.
 * Never serialize the resolved secret into browser-facing payloads.
 */
export type TransportSecretRef = {
  readonly kind: "secret_ref";
  readonly refId: string;
  readonly purpose:
    | "access_token"
    | "app_secret"
    | "verify_token"
    | "session_material"
    | "encryption_key"
    | "other";
};

/**
 * Non-secret transport metadata safe for admin diagnostics.
 * Explicitly excludes tokens, cookies, session blobs, and customer PII.
 */
export type SafeTransportMetadata = {
  /** Provider-facing connection / phone / page identifiers (masked or public IDs only). */
  providerAccountLabel?: string | null;
  providerAccountIdMasked?: string | null;
  phoneNumberIdMasked?: string | null;
  displayPhoneMasked?: string | null;
  wabaIdMasked?: string | null;
  /** Free-form non-secret flags (e.g. coexistence mode). */
  flags?: Readonly<Record<string, string | boolean | number | null>>;
};

export type BrowserSafeConnectionStatus = {
  connectionId: string;
  organizationId: string;
  transport: MessagingTransport;
  state: ConnectionState;
  health: ConnectionHealthState;
  lastSuccessfulActivityAt: string | null;
  lastErrorCategory: ConnectionErrorCategory;
  reconnectEligible: boolean;
  /** Channel classification for UI/policy (no secrets). */
  experimental: boolean;
  internalOnly: boolean;
  independentlyDisableable: boolean;
  transportMetadata: SafeTransportMetadata;
  /**
   * Safe summary for operators. Must never contain tokens, cookies,
   * session material, encryption keys, or customer PII.
   */
  safeErrorSummary: string | null;
};

/** Keys that must never appear on browser-safe connection status objects. */
export const FORBIDDEN_BROWSER_CONNECTION_FIELDS = [
  "accessToken",
  "access_token",
  "appSecret",
  "app_secret",
  "verifyToken",
  "verify_token",
  "cookie",
  "cookies",
  "session",
  "sessionBlob",
  "session_blob",
  "encryptionKey",
  "encryption_key",
  "refreshToken",
  "refresh_token",
  "password",
  "privateKey",
  "private_key",
  "secret",
  "credentials",
] as const;

export type ForbiddenBrowserConnectionField =
  (typeof FORBIDDEN_BROWSER_CONNECTION_FIELDS)[number];

// ---------------------------------------------------------------------------
// Identity references (no raw PII payloads)
// ---------------------------------------------------------------------------

export type MessagingIdentityKind =
  | "customer_contact"
  | "staff_user"
  | "ai_agent"
  | "bot_flow"
  | "system"
  | "broadcast_sender"
  | "external_provider";

/**
 * Opaque identity reference. Adapters resolve provider handles into refs;
 * CRM linking happens above the adapter boundary.
 */
export type MessagingIdentityRef = {
  kind: MessagingIdentityKind;
  /** Internal opaque id (contact id, user id, system sentinel). */
  id: string;
  /** Optional provider-side handle hash/id — never a full unredacted phone in browser DTOs. */
  externalHandleRef?: string | null;
};

// ---------------------------------------------------------------------------
// Normalized message contract
// ---------------------------------------------------------------------------

export const MESSAGE_TYPES = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "interactive",
  "template",
  "location",
  "reaction",
  "system",
] as const;

export type NormalizedMessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_ORIGINS = [
  "customer",
  "human",
  "ai",
  "bot_flow",
  "system",
  "broadcast",
] as const;

export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/**
 * Delivery statuses compatible with current official Meta characterization:
 * sent, delivered, read, failed — plus transport-neutral queued/sending/received.
 */
export const DELIVERY_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Meta-compatible delivery subset used by the official WhatsApp baseline. */
export const META_COMPAT_DELIVERY_STATUSES = [
  "sent",
  "delivered",
  "read",
  "failed",
] as const;

export type MetaCompatDeliveryStatus =
  (typeof META_COMPAT_DELIVERY_STATUSES)[number];

export const PROCESSING_STATUSES = [
  "pending",
  "processing",
  "processed",
  "duplicate",
  "rejected",
  "failed",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/**
 * Controlled structured content. Prefer typed shapes over unrestricted
 * provider dumps. Raw provider payloads are never the primary record.
 */
export type NormalizedStructuredContent =
  | { kind: "none" }
  | {
      kind: "media_ref";
      mediaId: string;
      mimeType?: string | null;
      filename?: string | null;
      caption?: string | null;
      sha256?: string | null;
      voice?: boolean;
    }
  | {
      kind: "location";
      latitude: number;
      longitude: number;
      address?: string | null;
      placeName?: string | null;
    }
  | {
      kind: "template";
      templateName: string;
      languageCode?: string | null;
      /** Parameter labels only — not free-form customer PII dumps. */
      parameterKeys?: readonly string[];
    }
  | {
      kind: "interactive";
      interactiveType: string;
      title?: string | null;
    }
  | {
      kind: "reaction";
      emoji: string;
      targetExternalMessageId: string;
    }
  | {
      kind: "system";
      systemCode: string;
      summary: string;
    };

/** Safe/redacted provider metadata — never unrestricted raw envelopes. */
export type SafeProviderMetadata = Readonly<
  Record<string, string | number | boolean | null>
>;

export type NormalizedMessage = {
  messageId: string;
  organizationId: string;
  conversationId: string;
  connectionId: string;
  transport: MessagingTransport;
  externalMessageId: string | null;
  direction: MessageDirection;
  sender: MessagingIdentityRef;
  recipient: MessagingIdentityRef;
  messageType: NormalizedMessageType;
  text: string | null;
  structuredContent: NormalizedStructuredContent;
  replyToMessageId: string | null;
  clientIdempotencyKey: string | null;
  providerTimestamp: string | null;
  receivedAt: string;
  createdAt: string;
  processingStatus: ProcessingStatus;
  deliveryStatus: DeliveryStatus;
  origin: MessageOrigin;
  aiRunRef: string | null;
  providerMetadata: SafeProviderMetadata;
};

// ---------------------------------------------------------------------------
// Normalized events
// ---------------------------------------------------------------------------

export const MESSAGING_EVENT_KINDS = [
  "inbound_message_received",
  "outbound_message_requested",
  "outbound_message_accepted",
  "outbound_message_failed",
  "delivery_status_updated",
  "connection_status_changed",
  "media_received",
  "transport_diagnostic",
] as const;

export type MessagingEventKind = (typeof MESSAGING_EVENT_KINDS)[number];

type MessagingEventBase = {
  eventId: string;
  transport: MessagingTransport;
  connectionId: string;
  occurredAt: string;
  /** Stable deduplication identity (payload hash, provider event id, etc.). */
  dedupeKey: string;
  metadata: SafeProviderMetadata;
};

export type InboundMessageReceivedEvent = MessagingEventBase & {
  kind: "inbound_message_received";
  message: NormalizedMessage;
};

export type OutboundMessageRequestedEvent = MessagingEventBase & {
  kind: "outbound_message_requested";
  conversationId: string;
  idempotencyKey: string;
  messageType: NormalizedMessageType;
};

export type OutboundMessageAcceptedEvent = MessagingEventBase & {
  kind: "outbound_message_accepted";
  messageId: string;
  externalMessageId: string | null;
  deliveryStatus: DeliveryStatus;
};

export type OutboundMessageFailedEvent = MessagingEventBase & {
  kind: "outbound_message_failed";
  messageId: string | null;
  idempotencyKey: string;
  errorCategory: ConnectionErrorCategory;
  safeMessage: string;
  retryable: boolean;
};

export type DeliveryStatusUpdatedEvent = MessagingEventBase & {
  kind: "delivery_status_updated";
  messageId: string | null;
  externalMessageId: string;
  deliveryStatus: MetaCompatDeliveryStatus | DeliveryStatus;
  statusTimestamp: string;
};

export type ConnectionStatusChangedEvent = MessagingEventBase & {
  kind: "connection_status_changed";
  status: BrowserSafeConnectionStatus;
  previousState: ConnectionState | null;
};

export type MediaReceivedEvent = MessagingEventBase & {
  kind: "media_received";
  messageId: string;
  mediaId: string;
  mimeType: string | null;
};

export type TransportDiagnosticEvent = MessagingEventBase & {
  kind: "transport_diagnostic";
  code: string;
  severity: "info" | "warn" | "error";
  safeMessage: string;
};

export type NormalizedMessagingEvent =
  | InboundMessageReceivedEvent
  | OutboundMessageRequestedEvent
  | OutboundMessageAcceptedEvent
  | OutboundMessageFailedEvent
  | DeliveryStatusUpdatedEvent
  | ConnectionStatusChangedEvent
  | MediaReceivedEvent
  | TransportDiagnosticEvent;

// ---------------------------------------------------------------------------
// Outbound request envelopes (gateway → adapter)
// ---------------------------------------------------------------------------

export type OutboundSendRequest = {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  /** Required for all outbound adapter operations. */
  idempotencyKey: string;
  to: MessagingIdentityRef;
  messageType: NormalizedMessageType;
  text?: string | null;
  structuredContent?: NormalizedStructuredContent;
  replyToMessageId?: string | null;
  origin: MessageOrigin;
  aiRunRef?: string | null;
  signal?: AbortSignal;
};

export type OutboundTemplateSendRequest = {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  idempotencyKey: string;
  to: MessagingIdentityRef;
  templateName: string;
  languageCode: string;
  /** Parameter keys only at the contract layer; values resolved server-side. */
  parameterKeys?: readonly string[];
  origin: MessageOrigin;
  signal?: AbortSignal;
};

export type MediaDownloadRequest = {
  connectionId: string;
  mediaId: string;
  signal?: AbortSignal;
};

export type MediaUploadRequest = {
  connectionId: string;
  mimeType: string;
  filename?: string | null;
  /** Opaque byte source handled server-side — not a browser secret store. */
  byteLength: number;
  signal?: AbortSignal;
};

export type InboundVerificationRequest = {
  connectionId: string;
  /** Raw request bytes or challenge parameters — adapter-specific. */
  headers: Readonly<Record<string, string | undefined>>;
  rawBody?: Uint8Array;
  query?: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
};

export type InboundNormalizationRequest = {
  connectionId: string;
  headers: Readonly<Record<string, string | undefined>>;
  rawBody: Uint8Array;
  /** Precomputed dedupe identity (e.g. payload hash). */
  dedupeKey: string;
  signal?: AbortSignal;
};

export type StatusNormalizationRequest = {
  connectionId: string;
  providerPayload: SafeProviderMetadata;
  externalMessageId: string;
  providerStatus: string;
  statusTimestamp: string | null;
  signal?: AbortSignal;
};

export type IdentityResolveRequest = {
  connectionId: string;
  transport: MessagingTransport;
  externalHandle: string;
  signal?: AbortSignal;
};
