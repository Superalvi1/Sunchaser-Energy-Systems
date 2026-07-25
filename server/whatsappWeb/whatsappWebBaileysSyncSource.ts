/**
 * In-memory Baileys sync source.
 * Populated from contacts/chats/history events while the socket is connected.
 * Bounded on-demand history uses request-ID correlation (peerDataRequestSessionId).
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

export class BaileysInMemorySyncSource implements WhatsAppWebSyncSource {
  private connected = false;
  private selfJid: string | null = null;
  private readonly contacts = new Map<string, InternalContact>();
  private readonly chats = new Map<string, InternalChat>();
  private historyFetcher: BaileysHistoryFetchFn | null = null;
  private providerHistoryEventObserved = false;

  /** In-flight per-chat protection (not permanent). */
  private readonly inFlightByChat = new Map<string, Promise<boolean>>();
  /** Active waiters keyed by fetchMessageHistory request/session id. */
  private readonly pendingByRequestId = new Map<string, PendingHistoryWait>();
  /**
   * Matching events that arrived after fetch returned an id but before the
   * waiter was registered (or while the call was still in flight).
   */
  private readonly earlyMatchedRequestIds = new Set<string>();

  setConnected(connected: boolean, selfJid?: string | null): void {
    this.connected = connected;
    if (selfJid !== undefined) this.selfJid = selfJid ? normalizeJid(selfJid) : null;
    if (!connected) {
      this.cancelPendingHistoryWaits();
      this.historyFetcher = null;
    }
  }

  setHistoryFetcher(fn: BaileysHistoryFetchFn | null): void {
    this.historyFetcher = fn;
  }

  /**
   * Ingest a messaging-history.set payload, then resolve only the matching
   * on-demand waiter (exact peerDataRequestSessionId).
   */
  handleHistorySet(payload: BaileysHistorySetPayload): void {
    this.providerHistoryEventObserved = true;
    if (payload.contacts) this.ingestContacts(payload.contacts);
    if (payload.chats) this.ingestChats(payload.chats);
    if (payload.messages) this.ingestMessages(payload.messages);

    const requestId = nonEmptyString(payload.peerDataRequestSessionId);
    if (!requestId) {
      // Initial / uncorrelated history still populates cache + coverage.
      return;
    }

    const pending = this.pendingByRequestId.get(requestId);
    if (pending && !pending.settled) {
      this.settlePending(pending, true);
      return;
    }
    // Race: matching event before waiter registration.
    this.earlyMatchedRequestIds.add(requestId);
  }

  /** @deprecated Prefer handleHistorySet — kept for narrow test hooks. */
  markProviderHistoryEvent(peerDataRequestSessionId?: string | null): void {
    this.handleHistorySet({ peerDataRequestSessionId });
  }

  /** Cancel all pending on-demand waits (disconnect / logout / end). */
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
      const jid = normalizeJid(String(c.id || c.jid || ""));
      if (!jid || jid.endsWith("@g.us")) continue;
      const phone = jidToWaId(jid);
      if (!phone) continue;
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
   * Correlates via returned request id ↔ peerDataRequestSessionId.
   * In-flight per chat only — timeouts/errors/disconnects allow retry.
   */
  async requestBoundedHistory(
    chatJid: string,
    opts: { limit: number; waitMs?: number } = {
      limit: WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT,
    }
  ): Promise<boolean> {
    if (!this.connected || !this.historyFetcher) return false;
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
    } else if (oldest !== null && oldest <= windowStartMs) {
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

  /** Test seam: whether a chat currently has an in-flight history request. */
  __testHasInFlightHistory(chatJid: string): boolean {
    return this.inFlightByChat.has(normalizeJid(chatJid));
  }

  /** Test seam: pending waiter count. */
  __testPendingWaitCount(): number {
    return this.pendingByRequestId.size;
  }

  private async runBoundedHistoryRequest(
    jid: string,
    opts: { limit: number; waitMs?: number }
  ): Promise<boolean> {
    const fetcher = this.historyFetcher;
    if (!this.connected || !fetcher) return false;
    const chat = this.chats.get(jid);
    if (!chat || chat.messages.size === 0) return false;

    const oldest = [...chat.messages.values()].sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
    )[0];
    if (!oldest) return false;

    try {
      const rawId = await fetcher(
        Math.max(
          1,
          Math.min(opts.limit, WHATSAPP_WEB_SYNC_HISTORY_REQUEST_COUNT)
        ),
        {
          remoteJid: jid,
          id: oldest.providerMessageId,
          fromMe: oldest.fromMe,
        },
        Date.parse(oldest.occurredAt)
      );
      const requestId = nonEmptyString(rawId);
      if (!requestId) return false;
      if (!this.connected) return false;

      // Event may have arrived while fetchMessageHistory was awaiting.
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
      // Provider failure — in-flight chat lock cleared in requestBoundedHistory finally.
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

      // Re-check race after registration.
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
