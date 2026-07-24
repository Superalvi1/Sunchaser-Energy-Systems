/**
 * WhatsApp ↔ normalized messaging dual-write bridge (Task 5B).
 *
 * Authoritative repositories during this migration stage:
 * - CRM Inbox UI reads/writes: whatsapp_* via WhatsAppRepository (authoritative for inbox).
 * - Normalized transport persistence: messaging_* via MessagingRepository when
 *   UNIFIED_MESSAGING_POSTGRES_ENABLED is on (authoritative for transport idempotency).
 *
 * Dual-write is explicit and required when the feature is enabled. A normalized
 * write failure is NOT swallowed — callers must fail the request so Meta/clients retry.
 *
 * Does not call Meta, CRM, or AI. Does not create a second WhatsApp HTTP runtime.
 */
import { createHash } from "node:crypto";
import type { MessagingRepository } from "../unifiedMessaging/messagingRepository.ts";
import {
  MESSAGING_TRUSTED_ORGANIZATION_ID,
  trustedMetaConnectionId,
} from "../unifiedMessaging/messagingRuntimeConfig.ts";
import { logMessagingRuntime } from "../unifiedMessaging/messagingRuntimeLog.ts";
import { isMessagingRepositoryError } from "../unifiedMessaging/messagingRepositoryErrors.ts";
import type {
  DeliveryStatus,
  NormalizedMessage,
  NormalizedMessageType,
  NormalizedStructuredContent,
  SafeProviderMetadata,
} from "../unifiedMessaging/transportTypes.ts";
import type { StatusEventStatus } from "../unifiedMessaging/messagingSchemaTypes.ts";
import type { NormalizedWebhookEvent } from "./whatsappEnvelope.ts";
import type { WhatsAppConfig } from "./whatsappConfig.ts";

export type WhatsAppMessagingBridge = {
  organizationId: string;
  connectionId: string;
  repository: MessagingRepository;
};

export type BridgeInboundResult = {
  message: NormalizedMessage;
  duplicate: boolean;
};

export type BridgeOutboundPrepareResult =
  | {
      kind: "created";
      message: NormalizedMessage;
    }
  | {
      kind: "existing_incomplete";
      message: NormalizedMessage;
    }
  | {
      kind: "existing_complete";
      message: NormalizedMessage;
      providerMessageId: string | null;
    };

const COMPLETED_DELIVERY: ReadonlySet<DeliveryStatus> = new Set([
  "sent",
  "delivered",
  "read",
]);

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function mapMessageType(raw: string | undefined): NormalizedMessageType {
  switch ((raw ?? "text").toLowerCase()) {
    case "text":
      return "text";
    case "image":
      return "image";
    case "audio":
    case "voice":
      return "audio";
    case "video":
      return "video";
    case "document":
      return "document";
    case "location":
      return "location";
    case "reaction":
      return "reaction";
    case "interactive":
      return "interactive";
    case "template":
      return "template";
    default:
      return "system";
  }
}

function buildStructuredContent(event: {
  messageType?: string;
  metaMediaId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  caption?: string | null;
  sha256?: string | null;
  voice?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  placeName?: string | null;
}): NormalizedStructuredContent {
  const type = mapMessageType(event.messageType);
  if (type === "location" && event.latitude != null && event.longitude != null) {
    return {
      kind: "location",
      latitude: event.latitude,
      longitude: event.longitude,
      address: event.address ?? null,
      placeName: event.placeName ?? null,
    };
  }
  if (
    (type === "image" ||
      type === "audio" ||
      type === "video" ||
      type === "document") &&
    event.metaMediaId
  ) {
    return {
      kind: "media_ref",
      mediaId: event.metaMediaId,
      mimeType: event.mimeType ?? null,
      filename: event.filename ?? null,
      caption: event.caption ?? null,
      sha256: event.sha256 ?? null,
      voice: event.voice ?? undefined,
    };
  }
  if (type === "system") {
    return {
      kind: "system",
      systemCode: "unsupported_or_unknown",
      summary: "Unsupported or unknown inbound WhatsApp message type",
    };
  }
  return { kind: "none" };
}

