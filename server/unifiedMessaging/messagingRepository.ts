/**
 * Gateway-facing persistence contract for normalized messaging tables.
 *
 * Interface / types only — no Supabase wiring, no CRM/AI/provider SDKs.
 * Task 5B: WhatsApp runtime dual-writes through MessagingRepository when
 * UNIFIED_MESSAGING_POSTGRES_ENABLED is set; whatsapp_* remains inbox-authoritative.
 */
import type {
  NormalizedMessage,
  NormalizedStructuredContent,
  SafeProviderMetadata,
  MessagingTransport,
  MessageDirection,
  MessageOrigin,
  NormalizedMessageType,
  ProcessingStatus,
  DeliveryStatus,
} from "./transportTypes.ts";
import type {
  AttachmentScanStatus,
  AuditActorType,
  AutomationMode,
  ConsentStatus,
  ConversationStatus,
  OutboxStatus,
  StatusEventStatus,
} from "./messagingSchemaTypes.ts";

export type IdempotentOutcome<T> =
  | { kind: "created"; row: T }
  | { kind: "existing"; row: T };

export type MessagingContactRow = {
  id: string;
  organizationId: string;
  displayName: string | null;
  primaryPhoneNormalized: string | null;
  city: string | null;
  area: string | null;
  customerType: string | null;
  consentStatus: ConsentStatus;
  createdAt: string;
  updatedAt: string;
};

export type MessagingContactIdentityRow = {
  id: string;
  organizationId: string;
  contactId: string;
  transportType: MessagingTransport;
  connectionId: string;
  externalUserId: string;
  normalizedAddress: string | null;
  displayMetadata: SafeProviderMetadata;
  createdAt: string;
  updatedAt: string;
};

