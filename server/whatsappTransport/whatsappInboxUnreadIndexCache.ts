/**
 * Per-actor unread index cache (LIVE-01-R2/R3/R4).
 *
 * Exact Unread/Read listing without a migration cannot be a single SQL filter
 * on the existing schema. A process-local cache + explicit invalidation bounds
 * live-poll cost so production does not rescan
 * (all conversations × all inbound messages) on every tick.
 *
 * TTL is a safety backstop only — correctness depends on invalidation/dirtying:
 * - inbound persisted (Meta / WhatsApp Web) → targeted conversation dirty
 *   across cached actor indexes + cancel in-flight cold builds
 * - watermark advanced → actor invalidate + cancel that actor's in-flight builds
 *
 * TTL (60s) is intentionally longer than filtered authoritative refresh (10s)
 * so an unchanged Inbox reuses the warm index across multiple authoritative
 * first-page resets without cold-rebuilding historical inbound pages.
 *
 * Race safety (R4):
 * - Cold builds register an in-flight handle; invalidation/dirty cancels it.
 * - Publish is generation/sequence gated so a cancelled or older build cannot
 *   store a stale 60s snapshot.
 * - Retries are bounded (see MAX_UNREAD_INDEX_BUILD_ATTEMPTS).
 *
 * Query-cost contract (warm cache hit, no conversation changes):
 * - 1 bounded conversation delta page (usually empty)
 * - 0 message history transfers
 *
 * Query-cost contract (warm hit after inbound dirty of K conversations):
 * - batchUnreadState only for those K dirty ids (paginated, exact)
 * - plus bounded conversation delta refresh
 * - NOT a full cold rebuild of all conversations
 *
 * Query-cost contract (cold build for N conversations):
 * - ceil(N/100) conversation list pages
 * - batchUnreadState in chunks of ≤100 ids (each chunk paginated at 500 rows)
 *
 * Query-cost contract (actor mark-read invalidate):
 * - deletes that actor's cache only; next request cold-builds for that actor
 */
import type { ConversationUnreadState } from "./whatsappInboxUnreadBatch.ts";

/** Safety-backstop TTL; invalidation/dirty is the primary correctness mechanism. */
export const UNREAD_INDEX_CACHE_TTL_MS = 60_000;

/** Bounded retries when invalidation races an in-flight cold build. */
export const MAX_UNREAD_INDEX_BUILD_ATTEMPTS = 3;

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
  /** Monotonic publish sequence for this actor key; newer wins. */
  publishSeq: number;
  /** Conversation ids awaiting targeted recompute (inbound dirty). */
  dirtyIds: Set<string>;
};

export type UnreadIndexBuildHandle = {
  companyId: string;
  userId: string;
  /** Publish sequence reserved for this build attempt. */
  publishSeq: number;
  cancelled: boolean;
};

type CacheKey = string;

function keyOf(companyId: string, userId: string): CacheKey {
  return `${companyId}|${userId}`;
}

const cache = new Map<CacheKey, UnreadIndexSnapshot>();
const publishSeqByKey = new Map<CacheKey, number>();
const inflightBuilds = new Set<UnreadIndexBuildHandle>();
/** Company-level dirty ids retained when no actor cache exists yet. */
const companyDirtyIds = new Map<string, Set<string>>();

/** Test hook — clears all cached unread indexes and race state. */
export function __resetUnreadIndexCacheForTests(): void {
  cache.clear();
  publishSeqByKey.clear();
  inflightBuilds.clear();
  companyDirtyIds.clear();
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

export function beginUnreadIndexBuild(
  companyId: string,
  userId: string
): UnreadIndexBuildHandle {
  const key = keyOf(companyId, userId);
  const publishSeq = (publishSeqByKey.get(key) ?? 0) + 1;
  publishSeqByKey.set(key, publishSeq);
  const handle: UnreadIndexBuildHandle = {
    companyId,
    userId,
    publishSeq,
    cancelled: false,
  };
  inflightBuilds.add(handle);
  return handle;
}

export function endUnreadIndexBuild(handle: UnreadIndexBuildHandle): void {
  inflightBuilds.delete(handle);
}

/**
 * Publish a cold-build snapshot only if the build was not cancelled and no
 * newer publish sequence already won for this actor.
 */
export function tryPublishUnreadIndex(
  companyId: string,
  userId: string,
  handle: UnreadIndexBuildHandle,
  snapshot: Omit<
    UnreadIndexSnapshot,
    "builtAt" | "publishSeq" | "dirtyIds"
  > & {
    builtAt?: number;
    dirtyIds?: Set<string>;
  },
  nowMs: number = Date.now()
): UnreadIndexSnapshot | null {
  if (handle.cancelled) return null;
  const key = keyOf(companyId, userId);
  const existing = cache.get(key);
  if (existing && existing.publishSeq > handle.publishSeq) {
    return null;
  }

  const companyDirty = companyDirtyIds.get(companyId) ?? new Set<string>();
  const dirtyIds = new Set<string>([
    ...(snapshot.dirtyIds ?? []),
    ...companyDirty,
  ]);

  const full: UnreadIndexSnapshot = {
    byId: snapshot.byId,
    totalUnreadCount: snapshot.totalUnreadCount,
    highWaterUpdatedAt: snapshot.highWaterUpdatedAt,
    highWaterId: snapshot.highWaterId,
    builtAt: snapshot.builtAt ?? nowMs,
    publishSeq: handle.publishSeq,
    dirtyIds,
  };
  // Re-check cancellation after assembling the entry.
  if (handle.cancelled) return null;
  if (existing && existing.publishSeq > handle.publishSeq) return null;

  cache.set(key, full);
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
    hit.dirtyIds.delete(id);
  }
  const companyDirty = companyDirtyIds.get(companyId);
  if (companyDirty) {
    for (const id of entries.keys()) companyDirty.delete(id);
  }
  hit.totalUnreadCount = totalUnreadCount;
  cache.set(keyOf(companyId, userId), hit);
  return hit;
}

