/**
 * Baileys outbound send for Inbox conversations on the WhatsApp Web QR channel.
 *
 * - Confirms provider message ID before success
 * - Does not auto-retry uncertain sends (no duplicate provider dispatch)
 * - Preserves human actor audit via existing whatsapp_* outbound rows
 */
import { randomUUID } from "node:crypto";
import type { RequestActor } from "../middleware/actor.ts";
import type { MessagingRepository } from "../unifiedMessaging/messagingRepository.ts";
import {
  AUDIT_EVENTS,
  MESSAGE_STATUSES,
} from "../whatsappTransport/whatsappConstants.ts";
import {
  authorizeOutboundWhatsAppActor,
  canSendOutboundWhatsApp,
} from "../whatsappTransport/whatsappPermissions.ts";
import {
  safeAudit,
  type WhatsAppRepository,
} from "../whatsappTransport/whatsappRepository.ts";
import {
  validateOutboundText,
  type OutboundSendResult,
} from "../whatsappTransport/whatsappOutboundService.ts";
import {
  bridgeAssociateOutboundProviderExternalId,
  bridgeClaimOutboundSend,
  bridgePrepareOutboundMessage,
  bridgeProviderMessageId,
  bridgeRecordOutboundProviderResult,
  bridgeStrictInboxMessageId,
} from "../whatsappTransport/whatsappMessagingBridge.ts";
import { isMessagingRepositoryError } from "../unifiedMessaging/messagingRepositoryErrors.ts";
import { WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID } from "./whatsappWebConfig.ts";
import { createWhatsAppWebMessagingBridge } from "./whatsappWebInbound.ts";
import { waIdToChatJid } from "./whatsappWebNormalize.ts";
import type { WhatsAppWebSession } from "./whatsappWebSession.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";

export type WhatsAppWebOutboundDeps = {
  repo: WhatsAppRepository;
  session: WhatsAppWebSession;
  actor: RequestActor | null | undefined;
  messagingRepository?: MessagingRepository | null;
  clientIdempotencyKey?: string | null;
};

export function isWhatsAppWebQrChannel(
  phoneNumberId: string | null | undefined
): boolean {
  return String(phoneNumberId ?? "") === WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID;
}