function safeProviderMeta(input: {
  messageType?: string;
  hasMedia?: boolean;
}): SafeProviderMetadata {
  return {
    messageType: input.messageType ?? "text",
    hasMedia: input.hasMedia === true,
  };
}

function persistenceError(err: unknown): { code: string; detail?: string } {
  if (isMessagingRepositoryError(err)) {
    return { code: err.code, detail: err.detail };
  }
  return { code: "database_failure" };
}

/**
 * Create a bridge bound to trusted org + Meta connection from server config.
 * Returns null when messaging repository is not wired.
 */
export function createWhatsAppMessagingBridge(input: {
  repository: MessagingRepository | null | undefined;
  config: Pick<WhatsAppConfig, "phoneNumberId">;
  organizationId?: string;
}): WhatsAppMessagingBridge | null {
  if (!input.repository) return null;
  const phoneNumberId = input.config.phoneNumberId?.trim();
  if (!phoneNumberId) {
    throw new Error(
      "Normalized messaging requires trusted WHATSAPP_PHONE_NUMBER_ID"
    );
  }
  return {
    organizationId: input.organizationId ?? MESSAGING_TRUSTED_ORGANIZATION_ID,
    connectionId: trustedMetaConnectionId(phoneNumberId),
    repository: input.repository,
  };
}

/**
 * Dual-write inbound customer message into messaging_*.
 * Caller must already have verified signature and persisted whatsapp_* rows.
 */
export async function bridgePersistInboundMessage(
  bridge: WhatsAppMessagingBridge,
  event: Extract<
    NormalizedWebhookEvent,
    { kind: "inbound_text" | "inbound_message" }
  >
): Promise<BridgeInboundResult> {
  const { repository, organizationId, connectionId } = bridge;
  try {
    const upserted = await repository.upsertContactIdentity({
      organizationId,
      contact: {
        displayName: event.profileName ?? null,
        primaryPhoneNormalized: event.fromWaId,
      },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId,
        externalUserId: event.fromWaId,
        normalizedAddress: event.fromWaId,
        displayMetadata: { source: "meta_webhook" },
      },
    });

    const conversation = await repository.findOrCreateConversation({
      organizationId,
      contactId: upserted.contact.row.id,
      connectionId,
      transportType: "meta_whatsapp_cloud",
      status: "open",
      automationMode: "human_handling",
    });

    const messageType =
      event.kind === "inbound_text"
        ? "text"
        : mapMessageType(event.messageType);
    const textBody =
      event.kind === "inbound_text" ? event.text : event.textBody ?? null;
    const structuredContent = buildStructuredContent({
      messageType: event.kind === "inbound_text" ? "text" : event.messageType,
      metaMediaId: event.metaMediaId,
      mimeType: event.mimeType,
      filename: event.filename,
      caption: event.caption,
      sha256: event.sha256,
      voice: event.voice,
      latitude: event.latitude,
      longitude: event.longitude,
      address: event.address,
      placeName: event.placeName,
    });

    const persisted = await repository.persistInboundMessage({
      organizationId,
      conversationId: conversation.row.id,
      connectionId,
      transportType: "meta_whatsapp_cloud",
      externalMessageId: event.waMessageId,
      senderIdentityId: upserted.identity.row.id,
      messageType,
      normalizedText: textBody,
      structuredContent,
      providerTimestamp: event.occurredAt,
      receivedAt: event.occurredAt,
      origin: "customer",
      providerMetadata: safeProviderMeta({
        messageType,
        hasMedia: Boolean(event.metaMediaId),
      }),
    });

    if (
      persisted.kind === "created" &&
      event.metaMediaId &&
      event.sha256 &&
      event.mimeType
    ) {
      const objectKey = `meta/${organizationId}/${connectionId}/${event.metaMediaId}`;
      await repository.addAttachmentReference({
        organizationId,
        messageId: persisted.row.messageId,
        objectKey,
        mediaType: event.mimeType,
        originalFilenameSafe: event.filename ?? null,
        sizeBytes: 0,
        sha256: event.sha256,
        scanStatus: "pending",
      });
    }

    await repository.appendAuditEvent({
      organizationId,
      actorType: "system",
      actorId: "whatsapp-webhook",
      action:
        persisted.kind === "created"
          ? "inbound.message.persisted"
          : "inbound.message.duplicate",
      targetType: "message",
      targetId: persisted.row.messageId,
      metadata: {
        conversationId: conversation.row.id,
        duplicate: persisted.kind === "existing",
      },
    });

    logMessagingRuntime({
      event:
        persisted.kind === "created" ? "inbound_persisted" : "inbound_duplicate",
      organizationId,
      connectionId,
      conversationId: conversation.row.id,
      messageId: persisted.row.messageId,
      externalMessageId: event.waMessageId,
    });

    return {
      message: persisted.row,
      duplicate: persisted.kind === "existing",
    };
  } catch (err) {
    const mapped = persistenceError(err);
    logMessagingRuntime({
      event: "normalized_persistence_failed",
      organizationId,
      connectionId,
      externalMessageId: event.waMessageId,
      code: mapped.code,
      detail: mapped.detail,
    });
    throw err;
  }
}

