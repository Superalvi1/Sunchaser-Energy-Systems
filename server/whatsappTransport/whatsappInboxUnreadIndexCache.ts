/**
 * Per-actor unread index cache (LIVE-01-R2/R3).
 *
 * Exact Unread/Read listing without a migration cannot be a single SQL filter
 * on the existing schema. A process-local cache + explicit invalidation bounds
 * live-poll cost so production does not rescan
 * (all conversations × all inbound messages) on every tick.
 *
 * TTL is a safety backstop only — correctness depends on invalidation:
 * - inbound persisted (Meta / WhatsApp Web) → company-wide invalidate
 * - watermark advanced → actor invalidate
 *
 * TTL (60s) is intentionally longer than filtered authoritative refresh (10s)
 * so an unchanged Inbox reuses the warm index across multiple authoritative
 * first-page resets without cold-rebuilding historical inbound pages.
 *
 * Query-cost contract (warm cache hit, no conversation changes):
 * - 1 bounded conversation delta page (usually empty)
 * - 0 message history transfers
 * - O(1) map lookups for page enrichment / filter membership
 *
 * Query-cost contract (warm hit with K touched conversations):
 * - ceil(K/100) conversation delta pages
 * - batchUnreadState only for those K ids (paginated, exact)
 *
 * Query-cost contract (cold build for N conversations):
 * - ceil(N/100) conversation list pages
 * - batchUnreadState in chunks of ≤100 ids (each chunk paginated at 500 rows)
 */
import type { ConversationUnreadState } from "./whatsappInboxUnreadBatch.ts";

/** Safety-backstop TTL; invalidation is the primary correctness mechanism. */
export const UNREAD_INDEX_CACHE_TTL_MS = 60_000;

export type UnreadIndexSnapshot = {
  /** conversationId → unread state for the actor */
  byId: Map<string, ConversationUnreadState>;
  totalUnreadCount: number;
  /** Wall-clock build time for TTL expiry. */
  builtAt: number;
  /**
   * Activity high-water for bounded delta refresh (conversation.updated_at).
   * Must NOT use wall-clock builtAt — fixture/prod clocks can diverge.
   */
  highWaterUpdatedAt: string;
  highWaterId: string;
};

type CacheKey = string;

function keyOf(companyId: string, userId: string): CacheKey {
  return `${companyId}|${userId}`;
}

const cache = new Map<CacheKey, UnreadIndexSnapshot>();

/** Test hook — clears all cached unread indexes. */
export function __resetUnreadIndexCacheForTests(): void {
  cache.clear();
}

export function getUnreadIndexCache(
  companyId: string,
  userId: string,
  nowMs: number = Date.now()
): UnreadIndexSnapshot | null {
  const hit = cache.get(keyOf(companyId, userId));
  if (!hit) return null;
  if (nowMs - hit.builtAt > UNREAD_INDEX_CACHE_TTL_MS) {
    cache.delete(keyOf(companyId, userId));
    return null;
  }
  return hit;
}

export function setUnreadIndexCache(
  companyId: string,
  userId: string,
  snapshot: Omit<UnreadIndexSnapshot, "builtAt"> & { builtAt?: number },
  nowMs: number = Date.now()
): UnreadIndexSnapshot {
  const full: UnreadIndexSnapshot = {
    byId: snapshot.byId,
    totalUnreadCount: snapshot.totalUnreadCount,
    highWaterUpdatedAt: snapshot.highWaterUpdatedAt,
    highWaterId: snapshot.highWaterId,
    builtAt: snapshot.builtAt ?? nowMs,
  };
  cache.set(keyOf(companyId, userId), full);
  return full;
}

/**
 * Merge freshly computed unread states into an existing actor index and
 * persist the write-back so the same IDs are not re-fetched on the next miss.
 */
export function writeBackUnreadIndexEntries(
  companyId: string,
  userId: string,
  entries: Map<string, ConversationUnreadState>,
  nowMs: number = Date.now()
): UnreadIndexSnapshot | null {
  const hit = getUnreadIndexCache(companyId, userId, nowMs);
  if (!hit) return null;
  let totalUnreadCount = hit.totalUnreadCount;
  for (const [id, state] of entries) {
    const prev = hit.byId.get(id);
    if (prev?.isUnread) totalUnreadCount -= 1;
    hit.byId.set(id, state);
    if (state.isUnread) totalUnreadCount += 1;
  }
  return setUnreadIndexCache(
    companyId,
    userId,
    {
      byId: hit.byId,
      totalUnreadCount,
      highWaterUpdatedAt: hit.highWaterUpdatedAt,
      highWaterId: hit.highWaterId,
      builtAt: hit.builtAt,
    },
    nowMs
  );
}

export function invalidateUnreadIndexCache(
  companyId: string,
  userId: string
): void {
  cache.delete(keyOf(companyId, userId));
}

/** Invalidate every cached index for a company (e.g. after inbound persist). */
export function invalidateUnreadIndexCacheForCompany(companyId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${companyId}|`)) cache.delete(k);
  }
}
