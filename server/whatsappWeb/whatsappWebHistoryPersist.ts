/**
 * Persist WhatsApp Web history/backfill into the authoritative Inbox path.
 * Never triggers AI, outbound queues, lead auto-creation, or live automation.
 */
import {
  createDefaultWhatsAppRepository,
  type WhatsAppContact,
  type WhatsAppRepository,
} from "../whatsappTransport/whatsappRepository.ts";
import {
  DEFAULT_COMPANY_ID,
  MESSAGE_STATUSES,
} from "../whatsappTransport/whatsappConstants.ts";
import { WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID } from "./whatsappWebConfig.ts";
import { jidToWaId } from "./whatsappWebNormalize.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";
import {
  resolveWhatsAppDisplayName,
  shouldApplyWhatsAppContactName,
  type WhatsAppWebSyncContact,
  type WhatsAppWebSyncMessage,
} from "./whatsappWebSyncTypes.ts";

export const WHATSAPP_WEB_BACKFILL_SOURCE = "history_backfill";

export type WhatsAppWebHistoryPersistDeps = {
  repo?: WhatsAppRepository;
  now?: () => Date;
};

export type ContactSyncResult = {
  contact: WhatsAppContact;
  created: boolean;
  updated: boolean;
};

export type MessageBackfillResult =
  | {
      kind: "imported";
      direction: "inbound" | "outbound";
      conversationId: string;
      conversationCreated: boolean;
    }
  | { kind: "duplicate"; conversationId: string }
  | { kind: "ignored"; reason: string };

function backfillMetadata(extra: Record<string, unknown> = {}) {
  return {
    transport: "whatsapp_web_qr",
    source: WHATSAPP_WEB_BACKFILL_SOURCE,
    is_backfill: true,
    ...extra,
  };
}

export async function syncWhatsAppWebContact(
  contact: WhatsAppWebSyncContact,
  deps: WhatsAppWebHistoryPersistDeps = {}
): Promise<ContactSyncResult> {
  const repo = deps.repo ?? createDefaultWhatsAppRepository();
  const phone = contact.phoneE164 || jidToWaId(contact.jid);
  if (!phone) {
    throw new Error("invalid_contact_phone");
  }
  const resolved = resolveWhatsAppDisplayName({
    verifiedName: contact.verifiedName,
    savedName: contact.savedName,
    pushName: contact.pushName,
    shortName: contact.shortName,
    phoneE164: phone,
  });

  const companyId = DEFAULT_COMPANY_ID;
  const existing = repo.findContactByPhoneE164
    ? await repo.findContactByPhoneE164(phone, companyId)
    : null;

  const nowIso = (deps.now ?? (() => new Date))().toISOString();

  const businessPatch =
    contact.isBusiness === null || contact.isBusiness === undefined
      ? {}
      : { isBusinessContact: contact.isBusiness };

  if (!existing) {
    const created = await repo.resolveOrCreateContact({
      phoneE164: phone,
      profileName: resolved.name,
      nameSource: resolved.source,
    });
    if (repo.updateContactSyncFields) {
      await repo.updateContactSyncFields(
        created.id,
        {
          waJid: contact.jid,
          lastSyncedAt: nowIso,
          ...businessPatch,
          ...(resolved.name && resolved.source
            ? { profileName: resolved.name, nameSource: resolved.source }
            : {}),
        },
        companyId
      );
    }
    const refreshed =
      (repo.findContactByPhoneE164
        ? await repo.findContactByPhoneE164(phone, companyId)
        : null) ?? created;
    return { contact: refreshed, created: true, updated: false };
  }

  const applyName = shouldApplyWhatsAppContactName({
    existingName: existing.profileName,
    existingSource: existing.nameSource,
    nextName: resolved.name,
    nextSource: resolved.source,
    phoneE164: phone,
  });

  let updated = false;
  if (repo.updateContactSyncFields) {
    // Metadata (wa_jid / last_synced_at) never blindly writes weaker names —
    // updateContactSyncFields applies upgrade-only CAS for profile fields.
    await repo.updateContactSyncFields(
      existing.id,
      {
        waJid: contact.jid,
        lastSyncedAt: nowIso,
        ...businessPatch,
        ...(applyName && resolved.name && resolved.source
          ? { profileName: resolved.name, nameSource: resolved.source }
          : {}),
      },
      companyId
    );
    updated = Boolean(
      applyName ||
        contact.jid ||
        (contact.isBusiness !== null &&
          contact.isBusiness !== undefined &&
          contact.isBusiness !== Boolean(existing.isBusinessContact))
    );
  } else {
    await repo.resolveOrCreateContact({
      phoneE164: phone,
      profileName: resolved.name,
      nameSource: resolved.source,
    });
    updated = applyName;
  }

  const refreshed =
    (repo.findContactByPhoneE164
      ? await repo.findContactByPhoneE164(phone, companyId)
      : null) ?? existing;
  return { contact: refreshed, created: false, updated };
}