/**
 * Dual-write inbound delivery status when the normalized message is known.
 * Missing normalized message is a soft skip (whatsapp_* remains source of truth for inbox).
 */
export async function bridgePersistInboundStatus(
  bridge: WhatsAppMessagingBridge,
  event: Extract<NormalizedWebhookEvent, { kind: "status" }>,
  messagingMessageId: string | null
): Promise<void> {
  if (!messagingMessageId) return;
  const status = mapStatus(event.status);
  if (!status) return;
  const { repository, organizationId, connectionId } = bridge;
  try {
    await repository.appendStatusEvent({
      organizationId,
      messageId: messagingMessageId,
      status,
      externalStatusId: `${event.waMessageId}:${event.status}:${event.statusTimestamp}`,
      occurredAt: event.statusTimestamp,
      diagnostics: { source: "meta_status_webhook" },
    });
  } catch (err) {
    const mapped = persistenceError(err);
    logMessagingRuntime({
      event: "normalized_persistence_failed",
      organizationId,
      connectionId,
      messageId: messagingMessageId,
      code: mapped.code,
      detail: mapped.detail,
    });
    throw err;
  }
}

function mapStatus(raw: string): StatusEventStatus | null {
  switch (raw) {
    case "sent":
    case "delivered":
    case "read":
    case "failed":
      return raw;
    default:
      return null;
  }
}

/**
 * Create or resume a normalized outbound message before Meta is called.
 * existing_complete ⇒ do not call Meta again.
 */
