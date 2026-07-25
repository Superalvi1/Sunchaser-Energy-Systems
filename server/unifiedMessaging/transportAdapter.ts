/**
 * Conceptual transport adapter contract.
 *
 * Boundaries (enforced by design of this interface):
 * - No CRM repository parameters
 * - No AI client parameters
 * - No direct conversation/lead table writes
 * - Credentials via opaque TransportSecretResolver only
 * - Results are normalized data/events for a future messaging gateway
 * - Browser-facing status never includes secrets
 */
import type { TransportCapabilitySet } from "./transportCapabilities.ts";
import type { TransportResult } from "./transportErrors.ts";
import type {
  BrowserSafeConnectionStatus,
  DeliveryStatusUpdatedEvent,
  IdentityResolveRequest,
  InboundNormalizationRequest,
  InboundVerificationRequest,
  MediaDownloadRequest,
  MediaUploadRequest,
  MessagingIdentityRef,
  MessagingTransport,
  NormalizedMessage,
  NormalizedMessagingEvent,
  OutboundSendRequest,
  OutboundTemplateSendRequest,
  StatusNormalizationRequest,
  TransportSecretRef,
} from "./transportTypes.ts";

/**
 * Opaque server-side secret resolver. Adapters request secrets by reference;
 * resolved values must never be returned on browser-safe DTOs.
 */
export type TransportSecretResolver = {
  resolve(
    ref: TransportSecretRef,
    options?: { signal?: AbortSignal }
  ): Promise<string>;
};

export type TransportConnectInput = {
  organizationId: string;
  connectionId: string;
  /** Opaque refs only — never raw tokens in this envelope. */
  secretRefs?: readonly TransportSecretRef[];
  signal?: AbortSignal;
};

export type TransportDisconnectInput = {
  organizationId: string;
  connectionId: string;
  signal?: AbortSignal;
};

export type TransportReconnectInput = {
  organizationId: string;
  connectionId: string;
  secretRefs?: readonly TransportSecretRef[];
  signal?: AbortSignal;
};

export type TransportHealthCheckResult = {
  transport: MessagingTransport;
  connectionId: string;
  healthy: boolean;
  checkedAt: string;
  safeDetails: string | null;
};

export type InboundVerificationResult =
  | {
      kind: "challenge_response";
      statusCode: number;
      bodyText: string;
      contentType?: string;
    }
  | {
      kind: "accepted";
      statusCode: number;
    }
  | {
      kind: "rejected";
      statusCode: number;
      reason: string;
    };

export type MediaDownloadResult = {
  mediaId: string;
  mimeType: string | null;
  byteLength: number;
  /** Server-local handle only — not a browser-stored credential. */
  storageRef: string;
};

export type MediaUploadResult = {
  mediaId: string;
  mimeType: string | null;
};

/**
 * MessagingTransportAdapter — interchangeable provider boundary.
 *
 * Implementations must not accept CRM repositories or AI clients.
 * Persistence and lead creation belong in the messaging gateway / services layer.
 */
export type MessagingTransportAdapter = {
  readonly transport: MessagingTransport;

  connect(
    input: TransportConnectInput
  ): Promise<TransportResult<BrowserSafeConnectionStatus>>;

  disconnect(
    input: TransportDisconnectInput
  ): Promise<TransportResult<BrowserSafeConnectionStatus>>;

  reconnect(
    input: TransportReconnectInput
  ): Promise<TransportResult<BrowserSafeConnectionStatus>>;

  getConnectionStatus(input: {
    organizationId: string;
    connectionId: string;
    signal?: AbortSignal;
  }): Promise<TransportResult<BrowserSafeConnectionStatus>>;

  getCapabilities(input: {
    connectionId: string;
    signal?: AbortSignal;
  }): Promise<TransportResult<TransportCapabilitySet>>;

  verifyInboundRequest(
    input: InboundVerificationRequest
  ): Promise<TransportResult<InboundVerificationResult>>;

  normalizeInbound(
    input: InboundNormalizationRequest
  ): Promise<TransportResult<readonly NormalizedMessagingEvent[]>>;

  /**
   * Outbound send. Callers must supply idempotencyKey on the request.
   * Unsupported capabilities must fail via TransportContractError before dispatch.
   */
  sendMessage(
    input: OutboundSendRequest
  ): Promise<TransportResult<NormalizedMessage>>;

  sendTemplate(
    input: OutboundTemplateSendRequest
  ): Promise<TransportResult<NormalizedMessage>>;

  downloadMedia(
    input: MediaDownloadRequest
  ): Promise<TransportResult<MediaDownloadResult>>;

  uploadMedia(
    input: MediaUploadRequest
  ): Promise<TransportResult<MediaUploadResult>>;

  normalizeStatus(
    input: StatusNormalizationRequest
  ): Promise<TransportResult<DeliveryStatusUpdatedEvent>>;

  resolveIdentity(
    input: IdentityResolveRequest
  ): Promise<TransportResult<MessagingIdentityRef>>;

  healthCheck(input: {
    connectionId: string;
    signal?: AbortSignal;
  }): Promise<TransportResult<TransportHealthCheckResult>>;
};

/**
 * Optional constructor deps for future adapters.
 * Intentionally excludes CRM repositories and AI clients.
 */
export type MessagingTransportAdapterDeps = {
  secrets: TransportSecretResolver;
  /** Optional clock injection for tests. */
  now?: () => Date;
};

/** Type-level guard: adapter deps must not grow CRM/AI surfaces accidentally. */
export type AssertNoCrmOrAiDeps<T> = T extends {
  crm?: unknown;
  crmRepository?: unknown;
  ai?: unknown;
  aiClient?: unknown;
  leadRepository?: unknown;
  conversationRepository?: unknown;
}
  ? never
  : T;

export type SafeAdapterDeps = AssertNoCrmOrAiDeps<MessagingTransportAdapterDeps>;
