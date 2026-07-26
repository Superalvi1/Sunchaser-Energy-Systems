/**
 * Per-actor unread index cache (LIVE-01-R2/R3/R4/R5).
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
 * Race safety (R5 — warm dirty flush):
 * - Each company/conversation dirty state has a monotonic generation.
 * - Warm flush captures generations before batchUnreadState.
 * - Write-back clears/applies only when the generation is unchanged (CAS).
 * - Concurrent flushes are ordered by flushSeq; older results cannot overwrite
 *   newer stored per-conversation state.
 * - Company dirty generations are not cleared by the first actor’s flush;
 *   each actor tracks lastFlushedGen independently.
 * - Warm flush retries are bounded (MAX_DIRTY_FLUSH_ATTEMPTS).
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

/** Bounded warm-flush rounds when inbound keeps advancing dirty generations. */
export const MAX_DIRTY_FLUSH_ATTEMPTS = 3;

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
  /**
   * Pending dirty generations for this actor (conversationId → gen).
   * Kept for API compatibility as a Set view via {@link dirtyIds}.
   */
  dirtyGens: Map<string, number>;
  /** Last successfully applied dirty flush generation per conversation. */
  lastFlushedGen: Map<string, number>;
  /** Last flushSeq that successfully wrote each conversation’s unread state. */
  entryFlushSeq: Map<string, number>;
  /** Highest completed dirty-flush sequence for this actor snapshot. */
  lastCompletedFlushSeq: number;
  /**
   * Compatibility Set of dirty conversation ids (keys of dirtyGens plus any
   * company gens not yet flushed by this actor).
   */
  dirtyIds: Set<string>;
};

export type UnreadIndexBuildHandle = {
  companyId: string;
  userId: string;
  /** Publish sequence reserved for this build attempt. */
  publishSeq: number;
  cancelled: boolean;
};

/** Ticket capturing dirty generations before a warm recompute. */
export type DirtyFlushTicket = {
  companyId: string;
  userId: string;
  /** conversationId → generation captured at flush start */
  capturedGens: Map<string, number>;
  /** Monotonic flush sequence for this actor; newer wins on write-back. */
  flushSeq: number;
};

type CacheKey = string;

function keyOf(companyId: string, userId: string): CacheKey {
  return `${companyId}|${userId}`;
}

function companyConvKey(companyId: string, conversationId: string): string {
  return `${companyId}|${conversationId}`;
}

const cache = new Map<CacheKey, UnreadIndexSnapshot>();
const publishSeqByKey = new Map<CacheKey, number>();
const flushSeqByKey = new Map<CacheKey, number>();
const inflightBuilds = new Set<UnreadIndexBuildHandle>();
/**
 * Latest dirty generation per company/conversation. Monotonic; not cleared by
 * the first actor’s successful flush (actors use lastFlushedGen instead).
 */
const companyDirtyGens = new Map<string, number>();

function syncDirtyIdsView(snap: UnreadIndexSnapshot, companyId: string): void {
  const ids = new Set<string>(snap.dirtyGens.keys());
  for (const [key, gen] of companyDirtyGens) {
    if (!key.startsWith(`${companyId}|`)) continue;
    const conversationId = key.slice(companyId.length + 1);
    const flushed = snap.lastFlushedGen.get(conversationId) ?? 0;
    if (gen > flushed) ids.add(conversationId);
  }
  snap.dirtyIds = ids;
}

/** Test hook — clears all cached unread indexes and race state. */
export function __resetUnreadIndexCacheForTests(): void {
  cache.clear();
  publishSeqByKey.clear();
  flushSeqByKey.clear();
  inflightBuilds.clear();
  companyDirtyGens.clear();
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
  syncDirtyIdsView(hit, companyId);
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
    | "builtAt"
    | "publishSeq"
    | "dirtyIds"
    | "dirtyGens"
    | "lastFlushedGen"
    | "entryFlushSeq"
    | "lastCompletedFlushSeq"
  > & {
    builtAt?: number;
    dirtyIds?: Set<string>;
    dirtyGens?: Map<string, number>;
  },
  nowMs: number = Date.now()
): UnreadIndexSnapshot | null {
  if (handle.cancelled) return null;
  const key = keyOf(companyId, userId);
  const existing = cache.get(key);
  if (existing && existing.publishSeq > handle.publishSeq) {
    return null;
  }

  const dirtyGens = new Map<string, number>(snapshot.dirtyGens ?? []);
  if (snapshot.dirtyIds) {
    for (const id of snapshot.dirtyIds) {
      if (!dirtyGens.has(id)) {
        const companyGen =
          companyDirtyGens.get(companyConvKey(companyId, id)) ?? 1;
        dirtyGens.set(id, companyGen);
      }
    }
  }
  for (const [ck, gen] of companyDirtyGens) {
    if (!ck.startsWith(`${companyId}|`)) continue;
    const conversationId = ck.slice(companyId.length + 1);
    const prev = dirtyGens.get(conversationId) ?? 0;
    if (gen > prev) dirtyGens.set(conversationId, gen);
  }

  const full: UnreadIndexSnapshot = {
    byId: snapshot.byId,
    totalUnreadCount: snapshot.totalUnreadCount,
    highWaterUpdatedAt: snapshot.highWaterUpdatedAt,
    highWaterId: snapshot.highWaterId,
    builtAt: snapshot.builtAt ?? nowMs,
    publishSeq: handle.publishSeq,
    dirtyGens,
    lastFlushedGen: new Map(),
    entryFlushSeq: new Map(),
    lastCompletedFlushSeq: 0,
    dirtyIds: new Set(),
  };
  syncDirtyIdsView(full, companyId);

  // Re-check cancellation after assembling the entry.
  if (handle.cancelled) return null;
  if (existing && existing.publishSeq > handle.publishSeq) return null;

  cache.set(key, full);
  return full;
}

