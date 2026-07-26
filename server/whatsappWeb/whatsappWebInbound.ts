/**
 * Persist Baileys inbound messages into the existing WhatsApp Inbox path
 * (whatsapp_*) and optional normalized messaging dual-write.
 *
 * Does not create a second Inbox implementation.
 * Does not enable AI auto-replies (shadow evaluate is optional, fire-and-forget).
 */
import type { MessagingRepository } from "../unifiedMessaging/messagingRepository.ts";
import { MESSAGING_TRUSTED_ORGANIZATION_ID } from "../unifiedMessaging/messagingRuntimeConfig.ts";
import {
  bridgePersistInboundMessage,
  type WhatsAppMessagingBridge,
} from "../whatsappTransport/whatsappMessagingBridge.ts";
import { AUDIT_EVENTS } from "../whatsappTransport/whatsappConstants.ts";
import {
  createDefaultWhatsAppRepository,
  safeAudit,
  type WhatsAppRepository,
} from "../whatsappTransport/whatsappRepository.ts";
import {
  WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
  WHATSAPP_WEB_QR_CONNECTION_ID,
} from "./whatsappWebConfig.ts";
import { WhatsAppLidPhoneMap } from "./whatsappWebIdentity.ts";
import {
  resolveWhatsAppIdentityDurable,
  scheduleRememberVerifiedLidMapping,
} from "./whatsappWebLidMapping.ts";
import {
  defaultWhatsAppLidMappingScope,
  type WhatsAppLidMappingScope,
  type WhatsAppLidPhoneMappingRepository,
} from "./whatsappWebLidMappingRepository.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";
import {
  normalizeBaileysInbound,
  type BaileysInboundLike,
} from "./whatsappWebNormalize.ts";

export type WhatsAppWebInboundDeps = {
  repo?: WhatsAppRepository;
  messagingRepository?: MessagingRepository | null;
  /** Optional ephemeral LID map shared with the sync source. */
  lidMap?: WhatsAppLidPhoneMap | null;
  /** Optional durable LID→phone repository (SYNC-14C-B). */
  lidMappingRepo?: WhatsAppLidPhoneMappingRepository | null;
  lidMappingScope?: WhatsAppLidMappingScope;
  /** Optional AI shadow evaluate — must not send messages. */
  evaluateShadow?: ((input: {
    conversationId: string;
    messageText: string;
    contactPhone: string;
  }) => Promise<unknown>) | null;
  autoLinkLead?: ((conversationId: string) => Promise<unknown>) | null;
};

export function createWhatsAppWebMessagingBridge(input: {
  repository: MessagingRepository | null | undefined;
  organizationId?: string;
}): WhatsAppMessagingBridge | null {
  if (!input.repository) return null;
  return {
    organizationId: input.organizationId ?? MESSAGING_TRUSTED_ORGANIZATION_ID,
    connectionId: WHATSAPP_WEB_QR_CONNECTION_ID,
    repository: input.repository,
    transportType: "whatsapp_web_qr",
  };
}

/**
 * Handle one Baileys inbound message. Idempotent on provider message id
 * via whatsapp_messages.wa_message_id uniqueness.
 */
export async function persistWhatsAppWebInbound(
  message: BaileysInboundLike,
  deps: WhatsAppWebInboundDeps = {}
): Promise<
  | { kind: "stored"; messageId: string; conversationId: string; created: boolean }
  | { kind: "ignored"; reason: string }
  | { kind: "error"; error: string }