/**
 * Import one historical message. Marks is_backfill; never calls AI/auto-link.
 */
export async function persistWhatsAppWebBackfillMessage(
  message: WhatsAppWebSyncMessage,
  deps: WhatsAppWebHistoryPersistDeps = {}
): Promise<MessageBackfillResult> {
  const repo = deps.repo ?? createDefaultWhatsAppRepository();
  if (!repo.isActive()) {
    return { kind: "ignored", reason: "repo_inactive" };
  }
  const phone = jidToWaId(message.chatJid);
  if (!phone) {
    return { kind: "ignored", reason: "bad_jid" };
  }
  if (!message.providerMessageId?.trim()) {
    return { kind: "ignored", reason: "missing_provider_id" };
  }

  const channel = await repo.resolveOrCreateChannel({
    phoneNumberId: WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
    displayPhoneNumber: null,
    wabaId: null,
  });
  const contact = await repo.resolveOrCreateContact({ phoneE164: phone });
  const conversation = await repo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  const conversationCreated = !conversation.lastMessageAt;

  const text =
    message.text?.trim() ||
    (message.messageType && message.messageType !== "text"
      ? `[${message.messageType}]`
      : null);
  if (!text) {
    return { kind: "ignored", reason: "unsupported_empty" };
  }

  const meta = backfillMetadata({
    waMessageId: message.providerMessageId,
    messageType: message.messageType,
    fromMe: message.fromMe,
  });

  if (message.fromMe) {
    if (!repo.insertHistoricalOutboundMessage) {
      return { kind: "ignored", reason: "outbound_backfill_unsupported" };
    }
    const inserted = await repo.insertHistoricalOutboundMessage({
      conversationId: conversation.id,
      waMessageId: message.providerMessageId.trim(),
      textBody: text,
      occurredAt: message.occurredAt,
      status: MESSAGE_STATUSES.SENT,
      messageType: message.messageType || "text",
      mimeType: message.mimeType ?? null,
      caption: message.caption ?? null,
      filename: message.filename ?? null,
      rawMetadata: meta,
      isBackfill: true,
      createdAt: message.occurredAt,
    });
    if (!inserted.ok) {
      logWhatsAppWeb("warn", "backfill_outbound_failed");
      return { kind: "ignored", reason: "persist_failed" };
    }
    if (!inserted.created) {
      return { kind: "duplicate", conversationId: conversation.id };
    }
    await advanceLastMessageAt(repo, conversation.id, message.occurredAt);
    return {
      kind: "imported",
      direction: "outbound",
      conversationId: conversation.id,
      conversationCreated,
    };
  }

  const inserted = await repo.insertInboundMessage({
    conversationId: conversation.id,
    waMessageId: message.providerMessageId.trim(),
    textBody: text,
    occurredAt: message.occurredAt,
    rawPayload: meta,
    messageType: message.messageType || "text",
    mimeType: message.mimeType ?? null,
    caption: message.caption ?? null,
    filename: message.filename ?? null,
    rawMetadata: meta,
    isBackfill: true,
    createdAt: message.occurredAt,
  });
  if (inserted.ok === false) {
    logWhatsAppWeb("warn", "backfill_inbound_failed");
    return { kind: "ignored", reason: "persist_failed" };
  }
  if (!inserted.created) {
    return { kind: "duplicate", conversationId: conversation.id };
  }
  await advanceLastMessageAt(repo, conversation.id, message.occurredAt);
  // Intentionally no evaluateShadow / autoLinkLead / outbound queue / dual-write hooks.
  return {
    kind: "imported",
    direction: "inbound",
    conversationId: conversation.id,
    conversationCreated,
  };
}

async function advanceLastMessageAt(
  repo: WhatsAppRepository,
  conversationId: string,
  at: string
): Promise<void> {
  if (repo.advanceConversationLastMessageAt) {
    await repo.advanceConversationLastMessageAt(
      conversationId,
      at,
      DEFAULT_COMPANY_ID
    );
    return;
  }
  const bundle = await repo.getConversationBundle(conversationId);
  if (bundle && bundle.conversation.companyId !== DEFAULT_COMPANY_ID) return;
  const current = bundle?.conversation.lastMessageAt;
  if (current && current >= at) return;
  await repo.updateConversationLastMessageAt(conversationId, at);
}

/** Test helper: prove backfill metadata is explicit. */
export function isBackfillMetadata(
  meta: Record<string, unknown> | null | undefined
): boolean {
  if (!meta) return false;
  return meta.is_backfill === true || meta.source === WHATSAPP_WEB_BACKFILL_SOURCE;
}
