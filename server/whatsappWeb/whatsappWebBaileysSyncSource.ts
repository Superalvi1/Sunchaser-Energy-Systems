/**
 * In-memory Baileys sync source (Baileys 6.7.x).
 * Populated from contacts/chats/history events while the socket is connected.
 * Resolves @lid via Contact.jid / *Pn / *Alt fields — never treats LID digits as phones.
 */
import { WhatsAppLidPhoneMap } from "./whatsappWebIdentity.ts";
import { jidToWaId, waIdToChatJid } from "./whatsappWebNormalize.ts";
import {
  isExcludedSyncRemoteJid,
  normalizeJid,
  syncWindowStartMs,
  WHATSAPP_WEB_SYNC_CACHE_CAP_PER_CHAT,
  WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT,
  WHATSAPP_WEB_SYNC_HISTORY_WAIT_MS,
  WHATSAPP_WEB_SYNC_WINDOW_DAYS,
  type WhatsAppWebHistoryAvailability,
  type WhatsAppWebHistoryCoverage,
  type WhatsAppWebHistoryCoverageMeta,
  type WhatsAppWebSyncChat,
  type WhatsAppWebSyncContact,
  type WhatsAppWebSyncMessage,
  type WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";

type HistoryCursor = {
  remoteJid: string;
  id: string;
  fromMe: boolean;
  timestampMs: number;
};

type InternalContact = WhatsAppWebSyncContact;
type InternalChat = WhatsAppWebSyncChat & {
  messages: Map<string, WhatsAppWebSyncMessage>;
  historyCursor: HistoryCursor | null;
};

export type BaileysHistoryFetchFn = (
  count: number,
  oldestMsgKey: {
    remoteJid?: string | null;
    id?: string | null;
    fromMe?: boolean | null;
  },
  oldestMsgTimestamp: number
) => Promise<string>;

export type BaileysHistorySetPayload = {
  peerDataRequestSessionId?: string | null;
  chats?: Array<Record<string, unknown>>;
  contacts?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
};

type PendingHistoryWait = {
  requestId: string;
  chatJid: string;
  settled: boolean;
  resolve: (matched: boolean) => void;
  timer: ReturnType<typeof setTimeout> | null;
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

function nonEmptyString(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
}

function keyFields(msg: Record<string, unknown>): Record<string, unknown> {
  return (msg.key as Record<string, unknown> | undefined) ?? {};
}

export class BaileysInMemorySyncSource implements WhatsAppWebSyncSource {
  private connected = false;
  private selfJid: string | null = null;
  private readonly contacts = new Map<string, InternalContact>();
  private readonly chats = new Map<string, InternalChat>();
  private readonly lidMap: WhatsAppLidPhoneMap;
  private readonly nowMs: () => number;
  private historyFetcher: BaileysHistoryFetchFn | null = null;
  private providerHistoryEventObserved = false;
  private lastAvailability: WhatsAppWebHistoryAvailability = "unknown";

  private readonly inFlightByChat = new Map<string, Promise<boolean>>();
  private readonly pendingByRequestId = new Map<string, PendingHistoryWait>();
  private readonly earlyMatchedRequestIds = new Set<string>();

  constructor(options?: {
    lidMap?: WhatsAppLidPhoneMap;
    /** Injectable clock for sync-window tests (defaults to Date.now). */
    now?: () => number;
  }) {
    // Prefer an injected process-shared map so live inbound can resolve LIDs
    // learned from contacts/chats/history in the same runtime.
    this.lidMap = options?.lidMap ?? new WhatsAppLidPhoneMap();
    this.nowMs = options?.now ?? (() => Date.now());
  }

  getLidMap(): WhatsAppLidPhoneMap {
    return this.lidMap;
  }

  setConnected(connected: boolean, selfJid?: string | null): void {
    this.connected = connected;
    if (selfJid !== undefined) {
      const phone = jidToWaId(String(selfJid || ""));
      this.selfJid = phone ? waIdToChatJid(phone) : normalizeJid(String(selfJid || ""));
    }
    if (!connected) {
      this.cancelPendingHistoryWaits();
      this.historyFetcher = null;
    }
  }

  setHistoryFetcher(fn: BaileysHistoryFetchFn | null): void {
    this.historyFetcher = fn;
  }

  getLastHistoryAvailability(): WhatsAppWebHistoryAvailability {
    return this.lastAvailability;
  }

  handleHistorySet(payload: BaileysHistorySetPayload): void {
    this.providerHistoryEventObserved = true;
    if (payload.contacts) this.ingestContacts(payload.contacts);
    if (payload.chats) this.ingestChats(payload.chats);
    if (payload.messages) this.ingestMessages(payload.messages);

    const requestId = nonEmptyString(payload.peerDataRequestSessionId);
    if (!requestId) return;

    const pending = this.pendingByRequestId.get(requestId);
    if (pending && !pending.settled) {
      this.settlePending(pending, true);
      return;
    }
    this.earlyMatchedRequestIds.add(requestId);
  }

  markProviderHistoryEvent(peerDataRequestSessionId?: string | null): void {
    this.handleHistorySet({ peerDataRequestSessionId });
  }

  cancelPendingHistoryWaits(): void {
    for (const pending of [...this.pendingByRequestId.values()]) {
      this.settlePending(pending, false);
    }
    this.pendingByRequestId.clear();
    this.inFlightByChat.clear();
    this.earlyMatchedRequestIds.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSelfJid(): string | null {
    return this.selfJid;
  }

  ingestContacts(rawContacts: Array<Record<string, unknown>>): void {
    for (const c of rawContacts) {
      const identity = this.lidMap.resolveIdentity({
        contactId: String(c.id || ""),
        contactJid: c.jid != null ? String(c.jid) : null,
        contactLid: c.lid != null ? String(c.lid) : null,
        remoteJid: String(c.id || c.jid || ""),
      });
      if (!identity) continue;

      const jid = identity.phoneJid;
      const prev = this.contacts.get(jid);
      const savedName = nonEmptyString(c.name) ?? prev?.savedName ?? null;
      const pushName =
        nonEmptyString(c.notify) ??
        nonEmptyString(c.verifiedName) ??
        prev?.pushName ??
        null;
      const shortName = nonEmptyString(c.short) ?? prev?.shortName ?? null;
      this.contacts.set(jid, {
        jid,
        phoneE164: identity.phoneE164,
        savedName,
        pushName,
        shortName,
        isBusiness: Boolean(c.isBusiness || c.verifiedName),
      });
    }
  }

  ingestChats(rawChats: Array<Record<string, unknown>>): void {
    for (const chat of rawChats) {
      const rawId = String(chat.id || chat.jid || "");
      // Never cache group/status/broadcast/newsletter chats for individual sync.
      if (isExcludedSyncRemoteJid(rawId) || Boolean(chat.isGroup)) continue;

      const identity = this.lidMap.resolveIdentity({
        remoteJid: rawId,
        remoteJidAlt:
          chat.remoteJidAlt != null ? String(chat.remoteJidAlt) : null,
        contactJid: chat.jid != null ? String(chat.jid) : null,
      });
      if (!identity) continue;

      const jid = identity.phoneJid;
      const prev = this.chats.get(jid);
      const cursorFromChat =
        this.extractChatCursor(chat, jid) ?? prev?.historyCursor ?? null;

      // Canonicalize chat first so nested messages merge into the same map.
      const entry: InternalChat = {
        jid,
        phoneE164: identity.phoneE164,
        name: nonEmptyString(chat.name) || prev?.name || null,
        isGroup: false,
        isStatusOrBroadcast: false,
        isChannel: false,
        messages: prev?.messages ?? new Map(),
        historyCursor: cursorFromChat,
      };
      this.chats.set(jid, entry);

      if (Array.isArray(chat.messages)) {
        this.ingestHistorySyncMsgs(
          chat.messages as Array<Record<string, unknown>>,
          jid
        );
      }

      // Re-read after nested ingest so cursor/messages are not overwritten.
      const after = this.chats.get(jid);
      if (after) {
        after.name = nonEmptyString(chat.name) || after.name || null;
        if (cursorFromChat && !after.historyCursor) {
          after.historyCursor = cursorFromChat;
        } else if (
          cursorFromChat &&
          after.historyCursor &&
          cursorFromChat.timestampMs < after.historyCursor.timestampMs
        ) {
          after.historyCursor = cursorFromChat;
        }
        this.pruneChatCache(after);
      }
    }
  }

  ingestMessages(rawMessages: Array<Record<string, unknown>>): void {
    const windowStartMs = syncWindowStartMs(
      this.nowMs(),
      WHATSAPP_WEB_SYNC_WINDOW_DAYS
    );

    for (const msg of rawMessages) {
      const key = keyFields(msg);
      const providerMessageId = String(key.id || "");
      if (!providerMessageId) continue;

      // remoteJid is the authoritative chat identity. Group/status/newsletter
      // messages are excluded before any participant/alt canonicalization.
      const remoteJid = key.remoteJid != null ? String(key.remoteJid) : "";
      if (!remoteJid || isExcludedSyncRemoteJid(remoteJid)) continue;

      // Chat identity = remoteJid (+ remoteJidAlt for LID→PN). Never participant*/sender*.
      const identity = this.lidMap.resolveIdentity({
        remoteJid,
        remoteJidAlt:
          key.remoteJidAlt != null ? String(key.remoteJidAlt) : null,
      });
      if (!identity) continue;

      // Chat key is always the resolved phone JID of remoteJid (never participant).
      const chatJid = identity.phoneJid;
      if (!this.chats.has(chatJid)) {
        this.chats.set(chatJid, {
          jid: chatJid,
          phoneE164: identity.phoneE164,
          name: null,
          isGroup: false,
          isStatusOrBroadcast: false,
          isChannel: false,
          messages: new Map(),
          historyCursor: null,
        });
      }
      const chat = this.chats.get(chatJid);
      if (!chat || chat.isGroup || chat.isStatusOrBroadcast || chat.isChannel) {
        continue;
      }

      const ts = Number(msg.messageTimestamp || 0);
      const occurredAt = ts
        ? new Date(ts * 1000).toISOString()
        : new Date().toISOString();
      const cursorTs = ts ? ts * 1000 : Date.parse(occurredAt);
      const finiteCursorTs = Number.isFinite(cursorTs) ? cursorTs : Date.now();

      // Always retain genuine oldest cursor metadata (no body required).
      if (!chat.historyCursor || finiteCursorTs <= chat.historyCursor.timestampMs) {
        chat.historyCursor = {
          remoteJid: chatJid,
          id: providerMessageId,
          fromMe: key.fromMe === true,
          timestampMs: finiteCursorTs,
        };
      }

      // Bound bodies at ingestion: drop out-of-window message bodies.
      if (Number.isFinite(cursorTs) && cursorTs < windowStartMs) {
        this.pruneChatCache(chat);
        continue;
      }

      const media = mediaMeta(msg);
      chat.messages.set(providerMessageId, {
        providerMessageId,
        chatJid,
        fromMe: key.fromMe === true,
        text: extractText(msg),
        messageType: messageTypeOf(msg),
        occurredAt,
        // Metadata only — never binary media payloads.
        mimeType: media.mimeType,
        caption: media.caption,
        filename: media.filename,
      });
      this.pruneChatCache(chat);
    }
  }

  /** Keep newest N in-window bodies; cursor metadata is independent. */
  private pruneChatCache(chat: InternalChat): void {
    const windowStartMs = syncWindowStartMs(
      this.nowMs(),
      WHATSAPP_WEB_SYNC_WINDOW_DAYS
    );
    for (const [id, message] of [...chat.messages.entries()]) {
      const ts = Date.parse(message.occurredAt);
      if (Number.isFinite(ts) && ts < windowStartMs) {
        chat.messages.delete(id);
      }
    }
    if (chat.messages.size <= WHATSAPP_WEB_SYNC_CACHE_CAP_PER_CHAT) return;
    const sorted = [...chat.messages.values()].sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
    );
    const drop = sorted.length - WHATSAPP_WEB_SYNC_CACHE_CAP_PER_CHAT;
    for (let i = 0; i < drop; i += 1) {
      const oldest = sorted[i];
      if (oldest) chat.messages.delete(oldest.providerMessageId);
    }
  }

  async listContacts(): Promise<WhatsAppWebSyncContact[]> {
    return [...this.contacts.values()];
  }

  async listChats(): Promise<WhatsAppWebSyncChat[]> {
    return [...this.chats.values()].map(
      ({ messages: _m, historyCursor: _c, ...chat }) => chat
    );
  }

  async requestBoundedHistory(
    chatJid: string,
    opts: { limit: number; waitMs?: number } = {
      limit: WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT,
    }
  ): Promise<boolean> {
    if (!this.connected || !this.historyFetcher) {
      this.lastAvailability = "history_not_available";
      return false;
    }
    const jid = normalizeJid(chatJid);
    const existing = this.inFlightByChat.get(jid);
    if (existing) return existing;

    const run = this.runBoundedHistoryRequest(jid, opts);
    this.inFlightByChat.set(jid, run);
    try {
      return await run;
    } finally {
      if (this.inFlightByChat.get(jid) === run) {
        this.inFlightByChat.delete(jid);
      }
    }
  }

  async fetchMessages(
    chatJid: string,
    opts: { limit: number; sinceMs: number }
  ): Promise<WhatsAppWebSyncMessage[]> {
    const jid = normalizeJid(chatJid);
    const chat = this.chats.get(jid);
    const hasCursor =
      Boolean(chat?.historyCursor) || Boolean(chat && chat.messages.size > 0);

    if (!hasCursor) {
      this.lastAvailability = this.providerHistoryEventObserved
        ? "history_not_available"
        : "empty_companion_cache";
    } else {
      await this.requestBoundedHistory(jid, {
        limit: Math.min(opts.limit, WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT),
      });
    }

    const after = this.chats.get(jid);
    if (!after) return [];
    return [...after.messages.values()]
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
    const sourceReady =
      this.connected &&
      (timestamps.length > 0 || this.providerHistoryEventObserved);
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
      coverage = "empty";
      if (this.lastAvailability === "unknown") {
        this.lastAvailability = this.providerHistoryEventObserved
          ? "history_not_available"
          : "empty_companion_cache";
      }
    } else if (oldest !== null && oldest <= windowStartMs) {
      coverage = "partial";
      this.lastAvailability = "partially_available";
    } else {
      coverage = "available_only";
      this.lastAvailability = "ready";
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

  __testHasInFlightHistory(chatJid: string): boolean {
    return this.inFlightByChat.has(normalizeJid(chatJid));
  }

  __testPendingWaitCount(): number {
    return this.pendingByRequestId.size;
  }

  private extractChatCursor(
    chat: Record<string, unknown>,
    fallbackJid: string
  ): HistoryCursor | null {
    const msgs = chat.messages as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(msgs) || msgs.length === 0) return null;
    let oldest: HistoryCursor | null = null;
    for (const entry of msgs) {
      const inner =
        (entry.message as Record<string, unknown> | undefined) ?? entry;
      const key = keyFields(inner);
      const id = nonEmptyString(key.id);
      if (!id) continue;
      const ts = Number(inner.messageTimestamp || chat.lastMsgTimestamp || 0);
      const timestampMs = ts ? ts * 1000 : 0;
      if (!timestampMs) continue;
      if (!oldest || timestampMs < oldest.timestampMs) {
        oldest = {
          remoteJid: fallbackJid,
          id,
          fromMe: key.fromMe === true,
          timestampMs,
        };
      }
    }
    return oldest;
  }

  /** Test helper: inspect per-chat cache (messages + cursor metadata). */
  __testPeekChat(chatJid: string): {
    messageIds: string[];
    messageCount: number;
    historyCursor: HistoryCursor | null;
  } | null {
    const chat = this.chats.get(normalizeJid(chatJid));
    if (!chat) return null;
    return {
      messageIds: [...chat.messages.keys()],
      messageCount: chat.messages.size,
      historyCursor: chat.historyCursor
        ? { ...chat.historyCursor }
        : null,
    };
  }

  private ingestHistorySyncMsgs(
    entries: Array<Record<string, unknown>>,
    chatJid: string
  ): void {
    if (isExcludedSyncRemoteJid(chatJid)) return;
    const flattened: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
      const inner =
        (entry.message as Record<string, unknown> | undefined) ?? entry;
      if (!inner.key && !inner.message) continue;
      const key = {
        ...keyFields(inner),
        // Nested conversation messages inherit the parent chat remoteJid.
        remoteJid: chatJid,
      };
      flattened.push({ ...inner, key });
    }
    if (flattened.length) this.ingestMessages(flattened);
  }

  private async runBoundedHistoryRequest(
    jid: string,
    opts: { limit: number; waitMs?: number }
  ): Promise<boolean> {
    const fetcher = this.historyFetcher;
    if (!this.connected || !fetcher) {
      this.lastAvailability = "history_not_available";
      return false;
    }
    const chat = this.chats.get(jid);
    if (!chat) {
      this.lastAvailability = "empty_companion_cache";
      return false;
    }

    let cursor = chat.historyCursor;
    if (!cursor && chat.messages.size > 0) {
      const oldest = [...chat.messages.values()].sort(
        (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
      )[0];
      if (oldest) {
        cursor = {
          remoteJid: jid,
          id: oldest.providerMessageId,
          fromMe: oldest.fromMe,
          timestampMs: Date.parse(oldest.occurredAt) || Date.now(),
        };
      }
    }

    // Baileys fetchMessageHistory requires a valid oldest message key.
    // Do not invent one — report availability instead.
    if (!cursor) {
      this.lastAvailability = this.providerHistoryEventObserved
        ? "history_not_available"
        : "empty_companion_cache";
      return false;
    }

    try {
      const rawId = await fetcher(
        Math.max(
          1,
          Math.min(opts.limit, WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT)
        ),
        {
          remoteJid: cursor.remoteJid,
          id: cursor.id,
          fromMe: cursor.fromMe,
        },
        cursor.timestampMs
      );
      const requestId = nonEmptyString(rawId);
      if (!requestId) {
        this.lastAvailability = "history_not_available";
        return false;
      }
      if (!this.connected) return false;

      if (this.earlyMatchedRequestIds.has(requestId)) {
        this.earlyMatchedRequestIds.delete(requestId);
        return true;
      }

      return await this.waitForMatchingRequest(
        requestId,
        jid,
        opts.waitMs ?? WHATSAPP_WEB_SYNC_HISTORY_WAIT_MS
      );
    } catch {
      this.lastAvailability = "history_not_available";
      return false;
    }
  }

  private waitForMatchingRequest(
    requestId: string,
    chatJid: string,
    waitMs: number
  ): Promise<boolean> {
    if (this.earlyMatchedRequestIds.has(requestId)) {
      this.earlyMatchedRequestIds.delete(requestId);
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const pending: PendingHistoryWait = {
        requestId,
        chatJid,
        settled: false,
        resolve,
        timer: null,
      };
      this.pendingByRequestId.set(requestId, pending);

      if (this.earlyMatchedRequestIds.has(requestId)) {
        this.earlyMatchedRequestIds.delete(requestId);
        this.settlePending(pending, true);
        return;
      }

      pending.timer = setTimeout(() => {
        this.settlePending(pending, false);
      }, waitMs);
    });
  }

  private settlePending(pending: PendingHistoryWait, matched: boolean): void {
    if (pending.settled) return;
    pending.settled = true;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    this.pendingByRequestId.delete(pending.requestId);
    pending.resolve(matched);
  }
}