/**
 * Merge freshly computed unread states into an existing actor index.
 * Does NOT clear dirty generations — use {@link completeDirtyFlush} for that.
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
    // Do not clobber conversations with a pending dirty generation — warm flush
    // CAS (completeDirtyFlush) owns those writes.
    const pendingGen = hit.dirtyGens.get(id);
    const flushed = hit.lastFlushedGen.get(id) ?? 0;
    if (pendingGen !== undefined && pendingGen > flushed) {
      continue;
    }
    const prev = hit.byId.get(id);
    if (prev?.isUnread) totalUnreadCount -= 1;
    hit.byId.set(id, state);
    if (state.isUnread) totalUnreadCount += 1;
  }
  hit.totalUnreadCount = totalUnreadCount;
  syncDirtyIdsView(hit, companyId);
  cache.set(keyOf(companyId, userId), hit);
  return hit;
}

/**
 * Begin a warm dirty flush: capture generations and reserve a flush sequence.
 * Returns null when there is nothing dirty to flush.
 */
export function beginDirtyFlush(
  companyId: string,
  userId: string,
  nowMs: number = Date.now()
): DirtyFlushTicket | null {
  const hit = getUnreadIndexCache(companyId, userId, nowMs);
  if (!hit) return null;

  const capturedGens = new Map<string, number>();
  for (const [id, gen] of hit.dirtyGens) {
    capturedGens.set(id, gen);
  }
  for (const [ck, gen] of companyDirtyGens) {
    if (!ck.startsWith(`${companyId}|`)) continue;
    const conversationId = ck.slice(companyId.length + 1);
    const flushed = hit.lastFlushedGen.get(conversationId) ?? 0;
    if (gen > flushed) {
      const prev = capturedGens.get(conversationId) ?? 0;
      capturedGens.set(conversationId, Math.max(prev, gen));
      // Ensure actor pending reflects company gen for CAS on complete.
      const actorGen = hit.dirtyGens.get(conversationId) ?? 0;
      if (gen > actorGen) hit.dirtyGens.set(conversationId, gen);
    }
  }

  if (capturedGens.size === 0) return null;

  const key = keyOf(companyId, userId);
  const flushSeq = (flushSeqByKey.get(key) ?? 0) + 1;
  flushSeqByKey.set(key, flushSeq);
  syncDirtyIdsView(hit, companyId);

  return { companyId, userId, capturedGens, flushSeq };
}

export type DirtyFlushCompleteResult = {
  appliedIds: string[];
  /** Conversations whose generation advanced (or lost the flushSeq race). */
  retainedDirtyIds: string[];
  snapshot: UnreadIndexSnapshot | null;
};

/**
 * Apply warm-flush results with generation CAS + flushSeq ordering.
 * An older recomputation cannot clear a newer dirty generation or overwrite
 * a newer stored unread result.
 */