> {
  const lidMap = deps.lidMap ?? new WhatsAppLidPhoneMap();
  const lidMappingRepo = deps.lidMappingRepo ?? null;
  const lidMappingScope =
    deps.lidMappingScope ?? defaultWhatsAppLidMappingScope();

  // Durable LID lookup before normalize so post-restart LID-only events can
  // attach to the existing phone contact. Failures degrade to bad_jid ignore.
  if (lidMappingRepo) {
    try {
      await resolveWhatsAppIdentityDurable(
        {
          remoteJid: message.remoteJid,
          remoteJidAlt: message.remoteJidAlt,
          participant: message.participant,
          participantAlt: message.participantAlt,
          senderPn: message.senderPn,
          senderLid: message.senderLid,
          participantPn: message.participantPn,
          participantLid: message.participantLid,
        },
        {
          repo: lidMappingRepo,
          scope: lidMappingScope,
          memory: lidMap,
        }
      );
    } catch {
      // Mapping failure must not disconnect WhatsApp or fail inbound hard.
      logWhatsAppWeb("warn", "lid_mapping_resolve_degraded");
    }
  }

  const normalized = normalizeBaileysInbound(message, { lidMap });
  if (normalized.kind === "ignore") {
    return { kind: "ignored", reason: normalized.reason };
  }

  const event = normalized.event;
  const repo = deps.repo ?? createDefaultWhatsAppRepository();
  if (!repo.isActive()) {
    return { kind: "error", error: "WhatsApp persistence unavailable" };
  }

  try {
    const channel = await repo.resolveOrCreateChannel({
      phoneNumberId: WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
      displayPhoneNumber: null,
      wabaId: null,
    });
    const contact = await repo.resolveOrCreateContact({
      phoneE164: event.fromWaId,
      profileName: event.profileName,
      // Live inbound pushName is notify-tier only — never saved/verified/manual.
      nameSource: event.profileName ? "whatsapp_push" : null,
    });
    const conversation = await repo.resolveOrCreateOpenConversation({
      channelId: channel.id,
      contactId: contact.id,
    });

    // When inbound carried both LID + phone, persist verified mapping (no throw).
    if (lidMappingRepo && message.remoteJid?.includes("@lid")) {
      const altPhone =
        message.remoteJidAlt ||
        message.senderPn ||
        message.participantAlt ||
        message.participantPn ||
        null;
      if (altPhone) {
        scheduleRememberVerifiedLidMapping(message.remoteJid, altPhone, {
          repo: lidMappingRepo,
          scope: lidMappingScope,
          memory: lidMap,
        });
      }
    }

    const inserted = await repo.insertInboundMessage({
      conversationId: conversation.id,
      waMessageId: event.waMessageId,
      textBody: event.text,
      occurredAt: event.occurredAt,
      rawPayload: {
        transport: "whatsapp_web_qr",
        waMessageId: event.waMessageId,
      },
      messageType: "text",
      rawMetadata: {
        transport: "whatsapp_web_qr",
        waMessageId: event.waMessageId,
      },
    });
    if (inserted.ok === false) {
      return { kind: "error", error: inserted.error };
    }

    await repo.updateConversationLastMessageAt(
      conversation.id,
      event.occurredAt
    );

    const bridge = createWhatsAppWebMessagingBridge({
      repository: deps.messagingRepository,
    });
    if (bridge) {
      await bridgePersistInboundMessage(bridge, event);
    }

    if (deps.autoLinkLead) {
      try {
        await deps.autoLinkLead(conversation.id);
      } catch {
        logWhatsAppWeb("warn", "auto_link_lead_failed");
      }
    }

    // Same normalized Inbox pipeline AI shadow will consume later.
    // Fire-and-forget; never auto-send replies in QR-1.
    if (deps.evaluateShadow && inserted.created) {
      void deps
        .evaluateShadow({
          conversationId: conversation.id,
          messageText: event.text,
          contactPhone: event.fromWaId,
        })
        .catch(() => {
          logWhatsAppWeb("warn", "ai_shadow_evaluate_failed");
        });
    }

    await safeAudit(repo, {
      eventType: AUDIT_EVENTS.INBOUND_MESSAGE_STORED,
      entityType: "message",
      entityId: inserted.row.id,
      metadata: {
        conversationId: conversation.id,
        waMessageId: event.waMessageId,
        created: inserted.created,
        transport: "whatsapp_web_qr",
        messagingDualWrite: Boolean(bridge),
      },
    });

    return {
      kind: "stored",
      messageId: inserted.row.id,
      conversationId: conversation.id,
      created: inserted.created,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "inbound persist failed";
    logWhatsAppWeb("error", "inbound_persist_failed");
    return { kind: "error", error };
  }
}
