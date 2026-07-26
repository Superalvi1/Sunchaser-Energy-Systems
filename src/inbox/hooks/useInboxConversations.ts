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

function matchesQuickFilter(
  row: InboxConversation,
  filter: InboxListFilters["quickFilter"]
): boolean {
  switch (filter) {
    case "unread":
      return row.isUnread === true || (row.unreadCount ?? 0) > 0;
    case "read":
      return row.isUnread !== true && (row.unreadCount ?? 0) === 0;
    case "open":
      return row.status === "open" || row.status === "pending";
    case "resolved":
      return row.status === "resolved";
    case "archived":
      return row.status === "archived";
    case "all":
    case undefined:
    default:
      return true;
  }
}

function topWatermark(
  rows: InboxConversation[]
): { at: string; id: string } | null {
  const first = rows[0];
  if (!first) return null;
  return { at: activityAt(first), id: first.id };
}

export function useInboxConversations(filters: InboxListFilters) {
  const queryClient = useQueryClient();
  const serverFilters = useMemo(
    () => ({
      status: filters.status,
      assignedTo: filters.assignedTo,
      hasFailedMessage: filters.hasFailedMessage,
    }),
    [filters.status, filters.assignedTo, filters.hasFailedMessage]
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
    let next = rawConversations;
    // Prefer API-backed quick filters; keep unreadOnly as alias for unread.
    const quick =
      filters.quickFilter ??
      (filters.unreadOnly ? ("unread" as const) : ("all" as const));
    if (quick !== "all") {
      next = next.filter((c) => matchesQuickFilter(c, quick));
    }
    if (filters.search) {
      next = next.filter((c) => matchesSearch(c, filters.search!));
    }
    return next;
  }, [
    rawConversations,
    filters.quickFilter,
    filters.unreadOnly,
    filters.search,
  ]);

  const totalUnreadCount = useMemo(
    () =>
      rawConversations.reduce(
        (sum, row) => sum + Math.max(0, row.unreadCount ?? (row.isUnread ? 1 : 0)),
        0
      ),
    [rawConversations]
  );

  // Watermark from unfiltered first page so empty-client-filter states still advance.
  const watermarkRef = useRef<{ at: string; id: string } | null>(null);
  const inFlightRef = useRef(false);

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
        if (page.conversations.length === 0) return;
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
              pages: [{ ...first, conversations: merged }, ...rest],
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
  }, [query.isSuccess, queryClient, serverFilters]);

  useEffect(() => {
    if (!query.isSuccess) return;
    return subscribeImmediateRefresh(() => {
      void refreshLive();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isSuccess, queryClient, serverFilters]);

  return {
    ...query,
    conversations,
    totalUnreadCount,
    /** Test/helper: expose configured live interval. */
    liveRefreshMs: INBOX_LIVE_REFRESH_MS,
  };
}
