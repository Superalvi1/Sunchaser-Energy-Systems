/**
 * Batch unread-state helpers — avoid N+1 watermark/message queries.
 * Per-actor authorization is enforced by the caller (ReadStateService).
 */
import type { WhatsAppReadWatermark } from "./whatsappInboxDatabaseTypes.ts";
import type {
  InboxMessageRef,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";

export type ConversationUnreadState = {
  isUnread: boolean;
  unreadCount: number;
};

/**
 * Max rows returned by a single Supabase/PostgREST messages select used for
 * unread aggregation. Callers must page until a short page is returned.
 * (PostgREST defaults are commonly 1000; we stay explicitly below that.)
 */
export const SUPABASE_UNREAD_MESSAGE_PAGE_SIZE = 500;

export type InboundUnreadPageCursor = {
  at: string;
  id: string;
};

export function isNewerThanWatermark(
  message: Pick<InboxMessageRef, "createdAt" | "id">,
  watermark: WhatsAppReadWatermark | null
): boolean {
  if (
    !watermark?.lastReadInboundMessageCreatedAt ||
    !watermark.lastReadInboundMessageId
  ) {
    return true;
  }
  if (message.createdAt > watermark.lastReadInboundMessageCreatedAt) return true;
  if (message.createdAt < watermark.lastReadInboundMessageCreatedAt) {
    return false;
  }
  return message.id > watermark.lastReadInboundMessageId;
}

/** In-memory batch: one pass over messages + watermarks. */
export function batchUnreadStateFromMemory(
  store: WhatsAppInboxMemoryStore,
  conversationIds: string[],
  userId: string
): Map<string, ConversationUnreadState> {
  const idSet = new Set(conversationIds);
  const counts = new Map<string, number>();
  for (const id of conversationIds) counts.set(id, 0);

  for (const message of store.messages.values()) {
    if (!idSet.has(message.conversationId)) continue;
    if (message.direction !== "inbound") continue;
    if (message.isBackfill === true) continue;
    const watermark =
      store.watermarks.get(
        store.watermarkKey(message.conversationId, userId)
      ) ?? null;
    if (!isNewerThanWatermark(message, watermark)) continue;
    counts.set(
      message.conversationId,
      (counts.get(message.conversationId) ?? 0) + 1
    );
  }

  const out = new Map<string, ConversationUnreadState>();
  for (const id of conversationIds) {
    const unreadCount = counts.get(id) ?? 0;
    out.set(id, { unreadCount, isUnread: unreadCount > 0 });
  }
  return out;
}

/** Compute unread counts from preloaded watermarks + inbound message refs. */
export function batchUnreadStateFromSnapshots(
  conversationIds: string[],
  watermarksByConversationId: Map<string, WhatsAppReadWatermark | null>,
  inboundMessages: InboxMessageRef[]
): Map<string, ConversationUnreadState> {
  const counts = new Map<string, number>();
  for (const id of conversationIds) counts.set(id, 0);

  for (const message of inboundMessages) {
    if (message.direction !== "inbound") continue;
    if (message.isBackfill === true) continue;
    if (!counts.has(message.conversationId)) continue;
    const watermark =
      watermarksByConversationId.get(message.conversationId) ?? null;
    if (!isNewerThanWatermark(message, watermark)) continue;
    counts.set(
      message.conversationId,
      (counts.get(message.conversationId) ?? 0) + 1
    );
  }

  const out = new Map<string, ConversationUnreadState>();
  for (const id of conversationIds) {
    const unreadCount = counts.get(id) ?? 0;
    out.set(id, { unreadCount, isUnread: unreadCount > 0 });
  }
  return out;
}

export type UnreadPagedFetchResult = {
  states: Map<string, ConversationUnreadState>;
  pagesFetched: number;
  rowsProcessed: number;
  /** Message ids seen — used by tests to prove no cross-page duplication. */
  seenMessageIds: Set<string>;
};

/**
 * Exact unread aggregation over an explicitly paginated inbound fetch.
 * Does not assume any single response contains every matching row.
 */
export async function accumulateUnreadFromPagedFetch(input: {
  conversationIds: string[];
  watermarksByConversationId: Map<string, WhatsAppReadWatermark | null>;
  pageSize: number;
  fetchPage: (args: {
    cursor: InboundUnreadPageCursor | null;
    limit: number;
  }) => Promise<
    Array<{
      id: string;
      conversationId: string;
      createdAt: string;
      direction?: string;
      isBackfill?: boolean;
    }>
  >;
}): Promise<UnreadPagedFetchResult> {
  const pageSize = Math.max(1, Math.floor(input.pageSize));
  const counts = new Map<string, number>();
  for (const id of input.conversationIds) counts.set(id, 0);

  const seenMessageIds = new Set<string>();
  let pagesFetched = 0;
  let rowsProcessed = 0;
  let cursor: InboundUnreadPageCursor | null = null;

  for (;;) {
    const page = await input.fetchPage({ cursor, limit: pageSize });
    pagesFetched += 1;
    if (page.length === 0) break;

    for (const message of page) {
      if (seenMessageIds.has(message.id)) {
        // Keyset must not revisit rows; ignore duplicates defensively.
        continue;
      }
      seenMessageIds.add(message.id);
      rowsProcessed += 1;

      if (message.direction != null && message.direction !== "inbound") {
        continue;
      }
      if (message.isBackfill === true) continue;
      if (!counts.has(message.conversationId)) continue;

      const watermark =
        input.watermarksByConversationId.get(message.conversationId) ?? null;
      if (!isNewerThanWatermark(message, watermark)) continue;
      counts.set(
        message.conversationId,
        (counts.get(message.conversationId) ?? 0) + 1
      );
    }

    if (page.length < pageSize) break;
    const last = page[page.length - 1]!;
    cursor = { at: last.createdAt, id: last.id };
  }

  const states = new Map<string, ConversationUnreadState>();
  for (const id of input.conversationIds) {
    const unreadCount = counts.get(id) ?? 0;
    states.set(id, { unreadCount, isUnread: unreadCount > 0 });
  }
  return { states, pagesFetched, rowsProcessed, seenMessageIds };
}