/** Actor mark-read / watermark advance: drop that actor's cache only. */
export function invalidateUnreadIndexCache(
  companyId: string,
  userId: string
): void {
  const key = keyOf(companyId, userId);
  cache.delete(key);
  for (const handle of inflightBuilds) {
    if (handle.companyId === companyId && handle.userId === userId) {
      handle.cancelled = true;
    }
  }
}

/**
 * Inbound persistence path: cancel in-flight company builds and dirty the
 * affected conversation across all cached actor indexes (warm K-touched),
 * rather than deleting every actor snapshot.
 */
export function dirtyUnreadIndexForConversation(
  companyId: string,
  conversationId: string
): void {
  if (!conversationId) return;

  let companyDirty = companyDirtyIds.get(companyId);
  if (!companyDirty) {
    companyDirty = new Set();
    companyDirtyIds.set(companyId, companyDirty);
  }
  companyDirty.add(conversationId);

  for (const handle of inflightBuilds) {
    if (handle.companyId === companyId) {
      handle.cancelled = true;
    }
  }

  for (const [key, snap] of cache) {
    if (!key.startsWith(`${companyId}|`)) continue;
    snap.dirtyIds.add(conversationId);
    // Remove stale membership so totalUnreadCount is recomputed on flush;
    // avoids serving a known-stale unread flag until the next batch.
    const prev = snap.byId.get(conversationId);
    if (prev) {
      snap.byId.delete(conversationId);
      if (prev.isUnread) {
        snap.totalUnreadCount = Math.max(0, snap.totalUnreadCount - 1);
      }
    }
  }
}

/**
 * @deprecated Prefer {@link dirtyUnreadIndexForConversation} for inbound.
 * Nuclear company wipe — cancels in-flight builds and drops all actor caches.
 * Kept for tests/emergency; documents cold-rebuild cost.
 */
export function invalidateUnreadIndexCacheForCompany(companyId: string): void {
  for (const handle of inflightBuilds) {
    if (handle.companyId === companyId) handle.cancelled = true;
  }
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${companyId}|`)) cache.delete(k);
  }
  companyDirtyIds.delete(companyId);
}

/** Collect dirty conversation ids for an actor snapshot + company bag. */
export function takeDirtyConversationIds(
  companyId: string,
  snapshot: UnreadIndexSnapshot | null
): string[] {
  const ids = new Set<string>();
  if (snapshot) {
    for (const id of snapshot.dirtyIds) ids.add(id);
  }
  const companyDirty = companyDirtyIds.get(companyId);
  if (companyDirty) {
    for (const id of companyDirty) ids.add(id);
  }
  return [...ids];
}

/**
 * Test helper: seed a warm cache entry via the normal publish path.
 * Production code should use tryPublishUnreadIndex from a build handle.
 */
export function setUnreadIndexCache(
  companyId: string,
  userId: string,
  snapshot: Omit<UnreadIndexSnapshot, "builtAt" | "publishSeq" | "dirtyIds"> & {
    builtAt?: number;
    dirtyIds?: Set<string>;
  },
  nowMs: number = Date.now()
): UnreadIndexSnapshot {
  const handle = beginUnreadIndexBuild(companyId, userId);
  try {
    const published = tryPublishUnreadIndex(
      companyId,
      userId,
      handle,
      snapshot,
      nowMs
    );
    if (!published) {
      throw new Error("setUnreadIndexCache publish was cancelled");
    }
    return published;
  } finally {
    endUnreadIndexBuild(handle);
  }
}

/** Test/introspection helpers */
export function __getInflightUnreadBuildCountForTests(): number {
  return inflightBuilds.size;
}

export function __peekUnreadIndexPublishSeqForTests(
  companyId: string,
  userId: string
): number {
  return publishSeqByKey.get(keyOf(companyId, userId)) ?? 0;
}

export function __getUnreadIndexDirtyIdsForTests(
  companyId: string,
  userId: string
): string[] {
  const hit = cache.get(keyOf(companyId, userId));
  return hit ? [...hit.dirtyIds] : [];
}