export async function sendWhatsAppWebPlainText(
  conversationId: string,
  rawText: unknown,
  deps: WhatsAppWebOutboundDeps
): Promise<OutboundSendResult> {
  if (!deps.actor) {
    return { httpStatus: 401, error: "Unauthorized" };
  }
  if (!canSendOutboundWhatsApp(deps.actor)) {
    return { httpStatus: 403, error: "Forbidden" };
  }
  if (!deps.repo.isActive()) {
    return { httpStatus: 503, error: "WhatsApp persistence unavailable" };
  }

  const validated = validateOutboundText(rawText);
  if (validated.ok === false) {
    return { httpStatus: 400, error: validated.error };
  }

  if (!deps.session.isConnected()) {
    return { httpStatus: 503, error: "WhatsApp Web is not connected" };
  }

  const bundle = await deps.repo.getConversationBundle(conversationId);
  const auth = authorizeOutboundWhatsAppActor(deps.actor, bundle);
  if (auth.ok === false) {
    return { httpStatus: auth.status, error: auth.error };
  }
  const conversationBundle = bundle!;
  if (!isWhatsAppWebQrChannel(conversationBundle.channel.phoneNumberId)) {
    return {
      httpStatus: 400,
      error: "Conversation is not a WhatsApp Web QR channel",
    };
  }

  const recipientWaId = conversationBundle.contact.phoneE164;
  if (!recipientWaId) {
    return { httpStatus: 400, error: "Contact phone is missing" };
  }

  const messagingBridge = createWhatsAppWebMessagingBridge({
    repository: deps.messagingRepository,
  });
  const clientIdempotencyKey =
    (deps.clientIdempotencyKey && deps.clientIdempotencyKey.trim()) ||
    (messagingBridge ? randomUUID() : "");

  let messagingMessageId: string | null = null;
  let claimedSend = false;
  const actor = deps.actor;

  if (messagingBridge) {
    try {
      const prepared = await bridgePrepareOutboundMessage(messagingBridge, {
        recipientWaId,
        text: validated.text,
        clientIdempotencyKey,
        actorId: actor.id,
      });
      messagingMessageId = prepared.message.messageId;

      const claim = await bridgeClaimOutboundSend(
        messagingBridge,
        prepared.message.messageId
      );

      if (claim.kind === "completed") {
        const inboxId = bridgeStrictInboxMessageId(claim.row);
        const providerMessageId = bridgeProviderMessageId(claim.row);
        if (!inboxId) {
          return {
            httpStatus: 202,
            ...(providerMessageId ? { providerMessageId } : {}),
            status: claim.row.deliveryStatus,
            persistenceStatus: "incomplete",
            ...(providerMessageId
              ? { providerOutcome: "accepted" as const }
              : {}),
            error:
              "Outbound completed but Inbox message binding is incomplete",
          };
        }
        return {
          httpStatus: 201,
          messageId: inboxId,
          providerMessageId: providerMessageId ?? inboxId,
          status: "sent",
        };
      }
      if (claim.kind === "in_flight") {
        const providerMessageId = bridgeProviderMessageId(claim.row);
        return {
          httpStatus: 202,
          messageId: bridgeStrictInboxMessageId(claim.row) ?? undefined,
          ...(providerMessageId ? { providerMessageId } : {}),
          status: MESSAGE_STATUSES.SENDING,
          persistenceStatus: "incomplete",
          ...(providerMessageId
            ? { providerOutcome: "accepted" as const }
            : {}),
          error: providerMessageId
            ? "Outbound send already in progress for this idempotency key"
            : "Outbound processing incomplete for this idempotency key; no resend attempted",
        };
      }
      if (claim.kind === "terminal") {
        return {
          httpStatus: 409,
          messageId: bridgeStrictInboxMessageId(claim.row) ?? undefined,
          status: claim.row.deliveryStatus,
          error:
            "Idempotency key is not eligible for automatic resend; use a new key",
        };
      }
      claimedSend = true;
      messagingMessageId = claim.row.messageId;
    } catch (err) {
      if (
        isMessagingRepositoryError(err) &&
        err.detail === "idempotency_conflict"
      ) {
        return {
          httpStatus: 409,
          error: "Idempotency key reused with different request content",
        };
      }
      return {
        httpStatus: 500,
        error: "Failed to persist normalized outbound message",
      };
    }
  }

  let message;
  try {
    message = await deps.repo.insertOutboundMessage({
      conversationId,
      textBody: validated.text,
    });
  } catch {
    return { httpStatus: 500, error: "Failed to queue outbound message" };
  }

  if (messagingBridge && messagingMessageId && claimedSend) {
    try {
      await messagingBridge.repository.bindOutboundLegacyMessageId({
        organizationId: messagingBridge.organizationId,
        messageId: messagingMessageId,
        whatsappMessageId: message.id,
      });
    } catch {
      logWhatsAppWeb("warn", "legacy_binding_failed");
      await safeAudit(deps.repo, {
        eventType: AUDIT_EVENTS.OUTBOUND_PERSISTENCE_DEGRADED,
        entityType: "message",
        entityId: message.id,
        metadata: {
          conversationId,
          reason: "legacy_binding_failed",
          transport: "whatsapp_web_qr",
          providerCalled: false,
        },
      });
      return {
        httpStatus: 202,
        messageId: message.id,
        status: MESSAGE_STATUSES.QUEUED,
        persistenceStatus: "incomplete",
        error:
          "Outbound message queued but Inbox binding incomplete; not sent to provider",
      };
    }
  }

  await safeAudit(deps.repo, {
    eventType: AUDIT_EVENTS.OUTBOUND_QUEUED,
    entityType: "message",
    entityId: message.id,
    metadata: {
      conversationId,
      actorId: actor.id,
      actorRole: actor.role,
      transport: "whatsapp_web_qr",
    },
  });

  try {
    await deps.repo.updateMessageStatus({
      messageId: message.id,
      status: MESSAGE_STATUSES.SENDING,
    });
  } catch {
    return {
      httpStatus: 500,
      messageId: message.id,
      status: MESSAGE_STATUSES.QUEUED,
      error: "Failed to transition message to sending",
    };
  }

  let providerMessageId: string;
  try {
    const sent = await deps.session.sendText(
      waIdToChatJid(recipientWaId),
      validated.text
    );
    providerMessageId = sent.providerMessageId;
    if (!providerMessageId) {
      throw new Error("missing provider message id");
    }
  } catch {
    try {
      await deps.repo.updateMessageStatus({
        messageId: message.id,
        status: MESSAGE_STATUSES.FAILED,
        providerError: "whatsapp_web_send_failed",
      });
    } catch {
      /* ignore */
    }
    if (messagingBridge && messagingMessageId) {
      try {
        await bridgeRecordOutboundProviderResult(messagingBridge, {
          messageId: messagingMessageId,
          outcome: "failed",
          errorCategory: "provider_rejected",
        });
      } catch {
        /* ignore */
      }
    }
    await safeAudit(deps.repo, {
      eventType: AUDIT_EVENTS.OUTBOUND_FAILED,
      entityType: "message",
      entityId: message.id,
      metadata: {
        transport: "whatsapp_web_qr",
        actorId: actor.id,
      },
    });
    return {
      httpStatus: 502,
      messageId: message.id,
      error: "WhatsApp Web send failed",
    };
  }

  try {
    await deps.repo.updateMessageStatus({
      messageId: message.id,
      status: MESSAGE_STATUSES.SENT,
      waMessageId: providerMessageId,
      sentAt: new Date().toISOString(),
    });
  } catch {
    if (messagingBridge && messagingMessageId) {
      try {
        await bridgeAssociateOutboundProviderExternalId(messagingBridge, {
          messageId: messagingMessageId,
          providerMessageId,
        });
      } catch {
        /* ignore */
      }
    }
    return {
      httpStatus: 202,
      messageId: message.id,
      providerMessageId,
      persistenceStatus: "incomplete",
      providerOutcome: "accepted",
      error: "Provider accepted but local status persistence incomplete",
    };
  }

  if (messagingBridge && messagingMessageId) {
    try {
      await bridgeAssociateOutboundProviderExternalId(messagingBridge, {
        messageId: messagingMessageId,
        providerMessageId,
      });
      await bridgeRecordOutboundProviderResult(messagingBridge, {
        messageId: messagingMessageId,
        outcome: "accepted",
        providerMessageId,
      });
    } catch {
      return {
        httpStatus: 202,
        messageId: message.id,
        providerMessageId,
        persistenceStatus: "incomplete",
        providerOutcome: "accepted",
        error: "Provider accepted but normalized status incomplete",
      };
    }
  }

  await safeAudit(deps.repo, {
    eventType: AUDIT_EVENTS.OUTBOUND_SENT,
    entityType: "message",
    entityId: message.id,
    metadata: {
      transport: "whatsapp_web_qr",
      actorId: actor.id,
    },
  });

  return {
    httpStatus: 201,
    messageId: message.id,
    providerMessageId,
    status: "sent",
  };
}
