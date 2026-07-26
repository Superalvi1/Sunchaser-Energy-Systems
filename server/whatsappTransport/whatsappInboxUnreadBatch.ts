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

export function isNewerThanWatermark(
  message: InboxMessageRef,
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