export type MessagingConversationRow = {
  id: string;
  organizationId: string;
  contactId: string;
  connectionId: string;
  transportType: MessagingTransport;
  status: ConversationStatus;
  assignedUserId: string | null;
  automationMode: AutomationMode;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MessagingAttachmentRow = {
  id: string;
  organizationId: string;
  messageId: string;
  /** Private object storage key — never a permanent public URL. */
  objectKey: string;
  mediaType: string;
  originalFilenameSafe: string | null;
  sizeBytes: number;
  sha256: string;
  scanStatus: AttachmentScanStatus;
  createdAt: string;
};

export type MessagingStatusEventRow = {
  id: string;
  organizationId: string;
  messageId: string;
  status: StatusEventStatus;
  externalStatusId: string | null;
  occurredAt: string;
  errorCategory: string | null;
  diagnostics: SafeProviderMetadata;
  createdAt: string;
};

export type MessagingAssignmentRow = {
  id: string;
  organizationId: string;
  conversationId: string;
  assignedTo: string;
  assignedBy: string;
  reason: string | null;
  startedAt: string;
  endedAt: string | null;
};

export type MessagingOutboxRow = {
  id: string;
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: SafeProviderMetadata;
  idempotencyKey: string;
  status: OutboxStatus;
  attemptCount: number;
  availableAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastErrorCategory: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type MessagingAuditLogRow = {
  id: string;
  organizationId: string;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: SafeProviderMetadata;
  occurredAt: string;
};

export type UpsertContactIdentityInput = {
  organizationId: string;
  contact: {
    id?: string;
    displayName?: string | null;
    primaryPhoneNormalized?: string | null;
    city?: string | null;
    area?: string | null;
    customerType?: string | null;
    consentStatus?: ConsentStatus;
  };
  identity: {
    id?: string;
    transportType: MessagingTransport;
    connectionId: string;
    externalUserId: string;
    normalizedAddress?: string | null;
    displayMetadata?: SafeProviderMetadata;
  };
};

export type FindOrCreateConversationInput = {
  organizationId: string;
  contactId: string;
  connectionId: string;
  transportType: MessagingTransport;
  status?: ConversationStatus;
  automationMode?: AutomationMode;
};

export type PersistInboundMessageInput = {
  organizationId: string;
  conversationId: string;
  connectionId: string;
  transportType: MessagingTransport;
  externalMessageId: string;
  senderIdentityId?: string | null;
  recipientIdentityId?: string | null;
  messageType: NormalizedMessageType;
  normalizedText?: string | null;
  structuredContent?: NormalizedStructuredContent;
  replyToMessageId?: string | null;
  providerTimestamp?: string | null;
  receivedAt?: string | null;
  origin?: MessageOrigin;
  providerMetadata?: SafeProviderMetadata;
};

export type CreateOutboundMessageInput = {
  organizationId: string;
  conversationId: string;
  connectionId: string;
  transportType: MessagingTransport;
  clientIdempotencyKey: string;
  senderIdentityId?: string | null;
  recipientIdentityId?: string | null;
  messageType: NormalizedMessageType;
  normalizedText?: string | null;
  structuredContent?: NormalizedStructuredContent;
  replyToMessageId?: string | null;
  origin: MessageOrigin;
  aiRunId?: string | null;
  providerMetadata?: SafeProviderMetadata;
  deliveryStatus?: DeliveryStatus;
  processingStatus?: ProcessingStatus;
};

export type AppendStatusEventInput = {
  organizationId: string;
  messageId: string;
  status: StatusEventStatus;
  externalStatusId?: string | null;
  occurredAt: string;
  errorCategory?: string | null;
  diagnostics?: SafeProviderMetadata;
};

export type AddAttachmentReferenceInput = {
  organizationId: string;
  messageId: string;
  objectKey: string;
  mediaType: string;
  originalFilenameSafe?: string | null;
  sizeBytes: number;
  sha256: string;
  scanStatus?: AttachmentScanStatus;
};

export type RecordAssignmentInput = {
  organizationId: string;
  conversationId: string;
  assignedTo: string;
  assignedBy: string;
  reason?: string | null;
  startedAt?: string;
  /** When recording a handoff, optionally close the previous open assignment. */
  endPreviousOpen?: boolean;
};

export type EnqueueOutboxEventInput = {
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload?: SafeProviderMetadata;
  idempotencyKey: string;
  availableAt?: string;
};

export type AppendAuditEventInput = {
  organizationId: string;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: SafeProviderMetadata;
  occurredAt?: string;
};

export type FindMessageByExternalIdInput = {
  organizationId: string;
  connectionId: string;
  transportType: MessagingTransport;
  externalMessageId: string;
};

export type ClaimOutboundSendInput = {
  organizationId: string;
  messageId: string;
};

export type ClaimOutboundSendResult =
  | { kind: "claimed"; row: NormalizedMessage }
  | { kind: "in_flight"; row: NormalizedMessage }
  | { kind: "completed"; row: NormalizedMessage }
  /** Terminal / uncertain — do not auto-resend with the same key. */
  | { kind: "terminal"; row: NormalizedMessage };

export type BindOutboundLegacyMessageInput = {
  organizationId: string;
  messageId: string;
  whatsappMessageId: string;
};

/**
 * Normalized messaging persistence port.
 *
 * Implementations must:
 * - Scope every query by organizationId
 * - Return explicit created vs existing for idempotent writes
 * - Never accept CRM repositories, AI clients, or provider SDKs as dependencies
 * - Never expose credentials or unrestricted raw provider payloads
 */
export type MessagingRepository = {
  upsertContactIdentity(
    input: UpsertContactIdentityInput
  ): Promise<{
    contact: IdempotentOutcome<MessagingContactRow>;
    identity: IdempotentOutcome<MessagingContactIdentityRow>;
  }>;

  findOrCreateConversation(
    input: FindOrCreateConversationInput
  ): Promise<IdempotentOutcome<MessagingConversationRow>>;

  persistInboundMessage(
    input: PersistInboundMessageInput
  ): Promise<IdempotentOutcome<NormalizedMessage>>;

  createOutboundMessage(
    input: CreateOutboundMessageInput
  ): Promise<IdempotentOutcome<NormalizedMessage>>;

  /**
   * Atomically claim a queued outbound message for Meta send.
   * Only one winner across instances may transition pending/queued → processing/sending.
   */
  claimOutboundMessageForSend(
    input: ClaimOutboundSendInput
  ): Promise<ClaimOutboundSendResult>;

  /** Bind legacy whatsapp_messages.id for Inbox-compatible replays. */
  bindOutboundLegacyMessageId(
    input: BindOutboundLegacyMessageInput
  ): Promise<NormalizedMessage>;

  findMessageByExternalId(
    input: FindMessageByExternalIdInput
  ): Promise<NormalizedMessage | null>;

  appendStatusEvent(
    input: AppendStatusEventInput
  ): Promise<IdempotentOutcome<MessagingStatusEventRow>>;

  addAttachmentReference(
    input: AddAttachmentReferenceInput
  ): Promise<MessagingAttachmentRow>;

  recordAssignment(
    input: RecordAssignmentInput
  ): Promise<MessagingAssignmentRow>;

  enqueueOutboxEvent(
    input: EnqueueOutboxEventInput
  ): Promise<IdempotentOutcome<MessagingOutboxRow>>;

  appendAuditEvent(input: AppendAuditEventInput): Promise<MessagingAuditLogRow>;
};

/** Type-level guard: repository deps must not grow CRM/AI/provider surfaces. */
export type MessagingRepositoryDeps = {
  /** Opaque clock for tests / future wiring. */
  now?: () => Date;
};

export type AssertNoForbiddenRepoDeps<T> = T extends {
  crm?: unknown;
  crmRepository?: unknown;
  ai?: unknown;
  aiClient?: unknown;
  graphClient?: unknown;
  whatsappRepository?: unknown;
}
  ? never
  : T;

export type SafeMessagingRepositoryDeps =
  AssertNoForbiddenRepoDeps<MessagingRepositoryDeps>;

/** Helper for documenting direction on persisted rows. */
export type PersistedMessageDirection = MessageDirection;
