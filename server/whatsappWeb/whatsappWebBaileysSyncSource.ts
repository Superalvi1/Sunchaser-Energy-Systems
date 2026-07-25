/**
 * In-memory Baileys sync source.
 * Populated from contacts/chats/history events while the socket is connected.
 * Optionally requests bounded on-demand history via Baileys fetchMessageHistory.
 */
import { jidToWaId } from "./whatsappWebNormalize.ts";
import {
  normalizeJid,
  WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT,
  WHATSAPP_WEB_SYNC_HISTORY_WAIT_MS,
  type WhatsAppWebHistoryCoverage,
  type WhatsAppWebHistoryCoverageMeta,
  type WhatsAppWebSyncChat,
  type WhatsAppWebSyncContact,
  type WhatsAppWebSyncMessage,
  type WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";

type InternalContact = WhatsAppWebSyncContact;
type InternalChat = WhatsAppWebSyncChat & {
  messages: Map<string, WhatsAppWebSyncMessage>;
};

export type BaileysHistoryFetchFn = (
  count: number,
  oldestMsgKey: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null },
  oldestMsgTimestamp: number
) => Promise<string>;

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

function nonEmptyString(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
}

export class BaileysInMemorySyncSource implements WhatsAppWebSyncSource {
  private connected = false;
  private selfJid: string | null = null;
  private readonly contacts = new Map<string, InternalContact>();
  private readonly chats = new Map<string, InternalChat>();
  private historyFetcher: BaileysHistoryFetchFn | null = null;
  private providerHistoryEventObserved = false;
  private historyWaitGeneration = 0;
  private readonly requestedHistoryChats = new Set<string>();

  setConnected(connected: boolean, selfJid?: string | null): void {
    this.connected = connected;
    if (selfJid !== undefined) this.selfJid = selfJid ? normalizeJid(selfJid) : null;
    if (!connected) {
      this.historyFetcher = null;
    }
  }

  setHistoryFetcher(fn: BaileysHistoryFetchFn | null): void {
    this.historyFetcher = fn;
  }

  markProviderHistoryEvent(): void {
    this.providerHistoryEventObserved = true;
    this.historyWaitGeneration += 1;
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
      // savedName is contact-book name only — never notify/push.
      const savedName = nonEmptyString(c.name) ?? prev?.savedName ?? null;
      const pushName =
        nonEmptyString(c.notify) ??
        nonEmptyString(c.verifiedName) ??
        prev?.pushName ??
        null;
      const shortName = nonEmptyString(c.short) ?? prev?.shortName ?? null;
      this.contacts.set(jid, {
        jid,
        phoneE164: phone,
        savedName,
        pushName,
        shortName,
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
      const phone =
        isGroup || isStatusOrBroadcast || isChannel ? null : jidToWaId(jid);
      const prev = this.chats.get(jid);
      this.chats.set(jid, {
        jid,
        phoneE164: phone,
        name: nonEmptyString(chat.name) || prev?.name || null,
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
    return [...this.chats.values()].map(({ messages: _m, ...chat }) => chat);
  }

  /**
   * Bounded on-demand history request (Baileys 6.7.x fetchMessageHistory).
   * Requires an existing oldest message cursor; waits briefly for history events.
   * Never enables unlimited/full-history sync.
   */
  async requestBoundedHistory(
    chatJid: string,
    opts: { limit: number; waitMs?: number } = {
      limit: WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT,
    }
  ): Promise<boolean> {
    if (!this.connected || !this.historyFetcher) return false;
    const jid = normalizeJid(chatJid);
    if (this.requestedHistoryChats.has(jid)) return false;
    const chat = this.chats.get(jid);
    if (!chat || chat.messages.size === 0) return false;

    const oldest = [...chat.messages.values()].sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
    )[0];
    if (!oldest) return false;

    this.requestedHistoryChats.add(jid);
    const generationBefore = this.historyWaitGeneration;
    try {
      await this.historyFetcher(
        Math.max(1, Math.min(opts.limit, WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT)),
        {
          remoteJid: jid,
          id: oldest.providerMessageId,
          fromMe: oldest.fromMe,
        },
        Date.parse(oldest.occurredAt)
      );
      await this.waitForHistoryEvent(
        opts.waitMs ?? WHATSAPP_WEB_SYNC_HISTORY_WAIT_MS,
        generationBefore
      );
      return this.historyWaitGeneration > generationBefore;
    } catch {
      return false;
    }
  }

  async fetchMessages(
    chatJid: string,
    opts: { limit: number; sinceMs: number }
  ): Promise<WhatsAppWebSyncMessage[]> {
    const jid = normalizeJid(chatJid);
    // Best-effort bounded provider request before reading the local cache.
    await this.requestBoundedHistory(jid, {
      limit: Math.min(opts.limit, WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT),
    });
    const chat = this.chats.get(jid);
    if (!chat) return [];
    return [...chat.messages.values()]
      .filter((m) => {
        const ts = Date.parse(m.occurredAt);
        return Number.isFinite(ts) && ts >= opts.sinceMs;
      })
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
      .slice(-Math.max(1, opts.limit));
  }

  getHistoryCoverageMeta(windowStartMs: number): WhatsAppWebHistoryCoverageMeta {
    const timestamps: number[] = [];
    for (const chat of this.chats.values()) {
      for (const m of chat.messages.values()) {
        const ts = Date.parse(m.occurredAt);
        if (Number.isFinite(ts)) timestamps.push(ts);
      }
    }
    const sourceReady = this.connected && (timestamps.length > 0 || this.providerHistoryEventObserved);
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const ts of timestamps) {
      if (oldest === null || ts < oldest) oldest = ts;
      if (newest === null || ts > newest) newest = ts;
    }

    let coverage: WhatsAppWebHistoryCoverage = "unknown";
    if (!this.connected) {
      coverage = "unknown";
    } else if (timestamps.length === 0) {
      coverage = this.providerHistoryEventObserved ? "empty" : "empty";
    } else if (oldest !== null && oldest <= windowStartMs) {
      // We may have messages at/before the window start, but companion on-demand
      // history is not a reliable guarantee of a complete 7-day archive.
      coverage = "partial";
    } else {
      coverage = "available_only";
    }

    return {
      sourceReady,
      coverage,
      providerHistoryEventObserved: this.providerHistoryEventObserved,
      oldestAvailableAt: oldest !== null ? new Date(oldest).toISOString() : null,
      newestAvailableAt: newest !== null ? new Date(newest).toISOString() : null,
      onDemandHistorySupported: this.historyFetcher != null,
    };
  }

  private waitForHistoryEvent(
    waitMs: number,
    generationBefore: number
  ): Promise<void> {
    if (this.historyWaitGeneration > generationBefore) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (
          this.historyWaitGeneration > generationBefore ||
          Date.now() - started >= waitMs
        ) {
          resolve();
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }
}
