/**
 * Normalize Baileys `messages.upsert` into the same repository write path
 * that whatsappWebhookRoutes.persistNormalizedEvents uses, tagged with
 * provider: "claude_whatsapp".
 */
import {
  AUDIT_EVENTS,
} from "../whatsappConstants.ts";
import {
  buildMinimizedMetadata,
  digitsOnlyPhone,
} from "../whatsappEnvelope.ts";
import {
  createDefaultWhatsAppRepository,
  safeAudit,
  type WhatsAppRepository,
} from "../whatsappRepository.ts";
import {
  CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID,
  CLAUDE_WHATSAPP_PROVIDER,
} from "./claudeWhatsAppConstants.ts";

export type ClaudeBaileysInboundMessage = {
  key?: {
    id?: string | null;
    remoteJid?: string | null;
    fromMe?: boolean | null;
    participant?: string | null;
  } | null;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | string | LongLike | null;
  pushName?: string | null;
};

type LongLike = { toNumber?: () => number; low?: number };

export type ClaudeNormalizedInbound = {
  kind: "inbound_text" | "inbound_message";
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  wabaEntryId: string | null;
  waMessageId: string;
  fromWaId: string;
  profileName: string | null;
  text?: string;
  textBody?: string | null;
  messageType: string;
  occurredAt: string;
  metaMediaId: string | null;
  mimeType: string | null;
  caption: string | null;
  filename: string | null;
  sha256: string | null;
  voice: boolean;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  placeName: string | null;
  provider: typeof CLAUDE_WHATSAPP_PROVIDER;
};

function toUnixMs(ts: ClaudeBaileysInboundMessage["messageTimestamp"]): number {
  if (ts == null) return Date.now();
  if (typeof ts === "number") {
    return ts > 1e12 ? ts : ts * 1000;
  }
  if (typeof ts === "string") {
    const n = Number(ts);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
  }
  if (typeof ts === "object") {
    if (typeof ts.toNumber === "function") {
      const n = ts.toNumber();
      return n > 1e12 ? n : n * 1000;
    }
    if (typeof ts.low === "number") {
      const n = ts.low;
      return n > 1e12 ? n : n * 1000;
    }
  }
  return Date.now();
}

function jidToWaId(jid: string | null | undefined): string | null {
  if (!jid) return null;
  // Ignore groups / status / newsletters for the inbox path.
  if (
    jid.endsWith("@g.us") ||
    jid === "status@broadcast" ||
    jid.includes("@newsletter")
  ) {
    return null;
  }
  const user = jid.split("@")[0] || "";
  // Device-suffixed LIDs / multi-device: take digits before colon.
  const base = user.split(":")[0] || user;
  const digits = digitsOnlyPhone(base);
  return digits || null;
}

function extractText(message: Record<string, unknown> | null | undefined): {
  text: string | null;
  messageType: string;
  caption: string | null;
  voice: boolean;
} {
  if (!message) {
    return { text: null, messageType: "unknown", caption: null, voice: false };
  }
  if (typeof message.conversation === "string") {
    return {
      text: message.conversation,
      messageType: "text",
      caption: null,
      voice: false,
    };
  }
  const ext = message.extendedTextMessage as { text?: string } | undefined;
  if (ext && typeof ext.text === "string") {
    return {
      text: ext.text,
      messageType: "text",
      caption: null,
      voice: false,
    };
  }
  const image = message.imageMessage as { caption?: string } | undefined;
  if (image) {
    return {
      text: image.caption ?? null,
      messageType: "image",
      caption: image.caption ?? null,
      voice: false,
    };
  }
  const doc = message.documentMessage as
    | { caption?: string; fileName?: string }
    | undefined;
  if (doc) {
    return {
      text: doc.caption ?? doc.fileName ?? null,
      messageType: "document",
      caption: doc.caption ?? null,
      voice: false,
    };
  }
  const audio = message.audioMessage as { ptt?: boolean } | undefined;
  if (audio) {
    return {
      text: null,
      messageType: audio.ptt ? "voice" : "audio",
      caption: null,
      voice: Boolean(audio.ptt),
    };
  }
  const video = message.videoMessage as { caption?: string } | undefined;
  if (video) {
    return {
      text: video.caption ?? null,
      messageType: "video",
      caption: video.caption ?? null,
      voice: false,
    };
  }
  const loc = message.locationMessage as
    | { name?: string; address?: string }
    | undefined;
  if (loc) {
    return {
      text: loc.name || loc.address || null,
      messageType: "location",
      caption: null,
      voice: false,
    };
  }
  return { text: null, messageType: "unknown", caption: null, voice: false };
}

export function normalizeBaileysInboundMessage(
  msg: ClaudeBaileysInboundMessage,
  opts?: { displayPhoneNumber?: string | null }
): ClaudeNormalizedInbound | null {
  if (msg.key?.fromMe) return null;
  const fromWaId = jidToWaId(msg.key?.remoteJid);
  if (!fromWaId) return null;
  const waMessageId = String(msg.key?.id || "").trim();
  if (!waMessageId) return null;

  const extracted = extractText(msg.message ?? null);
  const occurredAt = new Date(toUnixMs(msg.messageTimestamp)).toISOString();
  const kind =
    extracted.messageType === "text" ? "inbound_text" : "inbound_message";

  const base = {
    phoneNumberId: CLAUDE_WHATSAPP_CHANNEL_PHONE_NUMBER_ID,
    displayPhoneNumber: opts?.displayPhoneNumber ?? null,
    wabaEntryId: CLAUDE_WHATSAPP_PROVIDER,
    waMessageId: `claude_${waMessageId}`,
    fromWaId,
    profileName: msg.pushName ?? null,
    messageType: extracted.messageType,
    occurredAt,
    metaMediaId: null,
    mimeType: null,
    caption: extracted.caption,
    filename: null,
    sha256: null,
    voice: extracted.voice,
    latitude: null,
    longitude: null,
    address: null,
    placeName: null,
    provider: CLAUDE_WHATSAPP_PROVIDER,
  } as const;

  if (kind === "inbound_text") {
    return {
      ...base,
      kind: "inbound_text",
      text: extracted.text ?? "",
      textBody: extracted.text,
    };
  }
  return {
    ...base,
    kind: "inbound_message",
    textBody: extracted.text,
  };
}

