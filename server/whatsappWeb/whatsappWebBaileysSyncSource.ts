/**
 * In-memory Baileys sync source.
 * Populated from contacts/chats/history events while the socket is connected.
 * Exposes getContacts/getChats/fetchMessages-style methods for the sync job.
 */
import { jidToWaId } from "./whatsappWebNormalize.ts";
import {
  normalizeJid,
  type WhatsAppWebSyncChat,
  type WhatsAppWebSyncContact,
  type WhatsAppWebSyncMessage,
  type WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";

type InternalContact = WhatsAppWebSyncContact;
type InternalChat = WhatsAppWebSyncChat & {
  messages: Map<string, WhatsAppWebSyncMessage>;
};

function messageTypeOf(msg: Record<string, unknown>): string {
  const message = msg.message as Record<string, unknown> | undefined;
  if (!message) return "unknown";
  if (message.conversation || message.extendedTextMessage) return "text";
  if (message.imageMessage) return "image";
  if (message.videoMessage) return "video";
  if (message.audioMessage) return "audio";
  if (message.documentMessage) return "document";
  if (message.stickerMessage) return "sticker";
  if (message.locationMessage) return "location";
  if (message.contactMessage) return "contact";
  return Object.keys(message)[0] ?? "unknown";
}

function extractText(msg: Record<string, unknown>): string | null {
  const message = msg.message as Record<string, unknown> | undefined;
  if (!message) return null;
  if (typeof message.conversation === "string") return message.conversation;
  const ext = message.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) return String(ext.text);
  const image = message.imageMessage as { caption?: string } | undefined;
  if (image?.caption) return String(image.caption);
  const video = message.videoMessage as { caption?: string } | undefined;
  if (video?.caption) return String(video.caption);
  const doc = message.documentMessage as {
    caption?: string;
    fileName?: string;
  } | undefined;
  if (doc?.caption) return String(doc.caption);
  return null;
}

function mediaMeta(msg: Record<string, unknown>): {
  mimeType: string | null;
  caption: string | null;
  filename: string | null;
} {
  const message = msg.message as Record<string, unknown> | undefined;
  if (!message) return { mimeType: null, caption: null, filename: null };
  for (const key of [
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage",
  ]) {
    const part = message[key] as
      | { mimetype?: string; caption?: string; fileName?: string }
      | undefined;
    if (part) {
      return {
        mimeType: part.mimetype ? String(part.mimetype) : null,
        caption: part.caption ? String(part.caption) : null,
        filename: part.fileName ? String(part.fileName) : null,
      };
    }
  }
  return { mimeType: null, caption: null, filename: null };
}

export class BaileysInMemorySyncSource implements WhatsAppWebSyncSource {
  private connected = false;
  private selfJid: string | null = null;
  private readonly contacts = new Map<string, InternalContact>();
  private readonly chats = new Map<string, InternalChat>();

  setConnected(connected: boolean, selfJid?: string | null): void {
    this.connected = connected;
    if (selfJid !== undefined) this.selfJid = selfJid ? normalizeJid(selfJid) : null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSelfJid(): string | null {
    return this.selfJid;
  }

  ingestContacts(rawContacts: Array<Record<string, unknown>>): void {
    for (const c of rawContacts) {
      const jid = normalizeJid(String(c.id || c.jid || ""));
      if (!jid || jid.endsWith("@g.us")) continue;
      const phone = jidToWaId(jid);
      if (!phone) continue;
      const prev = this.contacts.get(jid);
      this.contacts.set(jid, {
        jid,
        phoneE164: phone,
        savedName:
          (c.name as string) ||
          (c.notify as string) ||
          prev?.savedName ||
          null,
        pushName:
          (c.notify as string) ||
          (c.verifiedName as string) ||
          prev?.pushName ||
          null,
        shortName: (c.short as string) || prev?.shortName || null,
        isBusiness: Boolean(c.isBusiness || c.verifiedName),
      });
    }
  }

  ingestChats(rawChats: Array<Record<string, unknown>>): void {
    for (const chat of rawChats) {
      const jid = normalizeJid(String(chat.id || chat.jid || ""));
      if (!jid) continue;
      const isGroup = jid.endsWith("@g.us");
      const isStatusOrBroadcast =
        jid === "status@broadcast" || jid.includes("broadcast");
      const isChannel = jid.endsWith("@newsletter");
      const phone = isGroup || isStatusOrBroadcast || isChannel ? null : jidToWaId(jid);
      const prev = this.chats.get(jid);
      this.chats.set(jid, {
        jid,
        phoneE164: phone,
        name: (chat.name as string) || prev?.name || null,
        isGroup,
        isStatusOrBroadcast,
        isChannel,
        messages: prev?.messages ?? new Map(),
      });
    }
  }

  ingestMessages(rawMessages: Array<Record<string, unknown>>): void {
    for (const msg of rawMessages) {
      const key = msg.key as
        | { id?: string; remoteJid?: string; fromMe?: boolean }
        | undefined;
      const providerMessageId = String(key?.id || "");
      const chatJid = normalizeJid(String(key?.remoteJid || ""));
      if (!providerMessageId || !chatJid) continue;
      if (!this.chats.has(chatJid)) {
        this.ingestChats([{ id: chatJid }]);
      }
      const chat = this.chats.get(chatJid)!;
      const ts = Number(msg.messageTimestamp || 0);
      const occurredAt = ts
        ? new Date(ts * 1000).toISOString()
        : new Date().toISOString();
      const media = mediaMeta(msg);
      chat.messages.set(providerMessageId, {
        providerMessageId,
        chatJid,
        fromMe: key?.fromMe === true,
        text: extractText(msg),
        messageType: messageTypeOf(msg),
        occurredAt,
        mimeType: media.mimeType,
        caption: media.caption,
        filename: media.filename,
      });
    }
  }

  async listContacts(): Promise<WhatsAppWebSyncContact[]> {
    return [...this.contacts.values()];
  }

  async listChats(): Promise<WhatsAppWebSyncChat[]> {
    return [...this.chats.values()].map(
      ({ messages: _m, ...chat }) => chat
    );
  }

  async fetchMessages(
    chatJid: string,
    opts: { limit: number; sinceMs: number }
  ): Promise<WhatsAppWebSyncMessage[]> {
    const chat = this.chats.get(normalizeJid(chatJid));
    if (!chat) return [];
    return [...chat.messages.values()]
      .filter((m) => {
        const ts = Date.parse(m.occurredAt);
        return Number.isFinite(ts) && ts >= opts.sinceMs;
      })
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
      .slice(-Math.max(1, opts.limit));
  }
}