export function completeDirtyFlush(
  ticket: DirtyFlushTicket,
  entries: Map<string, ConversationUnreadState>,
  nowMs: number = Date.now()
): DirtyFlushCompleteResult {
  const hit = getUnreadIndexCache(
    ticket.companyId,
    ticket.userId,
    nowMs
  );
  if (!hit) {
    return {
      appliedIds: [],
      retainedDirtyIds: [...ticket.capturedGens.keys()],
      snapshot: null,
    };
  }

  const appliedIds: string[] = [];
  const retainedDirtyIds: string[] = [];
  let totalUnreadCount = hit.totalUnreadCount;

  for (const [id, capturedGen] of ticket.capturedGens) {
    const state = entries.get(id);
    const currentActorGen = hit.dirtyGens.get(id);
    const companyGen =
      companyDirtyGens.get(companyConvKey(ticket.companyId, id)) ?? 0;
    const currentGen = Math.max(currentActorGen ?? 0, companyGen);

    // Generation advanced during the query — retain for another recompute.
    if (currentGen !== capturedGen) {
      retainedDirtyIds.push(id);
      // Keep actor dirty at the latest known gen.
      if (currentGen > 0) hit.dirtyGens.set(id, currentGen);
      continue;
    }

    const lastEntrySeq = hit.entryFlushSeq.get(id) ?? 0;
    // Older concurrent flush must not overwrite a newer stored result.
    if (ticket.flushSeq < lastEntrySeq) {
      retainedDirtyIds.push(id);
      continue;
    }

    if (!state) {
      // Captured but missing from batch result — retain dirty.
      retainedDirtyIds.push(id);
      continue;
    }

    const prev = hit.byId.get(id);
    if (prev?.isUnread) totalUnreadCount -= 1;
    hit.byId.set(id, state);
    if (state.isUnread) totalUnreadCount += 1;

    hit.dirtyGens.delete(id);
    hit.lastFlushedGen.set(id, capturedGen);
    hit.entryFlushSeq.set(id, ticket.flushSeq);
    appliedIds.push(id);
  }

  hit.totalUnreadCount = totalUnreadCount;
  hit.lastCompletedFlushSeq = Math.max(
    hit.lastCompletedFlushSeq,
    ticket.flushSeq
  );
  // Company dirty generations intentionally retained — other actors still need
  // them via lastFlushedGen comparison. Do not clear companyDirtyGens here.
  syncDirtyIdsView(hit, ticket.companyId);
  cache.set(keyOf(ticket.companyId, ticket.userId), hit);
  return { appliedIds, retainedDirtyIds, snapshot: hit };
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

  const ck = companyConvKey(companyId, conversationId);
  const nextGen = (companyDirtyGens.get(ck) ?? 0) + 1;
  companyDirtyGens.set(ck, nextGen);

  for (const handle of inflightBuilds) {
    if (handle.companyId === companyId) {
      handle.cancelled = true;
    }
  }

  for (const [key, snap] of cache) {
    if (!key.startsWith(`${companyId}|`)) continue;
    snap.dirtyGens.set(conversationId, nextGen);
    // Remove stale membership so totalUnreadCount is recomputed on flush;
    // avoids serving a known-stale unread flag until the next batch.
    const prev = snap.byId.get(conversationId);
    if (prev) {
      snap.byId.delete(conversationId);
      if (prev.isUnread) {
        snap.totalUnreadCount = Math.max(0, snap.totalUnreadCount - 1);
      }
    }
    syncDirtyIdsView(snap, companyId);
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
  for (const ck of [...companyDirtyGens.keys()]) {
    if (ck.startsWith(`${companyId}|`)) companyDirtyGens.delete(ck);
  }
}

/**
 * Collect dirty conversation ids for an actor snapshot + company bag.
 * @deprecated Prefer {@link beginDirtyFlush} which also captures generations.
 */
export function takeDirtyConversationIds(
  companyId: string,
  snapshot: UnreadIndexSnapshot | null
): string[] {
  if (!snapshot) {
    const ids: string[] = [];
    for (const ck of companyDirtyGens.keys()) {
      if (ck.startsWith(`${companyId}|`)) {
        ids.push(ck.slice(companyId.length + 1));
      }
    }
    return ids;
  }
  syncDirtyIdsView(snapshot, companyId);
  return [...snapshot.dirtyIds];
}

/**
 * Test helper: seed a warm cache entry via the normal publish path.
 * Production code should use tryPublishUnreadIndex from a build handle.
 */
export function setUnreadIndexCache(
  companyId: string,
  userId: string,
  snapshot: Omit<
    UnreadIndexSnapshot,
    | "builtAt"
    | "publishSeq"
    | "dirtyIds"
    | "dirtyGens"
    | "lastFlushedGen"
    | "entryFlushSeq"
    | "lastCompletedFlushSeq"
  > & {
    builtAt?: number;
    dirtyIds?: Set<string>;
    dirtyGens?: Map<string, number>;
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
  if (!hit) return [];
  syncDirtyIdsView(hit, companyId);
  return [...hit.dirtyIds];
}

export function __getCompanyDirtyGenForTests(
  companyId: string,
  conversationId: string
): number {
  return companyDirtyGens.get(companyConvKey(companyId, conversationId)) ?? 0;
}

export function __getActorDirtyGenForTests(
  companyId: string,
  userId: string,
  conversationId: string
): number | undefined {
  return cache.get(keyOf(companyId, userId))?.dirtyGens.get(conversationId);
}

export function __getActorLastFlushedGenForTests(
  companyId: string,
  userId: string,
  conversationId: string
): number {
  return (
    cache.get(keyOf(companyId, userId))?.lastFlushedGen.get(conversationId) ??
    0
  );
}