export type PersistClaudeInboundDeps = {
  repo?: WhatsAppRepository;
  autoLinkLead?: (conversationId: string) => Promise<unknown>;
  displayPhoneNumber?: string | null;
};

/**
 * Persist one Baileys inbound message using the same repository method
 * sequence as the Meta webhook path.
 */
export async function persistClaudeWhatsAppInbound(
  msg: ClaudeBaileysInboundMessage,
  deps: PersistClaudeInboundDeps = {}
): Promise<
  | { ok: true; conversationId: string; messageId: string; created: boolean }
  | { ok: false; error: string; skipped?: boolean }
> {
  const event = normalizeBaileysInboundMessage(msg, {
    displayPhoneNumber: deps.displayPhoneNumber ?? null,
  });
  if (!event) {
    return { ok: false, error: "skipped_non_inbound", skipped: true };
  }

  const repo = deps.repo ?? createDefaultWhatsAppRepository();
  if (!repo.isActive()) {
    return { ok: false, error: "repository_inactive" };
  }

  try {
    const channel = await repo.resolveOrCreateChannel({
      phoneNumberId: event.phoneNumberId,
      displayPhoneNumber: event.displayPhoneNumber,
      wabaId: event.wabaEntryId,
    });
    const contact = await repo.resolveOrCreateContact({
      phoneE164: event.fromWaId,
      profileName: event.profileName,
    });
    const conversation = await repo.resolveOrCreateOpenConversation({
      channelId: channel.id,
      contactId: contact.id,
    });

    const textBody =
      event.kind === "inbound_text" ? event.text : event.textBody;
    const messageType =
      event.kind === "inbound_text" ? "text" : event.messageType || "unknown";

    const minimizedMeta = {
      ...buildMinimizedMetadata({
        messageType,
        waMessageId: event.waMessageId,
        metaMediaId: event.metaMediaId,
        mimeType: event.mimeType,
        sha256: event.sha256,
        filename: event.filename,
        caption: event.caption,
        voice: event.voice,
        latitude: event.latitude,
        longitude: event.longitude,
        placeName: event.placeName,
        address: event.address,
      }),
      provider: CLAUDE_WHATSAPP_PROVIDER,
    };

    const inserted = await repo.insertInboundMessage({
      conversationId: conversation.id,
      waMessageId: event.waMessageId,
      textBody: textBody ?? null,
      occurredAt: event.occurredAt,
      rawPayload: minimizedMeta,
      messageType,
      metaMediaId: event.metaMediaId ?? null,
      mimeType: event.mimeType ?? null,
      caption: event.caption ?? null,
      filename: event.filename ?? null,
      sha256: event.sha256 ?? null,
      voice: Boolean(event.voice),
      latitude: event.latitude ?? null,
      longitude: event.longitude ?? null,
      address: event.address ?? null,
      placeName: event.placeName ?? null,
      rawMetadata: minimizedMeta,
    });
    if (inserted.ok === false) {
      return { ok: false, error: inserted.error };
    }

    await repo.updateConversationLastMessageAt(
      conversation.id,
      event.occurredAt
    );

    if (deps.autoLinkLead) {
      try {
        await deps.autoLinkLead(conversation.id);
      } catch (autoLinkErr) {
        console.error(
          "[claude-whatsapp] auto lead link failed:",
          conversation.id,
          autoLinkErr
        );
      }
    }

    await safeAudit(repo, {
      eventType: AUDIT_EVENTS.INBOUND_MESSAGE_STORED,
      entityType: "message",
      entityId: inserted.row.id,
      metadata: {
        conversationId: conversation.id,
        waMessageId: event.waMessageId,
        created: inserted.created,
        messageType,
        provider: CLAUDE_WHATSAPP_PROVIDER,
      },
    });

    return {
      ok: true,
      conversationId: conversation.id,
      messageId: inserted.row.id,
      created: inserted.created,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "persistence failed";
    return { ok: false, error: message };
  }
}

/**
 * Handle a Baileys messages.upsert batch.
 */
export async function handleClaudeWhatsAppMessagesUpsert(
  upsert: {
    type?: string;
    messages?: ClaudeBaileysInboundMessage[];
  },
  deps: PersistClaudeInboundDeps = {}
): Promise<void> {
  // Notify events are delivery receipts — skip to avoid duplicates.
  if (upsert.type === "notify") {
    // Still process; Baileys uses "notify" for new messages in many versions.
  }
  for (const msg of upsert.messages || []) {
    const result = await persistClaudeWhatsAppInbound(msg, deps);
    if (result.ok === false && !result.skipped) {
      console.error("[claude-whatsapp] inbound persist failed:", result.error);
    }
  }
}
