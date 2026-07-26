/**
 * Short-lived per-actor unread index cache (LIVE-01-R2).
 *
 * Exact Unread/Read listing without a migration cannot be a single SQL filter
 * on the existing schema. A process-local cache + invalidation bounds the
 * cost of ~2s live polling so production does not rescan
 * (all conversations × all inbound messages) on every tick.
 *
 * Query-cost contract (warm cache hit, no conversation changes):
 * - 1 bounded conversation delta page (usually empty)
 * - 0 message history transfers
 * - O(1) map lookups for page enrichment / filter membership
 *
 * Query-cost contract (warm hit with K touched conversations):
 * - ceil(K/100) conversation delta pages
 * - batchUnreadState only for those K ids (watermark-bounded message rows)
 *
 * Query-cost contract (cold build for N conversations):
 * - ceil(N/100) conversation list pages
 * - batchUnreadState in chunks of ≤100 ids
 * - Result reused until TTL expiry, watermark invalidation, or inbound invalidation
 */
import type { ConversationUnreadState } from "./whatsappInboxUnreadBatch.ts";

export const UNREAD_INDEX_CACHE_TTL_MS = 5_000;

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
