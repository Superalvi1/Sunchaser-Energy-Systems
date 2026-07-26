/**
 * Inbound-only read watermark service (Revision 3 / P1-3).
 */
import type { RequestActor } from "../middleware/actor.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import type { WhatsAppReadWatermark } from "./whatsappInboxDatabaseTypes.ts";
import type { WhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import { canViewInbox } from "./whatsappInboxPermissions.ts";
import type { WhatsAppInboxReadWatermarkRepository } from "./whatsappInboxReadWatermarkRepository.ts";
import type { ConversationUnreadState } from "./whatsappInboxUnreadBatch.ts";
import {
  beginUnreadIndexBuild,
  endUnreadIndexBuild,
  getUnreadIndexCache,
  invalidateUnreadIndexCache,
  MAX_UNREAD_INDEX_BUILD_ATTEMPTS,
  takeDirtyConversationIds,
  tryPublishUnreadIndex,
  writeBackUnreadIndexEntries,
  type UnreadIndexSnapshot,
} from "./whatsappInboxUnreadIndexCache.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import type { KeysetCursor } from "./whatsappInboxRepoSupport.ts";

function isStrictlyNewerInbound(
  candidate: { createdAt: string; id: string },
  watermark: WhatsAppReadWatermark | null
): boolean {
  if (
    !watermark?.lastReadInboundMessageCreatedAt ||
    !watermark.lastReadInboundMessageId
  ) {
    return true;
  }
  if (candidate.createdAt > watermark.lastReadInboundMessageCreatedAt) {
    return true;
  }
  if (candidate.createdAt < watermark.lastReadInboundMessageCreatedAt) {
    return false;
  }
  return candidate.id > watermark.lastReadInboundMessageId;
}

const UNREAD_BATCH_CHUNK = 100;

export class ReadStateService {
  constructor(
    private readonly conversations: WhatsAppInboxConversationRepository,
    private readonly watermarks: WhatsAppInboxReadWatermarkRepository,
    private readonly companyId: string = DEFAULT_COMPANY_ID
  ) {}

  async resolveAndAdvance(
    conversationId: string,
    input: {
      actor: RequestActor;
      lastSeenMessageId: string;
      lastSeenMessageCreatedAt: string;
    }
  ): Promise<{
    watermark: WhatsAppReadWatermark;
    advanced: boolean;
  }> {
    if (!canViewInbox(input.actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    if (!input.lastSeenMessageId || !input.lastSeenMessageCreatedAt) {
      throw new InboxServiceError(
        "invalid_argument",
        "lastSeenMessageId and lastSeenMessageCreatedAt are required"
      );
    }

    const conversation = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (!conversation) {
      throw new InboxServiceError("not_found", "Conversation not found");
    }

    const resolvedInbound = await this.watermarks.findLatestInboundAtOrBefore(
      conversationId,
      {
        at: input.lastSeenMessageCreatedAt,
        id: input.lastSeenMessageId,
      },
      this.companyId
    );

    const existing = await this.watermarks.get(
      conversationId,
      input.actor.id,
      this.companyId
    );

    if (!resolvedInbound) {
      const watermark =
        existing ??
        (await this.watermarks.upsert({
          conversationId,
          userId: input.actor.id,
          lastReadInboundMessageId: null,
          lastReadInboundMessageCreatedAt: null,
          companyId: this.companyId,
        }));
      invalidateUnreadIndexCache(this.companyId, input.actor.id);
      return { watermark, advanced: false };
    }

    if (!isStrictlyNewerInbound(resolvedInbound, existing)) {
      return { watermark: existing!, advanced: false };
    }

    const watermark = await this.watermarks.upsert({
      conversationId,
      userId: input.actor.id,
      lastReadInboundMessageId: resolvedInbound.id,
      lastReadInboundMessageCreatedAt: resolvedInbound.createdAt,
      companyId: this.companyId,
    });
    invalidateUnreadIndexCache(this.companyId, input.actor.id);
    return { watermark, advanced: true };
  }

  async getUnreadCount(
    conversationId: string,
    actor: RequestActor
  ): Promise<number> {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    const conversation = await this.conversations.getById(
      conversationId,
      this.companyId
    );
    if (!conversation) {
      throw new InboxServiceError("not_found", "Conversation not found");
    }
    return this.watermarks.countUnreadInbound(
      conversationId,
      actor.id,
      this.companyId
    );
  }

  async hasUnread(
    conversationId: string,
    actor: RequestActor
  ): Promise<boolean> {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    return this.watermarks.hasUnreadInbound(
      conversationId,
      actor.id,
      this.companyId
    );
  }

  /**
   * Batch unread for the given conversation ids using the actor's watermarks.
   * Prefers the short-lived unread index when warm to avoid message scans.
   */
  async batchUnreadState(
    conversationIds: string[],
    actor: RequestActor
  ): Promise<Map<string, ConversationUnreadState>> {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    if (conversationIds.length === 0) return new Map();

    const cached = getUnreadIndexCache(this.companyId, actor.id);
    if (cached) {
      const out = new Map<string, ConversationUnreadState>();
      const missing: string[] = [];
      for (const id of conversationIds) {
        const hit = cached.byId.get(id);
        if (hit) out.set(id, hit);
        else missing.push(id);
      }
      if (missing.length === 0) return out;
      const fetched = await this.watermarks.batchUnreadState(
        missing,
        actor.id,
        this.companyId
      );
      for (const [id, state] of fetched) out.set(id, state);
      writeBackUnreadIndexEntries(this.companyId, actor.id, fetched);
      return out;
    }

    return this.watermarks.batchUnreadState(
      conversationIds,
      actor.id,
      this.companyId
    );
  }

  async countUnreadConversations(actor: RequestActor): Promise<number> {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }
    const index = await this.getOrBuildUnreadIndex(actor);
    return index.totalUnreadCount;
  }

  /**
   * Full per-actor unread index (race-safe publish).
   *
   * Warm hit: flush targeted dirty ids, then conversation delta refresh.
   * Cold build: in-flight handle + publish sequence; invalidation during build
   * cancels publish and retries up to MAX_UNREAD_INDEX_BUILD_ATTEMPTS.
   */
  async getOrBuildUnreadIndex(
    actor: RequestActor
  ): Promise<UnreadIndexSnapshot> {
    if (!canViewInbox(actor)) {
      throw new InboxServiceError("forbidden", "Inbox access denied");
    }

    const warm = getUnreadIndexCache(this.companyId, actor.id);
    if (warm) {
      await this.flushDirtyConversationIds(actor, warm);
      return this.refreshUnreadIndexFromDelta(actor, warm);
    }

    for (let attempt = 0; attempt < MAX_UNREAD_INDEX_BUILD_ATTEMPTS; attempt++) {
      const handle = beginUnreadIndexBuild(this.companyId, actor.id);
      try {
        const built = await this.coldBuildUnreadIndex(actor);
        if (handle.cancelled) continue;

        const published = tryPublishUnreadIndex(
          this.companyId,
          actor.id,
          handle,
          built
        );
        if (!published) continue;

        await this.flushDirtyConversationIds(actor, published);
        return published;
      } finally {
        endUnreadIndexBuild(handle);
      }
    }

    // Bounded fallback: serve an ephemeral exact snapshot without caching so
    // a stampeding invalidation stream cannot loop forever or publish stale.
    const ephemeral = await this.coldBuildUnreadIndex(actor);
    return {
      ...ephemeral,
      publishSeq: -1,
      dirtyIds: new Set<string>(),
      builtAt: Date.now(),
    };
  }

  private async coldBuildUnreadIndex(actor: RequestActor): Promise<{
    byId: Map<string, ConversationUnreadState>;
    totalUnreadCount: number;
    highWaterUpdatedAt: string;
    highWaterId: string;
  }> {
    const ids: string[] = [];
    let highWaterUpdatedAt = "1970-01-01T00:00:00.000Z";
    let highWaterId = "";
    let cursor: KeysetCursor | null = null;
    for (;;) {
      const page = await this.conversations.listByActivity(
        { companyId: this.companyId },
        { cursor, limit: UNREAD_BATCH_CHUNK }
      );
      for (const row of page.rows) {
        ids.push(row.id);
        if (
          row.updatedAt > highWaterUpdatedAt ||
          (row.updatedAt === highWaterUpdatedAt && row.id > highWaterId)
        ) {
          highWaterUpdatedAt = row.updatedAt;
          highWaterId = row.id;
        }
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    const byId = new Map<string, ConversationUnreadState>();
    for (let i = 0; i < ids.length; i += UNREAD_BATCH_CHUNK) {
      const chunk = ids.slice(i, i + UNREAD_BATCH_CHUNK);
      const states = await this.watermarks.batchUnreadState(
        chunk,
        actor.id,
        this.companyId
      );
      for (const [id, state] of states) byId.set(id, state);
    }

    let totalUnreadCount = 0;
    for (const state of byId.values()) {
      if (state.isUnread) totalUnreadCount += 1;
    }

    return {
      byId,
      totalUnreadCount,
      highWaterUpdatedAt,
      highWaterId,
    };
  }

  private async flushDirtyConversationIds(
    actor: RequestActor,
    hit: UnreadIndexSnapshot
  ): Promise<void> {
    const dirty = takeDirtyConversationIds(this.companyId, hit);
    if (dirty.length === 0) return;

    for (let i = 0; i < dirty.length; i += UNREAD_BATCH_CHUNK) {
      const chunk = dirty.slice(i, i + UNREAD_BATCH_CHUNK);
      const states = await this.watermarks.batchUnreadState(
        chunk,
        actor.id,
        this.companyId
      );
      writeBackUnreadIndexEntries(this.companyId, actor.id, states);
    }
  }

  private async refreshUnreadIndexFromDelta(
    actor: RequestActor,
    hit: UnreadIndexSnapshot
  ): Promise<UnreadIndexSnapshot> {
    const touchedIds = new Set<string>();
    let since: KeysetCursor = {
      at: hit.highWaterUpdatedAt,
      id: hit.highWaterId,
    };
    let highWaterUpdatedAt = hit.highWaterUpdatedAt;
    let highWaterId = hit.highWaterId;

    for (;;) {
      const delta = await this.conversations.listDelta(
        { companyId: this.companyId },
        { since, limit: UNREAD_BATCH_CHUNK }
      );
      for (const row of delta.rows) {
        touchedIds.add(row.id);
        if (
          row.updatedAt > highWaterUpdatedAt ||
          (row.updatedAt === highWaterUpdatedAt && row.id > highWaterId)
        ) {
          highWaterUpdatedAt = row.updatedAt;
          highWaterId = row.id;
        }
      }
      if (!delta.nextCursor) break;
      since = delta.nextCursor;
    }

    if (touchedIds.size === 0) {
      hit.highWaterUpdatedAt = highWaterUpdatedAt;
      hit.highWaterId = highWaterId;
      return hit;
    }

    const touched = [...touchedIds];
    for (let i = 0; i < touched.length; i += UNREAD_BATCH_CHUNK) {
      const chunk = touched.slice(i, i + UNREAD_BATCH_CHUNK);
      const states = await this.watermarks.batchUnreadState(
        chunk,
        actor.id,
        this.companyId
      );
      writeBackUnreadIndexEntries(this.companyId, actor.id, states);
    }

    const latest = getUnreadIndexCache(this.companyId, actor.id) ?? hit;
    latest.highWaterUpdatedAt = highWaterUpdatedAt;
    latest.highWaterId = highWaterId;
    return latest;
  }
}
