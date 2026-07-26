/**
 * Cursor-safe conversation infinite-query cache helpers (LIVE-01-R2).
 *
 * Filtered authoritative refresh must NOT keep incompatible older pages.
 * All-filter delta merge must keep page 1 bounded and duplicate-free.
 */
import type { InboxConversation, InboxListPage } from "../types";

export const INBOX_CONVERSATION_PAGE_SIZE = 40;

export type InfiniteConversationsData = {
  pages: InboxListPage[];
  pageParams: unknown[];
};

function activityAt(row: InboxConversation): string {
  return row.lastMessageAt ?? row.updatedAt ?? row.createdAt;
}

function sortByActivityDesc(rows: InboxConversation[]): InboxConversation[] {
  return [...rows].sort((a, b) => {
    const atA = activityAt(a);
    const atB = activityAt(b);
    if (atA !== atB) return atB < atA ? -1 : 1;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
}

function dedupeById(rows: InboxConversation[]): InboxConversation[] {
  const map = new Map<string, InboxConversation>();
  for (const row of rows) map.set(row.id, row);
  return [...map.values()];
}

function encodeActivityCursor(row: InboxConversation): string {
  const json = JSON.stringify({ at: activityAt(row), id: row.id });
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64url");
  }
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Replace the infinite-query cache with a single authoritative first page.
 * Older pages / pageParams are discarded so stale filter members cannot linger.
 */
export function resetToAuthoritativeFirstPage(
  page: InboxListPage
): InfiniteConversationsData {
  return {
    pages: [
      {
        conversations: page.conversations,
        nextCursor: page.nextCursor,
        totalUnreadCount: page.totalUnreadCount,
      },
    ],
    pageParams: [null],
  };
}

/**
 * Merge All-filter delta rows into cached pages:
 * - page 1 stays bounded to pageSize
 * - displaced rows spill into older pages (not lost)
 * - IDs are unique across all pages
 * - terminal nextCursor from the previous oldest page is preserved when possible
 */
export function applyAllDeltaToConversationPages(
  incoming: InboxConversation[],
  previous: InfiniteConversationsData | undefined,
  opts?: {
    pageSize?: number;
    totalUnreadCount?: number;
  }
): InfiniteConversationsData {
  const pageSize = opts?.pageSize ?? INBOX_CONVERSATION_PAGE_SIZE;
  const priorPages = previous?.pages ?? [];
  const priorRows = priorPages.flatMap((p) => p.conversations);
  const terminalCursor =
    priorPages.length > 0
      ? (priorPages[priorPages.length - 1]?.nextCursor ?? null)
      : null;

  const merged = sortByActivityDesc(
    dedupeById([...incoming, ...priorRows])
  );

  // Remove rows that moved into the newest page from older material.
  const first = merged.slice(0, pageSize);
  const older = merged.slice(pageSize);
  const firstIds = new Set(first.map((r) => r.id));
  const olderUnique = older.filter((r) => !firstIds.has(r.id));

  const firstPage: InboxListPage = {
    conversations: first,
    nextCursor:
      olderUnique.length > 0
        ? encodeActivityCursor(first[first.length - 1]!)
        : terminalCursor,
    totalUnreadCount:
      opts?.totalUnreadCount ?? priorPages[0]?.totalUnreadCount,
  };

  const olderPages: InboxListPage[] = [];
  for (let i = 0; i < olderUnique.length; i += pageSize) {
    const chunk = olderUnique.slice(i, i + pageSize);
    const isLast = i + pageSize >= olderUnique.length;
    olderPages.push({
      conversations: chunk,
      nextCursor: isLast
        ? terminalCursor
        : encodeActivityCursor(chunk[chunk.length - 1]!),
      totalUnreadCount: firstPage.totalUnreadCount,
    });
  }

  const pages = [firstPage, ...olderPages];
  const pageParams: unknown[] = pages.map((_, index) => {
    if (index === 0) return null;
    const prev = pages[index - 1]!;
    const oldest = prev.conversations[prev.conversations.length - 1];
    return oldest ? encodeActivityCursor(oldest) : null;
  });

  return { pages, pageParams };
}

/**
 * Apply membership-aware updates for a filtered tab (Unread/Read/Open/…).
 * Matching rows upsert; non-matching ids are removed from every page.
 * Then re-slice from a single sorted list so page 1 stays bounded and
 * pageParams/nextCursor stay consistent. Terminal server cursor is kept
 * only when the filtered set still extends beyond the cached rows.
 */
export function applyFilteredMembershipUpdate(
  previous: InfiniteConversationsData | undefined,
  opts: {
    upsert: InboxConversation[];
    removeIds: string[];
    pageSize?: number;
    totalUnreadCount?: number;
    /** Server nextCursor from a recent authoritative first page, if known. */
    serverNextCursor?: string | null;
  }
): InfiniteConversationsData {
  const pageSize = opts.pageSize ?? INBOX_CONVERSATION_PAGE_SIZE;
  const remove = new Set(opts.removeIds);
  const prior = (previous?.pages ?? []).flatMap((p) => p.conversations);
  const byId = new Map<string, InboxConversation>();
  for (const row of prior) {
    if (!remove.has(row.id)) byId.set(row.id, row);
  }
  for (const row of opts.upsert) {
    if (remove.has(row.id)) continue;
    byId.set(row.id, row);
  }

  const sorted = sortByActivityDesc([...byId.values()]);
  const priorTerminal =
    previous?.pages?.[previous.pages.length - 1]?.nextCursor ?? null;
  const hadMoreBefore =
    (previous?.pages?.length ?? 0) > 1 || Boolean(priorTerminal);

  if (sorted.length === 0) {
    return {
      pages: [
        {
          conversations: [],
          nextCursor: null,
          totalUnreadCount: opts.totalUnreadCount ?? 0,
        },
      ],
      pageParams: [null],
    };
  }

  const pages: InboxListPage[] = [];
  for (let i = 0; i < sorted.length; i += pageSize) {
    const chunk = sorted.slice(i, i + pageSize);
    const isLast = i + pageSize >= sorted.length;
    pages.push({
      conversations: chunk,
      nextCursor: isLast
        ? hadMoreBefore
          ? (opts.serverNextCursor ?? priorTerminal)
          : null
        : encodeActivityCursor(chunk[chunk.length - 1]!),
      totalUnreadCount: opts.totalUnreadCount,
    });
  }

  const pageParams: unknown[] = pages.map((_, index) => {
    if (index === 0) return null;
    const prev = pages[index - 1]!;
    const oldest = prev.conversations[prev.conversations.length - 1];
    return oldest ? encodeActivityCursor(oldest) : null;
  });

  return { pages, pageParams };
}

export function flattenConversationIds(
  data: InfiniteConversationsData | undefined
): string[] {
  return (data?.pages ?? []).flatMap((p) => p.conversations.map((c) => c.id));
}

export function conversationIdSet(
  data: InfiniteConversationsData | undefined
): Set<string> {
  return new Set(flattenConversationIds(data));
}