export async function bridgePrepareOutboundMessage(
  bridge: WhatsAppMessagingBridge,
  input: {
    recipientWaId: string;
    text: string;
    clientIdempotencyKey: string;
    actorId: string;
  }
): Promise<BridgeOutboundPrepareResult> {
  const { repository, organizationId, connectionId } = bridge;
  try {
    const upserted = await repository.upsertContactIdentity({
      organizationId,
      contact: {
        primaryPhoneNormalized: input.recipientWaId,
      },
      identity: {
        transportType: "meta_whatsapp_cloud",
        connectionId,
        externalUserId: input.recipientWaId,
        normalizedAddress: input.recipientWaId,
      },
    });

    const conversation = await repository.findOrCreateConversation({
      organizationId,
      contactId: upserted.contact.row.id,
      connectionId,
      transportType: "meta_whatsapp_cloud",
      status: "open",
      automationMode: "human_handling",
    });

    const created = await repository.createOutboundMessage({
      organizationId,
      conversationId: conversation.row.id,
      connectionId,
      transportType: "meta_whatsapp_cloud",
      clientIdempotencyKey: input.clientIdempotencyKey,
      recipientIdentityId: upserted.identity.row.id,
      messageType: "text",
      normalizedText: input.text,
      structuredContent: { kind: "none" },
      origin: "human",
      deliveryStatus: "queued",
      processingStatus: "pending",
      providerMetadata: { actorId: input.actorId },
    });

    if (created.kind === "existing") {
      const complete = COMPLETED_DELIVERY.has(created.row.deliveryStatus);
      const providerMessageId =
        created.row.externalMessageId ??
        (typeof created.row.providerMetadata.providerMessageId === "string"
          ? created.row.providerMetadata.providerMessageId
          : null);
      logMessagingRuntime({
        event: "outbound_duplicate",
        organizationId,
        connectionId,
        conversationId: conversation.row.id,
        messageId: created.row.messageId,
        clientIdempotencyKeyHash: hashKey(input.clientIdempotencyKey),
      });
      if (complete) {
        return {
          kind: "existing_complete",
          message: created.row,
          providerMessageId,
        };
      }
      return { kind: "existing_incomplete", message: created.row };
    }

    logMessagingRuntime({
      event: "outbound_created",
      organizationId,
      connectionId,
      conversationId: conversation.row.id,
      messageId: created.row.messageId,
      clientIdempotencyKeyHash: hashKey(input.clientIdempotencyKey),
    });
    return { kind: "created", message: created.row };
  } catch (err) {
    const mapped = persistenceError(err);
    logMessagingRuntime({
      event: "normalized_persistence_failed",
      organizationId,
      connectionId,
      clientIdempotencyKeyHash: hashKey(input.clientIdempotencyKey),
      code: mapped.code,
      detail: mapped.detail,
    });
    throw err;
  }
}

/**
 * Record provider acceptance/failure on the normalized message.
 * Updates delivery_status via appendStatusEvent side-effect in the repository.
 */
export async function bridgeRecordOutboundProviderResult(
  bridge: WhatsAppMessagingBridge,
  input: {
    messageId: string;
    outcome: "accepted" | "failed" | "timeout";
    providerMessageId?: string | null;
    errorCategory?: string | null;
  }
): Promise<void> {
  const { repository, organizationId, connectionId } = bridge;
  const occurredAt = new Date().toISOString();
  const status: StatusEventStatus =
    input.outcome === "accepted" ? "sent" : "failed";
  const diagnostics: SafeProviderMetadata = {
    outcome: input.outcome,
    ...(input.providerMessageId
      ? { providerMessageId: input.providerMessageId }
      : {}),
  };
  try {
    await repository.appendStatusEvent({
      organizationId,
      messageId: input.messageId,
      status,
      externalStatusId: input.providerMessageId
        ? `provider:${input.providerMessageId}:${status}`
        : `provider:${input.messageId}:${input.outcome}:${occurredAt}`,
      occurredAt,
      errorCategory:
        input.outcome === "accepted"
          ? null
          : input.errorCategory ?? input.outcome,
      diagnostics,
    });
    logMessagingRuntime({
      event: input.outcome === "accepted" ? "provider_accepted" : "provider_failed",
      organizationId,
      connectionId,
      messageId: input.messageId,
      externalMessageId: input.providerMessageId ?? undefined,
      code: input.outcome === "accepted" ? undefined : input.outcome,
    });
  } catch (err) {
    const mapped = persistenceError(err);
    logMessagingRuntime({
      event: "normalized_persistence_failed",
      organizationId,
      connectionId,
      messageId: input.messageId,
      code: mapped.code,
      detail: mapped.detail,
    });
    throw err;
  }
}
