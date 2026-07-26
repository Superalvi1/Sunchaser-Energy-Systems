import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { fetchInboxConversations, fetchInboxDelta } from "../api/inboxApi";
import type {
  InboxConversation,
  InboxListFilters,
  InboxListPage,
} from "../types";
import { inboxKeys } from "./inboxQueryKeys";
import {
  INBOX_LIVE_REFRESH_MS,
  isDocumentVisible,
  subscribeImmediateRefresh,
} from "./inboxLiveRefresh";

const PAGE_SIZE = 40;

function activityAt(row: InboxConversation): string {
  return row.lastMessageAt ?? row.updatedAt ?? row.createdAt;
}

function mergeByActivity(
  existing: InboxConversation[],
  incoming: InboxConversation[]
): InboxConversation[] {
  const map = new Map<string, InboxConversation>();
  for (const row of existing) map.set(row.id, row);
  for (const row of incoming) map.set(row.id, row);
  return [...map.values()].sort((a, b) => {
    const atA = activityAt(a);
    const atB = activityAt(b);
    if (atA !== atB) return atB < atA ? -1 : 1;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
}

function matchesSearch(row: InboxConversation, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  const phoneDigits = String(row.phoneE164 || "").replace(/\D/g, "");
  const qDigits = q.replace(/\D/g, "");
  return (
    String(row.profileName || "")
      .toLowerCase()
      .includes(q) ||
    (qDigits.length >= 3 && phoneDigits.includes(qDigits)) ||
    row.id.toLowerCase().includes(q) ||
    row.contactId.toLowerCase().includes(q) ||
    row.channelId.toLowerCase().includes(q) ||
    (row.assignedUserId ?? "").toLowerCase().includes(q)
  );
}

function topWatermark(
  rows: InboxConversation[]
): { at: string; id: string } | null {
  const first = rows[0];
  if (!first) return null;
  return { at: activityAt(first), id: first.id };
}

function normalizeServerFilters(filters: InboxListFilters): InboxListFilters {
  return {
    status: filters.status,
    assignedTo: filters.assignedTo,
    hasFailedMessage: filters.hasFailedMessage,
    quickFilter:
      filters.quickFilter ??
      (filters.unreadOnly ? ("unread" as const) : ("all" as const)),
  };
}

function usesServerExclusiveFilter(filters: InboxListFilters): boolean {
  const quick = filters.quickFilter ?? (filters.unreadOnly ? "unread" : "all");
  return quick !== "all";
}

export function useInboxConversations(filters: InboxListFilters) {
  const queryClient = useQueryClient();
  const serverFilters = useMemo(
    () => normalizeServerFilters(filters),
    [
      filters.status,
      filters.assignedTo,
      filters.hasFailedMessage,
      filters.quickFilter,
      filters.unreadOnly,
    ]
  );

  const query = useInfiniteQuery({
    queryKey: inboxKeys.list(serverFilters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchInboxConversations(serverFilters, {
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

  const rawConversations = useMemo(
    () => query.data?.pages.flatMap((p) => p.conversations) ?? [],
    [query.data]
  );

  const conversations = useMemo(() => {
    if (!filters.search) return rawConversations;
    return rawConversations.filter((c) => matchesSearch(c, filters.search!));
  }, [rawConversations, filters.search]);

  const totalUnreadCount = useMemo(() => {
    const fromMeta = query.data?.pages[0]?.totalUnreadCount;
    if (typeof fromMeta === "number") return fromMeta;
    return rawConversations.reduce(
      (sum, row) => sum + (row.isUnread ? 1 : 0),
      0
    );
  }, [query.data, rawConversations]);

  // Per-filter watermark — switching tabs resets via effect below.
  const watermarkRef = useRef<{ at: string; id: string } | null>(null);
  const inFlightRef = useRef(false);
  const filterKey = JSON.stringify(serverFilters);

  useEffect(() => {
    // Switching quick filters must not reuse an incompatible cursor/cache watermark.
    watermarkRef.current = topWatermark(rawConversations);
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on filter identity

  useEffect(() => {
    const top = topWatermark(rawConversations);
    if (!top) return;
    if (
      !watermarkRef.current ||
      top.at > watermarkRef.current.at ||
      (top.at === watermarkRef.current.at && top.id > watermarkRef.current.id)
    ) {
      watermarkRef.current = top;
    }
  }, [rawConversations]);

  const applyAuthoritativeFirstPage = async () => {
    const page = await fetchInboxConversations(serverFilters, {
      cursor: null,
      limit: PAGE_SIZE,
    });
    queryClient.setQueryData<InfiniteData<InboxListPage>>(
      inboxKeys.list(serverFilters),
      (old) => {
        const rest = old?.pages.slice(1) ?? [];
        const nextFirst: InboxListPage = {
          conversations: page.conversations,
          nextCursor: page.nextCursor,
          totalUnreadCount: page.totalUnreadCount,
        };
        // Preserve older pages when present; first page is authoritative.
        return {
          pageParams: old?.pageParams ?? [null],
          pages: [nextFirst, ...rest],
        };
      }
    );
    const top = topWatermark(page.conversations);
    if (top) watermarkRef.current = top;
  };

  const refreshLive = async () => {
    if (!query.isSuccess) return;
    if (!isDocumentVisible()) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // Filtered tabs: authoritative first-page refresh so membership stays correct
      // across the full Inbox (not just the previously loaded page).
      if (usesServerExclusiveFilter(serverFilters)) {
        await applyAuthoritativeFirstPage();
        return;
      }

      const since = watermarkRef.current;
      // Empty Inbox / missing watermark: keep checking via authoritative list.
      if (!since) {
        await applyAuthoritativeFirstPage();
        return;
      }
      try {
        const page = await fetchInboxDelta(serverFilters, {
          sinceAt: since.at,
          sinceId: since.id,
        });
        if (
          page.conversations.length === 0 &&
          typeof page.totalUnreadCount !== "number"
        ) {
          return;
        }
        queryClient.setQueryData<InfiniteData<InboxListPage>>(
          inboxKeys.list(serverFilters),
          (old) => {
            if (!old) return old;
            const [first, ...rest] = old.pages;
            if (!first) return old;
            const merged = mergeByActivity(
              first.conversations,
              page.conversations
            );
            const top = topWatermark(merged);
            if (top) watermarkRef.current = top;
            return {
              ...old,
              pages: [
                {
                  ...first,
                  conversations: merged,
                  totalUnreadCount:
                    page.totalUnreadCount ?? first.totalUnreadCount,
                },
                ...rest,
              ],
            };
          }
        );
      } catch {
        // Delta failure → safe authoritative first-page refresh.
        await applyAuthoritativeFirstPage();
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!query.isSuccess) return;
    const timer = window.setInterval(() => {
      void refreshLive();
    }, INBOX_LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
    // refreshLive closes over latest refs/filters; rebind when list identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional interval rebind
  }, [query.isSuccess, queryClient, filterKey]);

  useEffect(() => {
    if (!query.isSuccess) return;
    return subscribeImmediateRefresh(() => {
      void refreshLive();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isSuccess, queryClient, filterKey]);

  return {
    ...query,
    conversations,
    totalUnreadCount,
    /** Test/helper: expose configured live interval. */
    liveRefreshMs: INBOX_LIVE_REFRESH_MS,
  };
}
