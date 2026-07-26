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
import {
  applyAllDeltaToConversationPages,
  applyFilteredMembershipUpdate,
  INBOX_CONVERSATION_PAGE_SIZE,
  resetToAuthoritativeFirstPage,
  type InfiniteConversationsData,
} from "./inboxConversationCache";

export {
  resetToAuthoritativeFirstPage,
  applyAllDeltaToConversationPages,
  applyFilteredMembershipUpdate,
  INBOX_CONVERSATION_PAGE_SIZE,
} from "./inboxConversationCache";

const PAGE_SIZE = INBOX_CONVERSATION_PAGE_SIZE;

/**
 * Filtered tabs: full authoritative first-page reset on this cadence.
 * Between resets, ~2s membership deltas keep the UI live without rescanning
 * the full unread index on every tick.
 */
export const FILTERED_AUTHORITATIVE_REFRESH_MS = 10_000;

function activityAt(row: InboxConversation): string {
  return row.lastMessageAt ?? row.updatedAt ?? row.createdAt;
}

function topWatermark(
  rows: InboxConversation[]
): { at: string; id: string } | null {
  const first = rows[0];
  if (!first) return null;
  return { at: activityAt(first), id: first.id };
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

function rowMatchesQuickFilter(
  row: InboxConversation,
  quick: InboxListFilters["quickFilter"]
): boolean {
  switch (quick) {
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

  const watermarkRef = useRef<{ at: string; id: string } | null>(null);
  const inFlightRef = useRef(false);
  const lastAuthoritativeAtRef = useRef(0);
  const filterKey = JSON.stringify(serverFilters);

  useEffect(() => {
    watermarkRef.current = topWatermark(rawConversations);
    lastAuthoritativeAtRef.current = 0;
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
    // R2: never keep incompatible older pages after an authoritative refresh.
    queryClient.setQueryData<InfiniteData<InboxListPage>>(
      inboxKeys.list(serverFilters),
      () => resetToAuthoritativeFirstPage(page)
    );
    const top = topWatermark(page.conversations);
    if (top) watermarkRef.current = top;
    lastAuthoritativeAtRef.current = Date.now();
  };

  const applyFilteredDeltaMembership = async () => {
    const since = watermarkRef.current;
    if (!since) {
      await applyAuthoritativeFirstPage();
      return;
    }
    // Unfiltered delta (same assignee/failure filters) + client membership check
    // so rows leaving Unread/Read are removed even when they no longer match.
    const baseFilters: InboxListFilters = {
      status: serverFilters.status,
      assignedTo: serverFilters.assignedTo,
      hasFailedMessage: serverFilters.hasFailedMessage,
      quickFilter: "all",
    };
    try {
      const page = await fetchInboxDelta(baseFilters, {
        sinceAt: since.at,
        sinceId: since.id,
      });
      const quick = serverFilters.quickFilter ?? "all";
      const upsert: InboxConversation[] = [];
      const removeIds: string[] = [];
      for (const row of page.conversations) {
        if (rowMatchesQuickFilter(row, quick)) upsert.push(row);
        else removeIds.push(row.id);
      }
      queryClient.setQueryData(
        inboxKeys.list(serverFilters),
        (old: InfiniteConversationsData | undefined) =>
          applyFilteredMembershipUpdate(old, {
            upsert,
            removeIds,
            pageSize: PAGE_SIZE,
            totalUnreadCount: page.totalUnreadCount,
          })
      );
      const top = topWatermark(
        (
          queryClient.getQueryData<InfiniteConversationsData>(
            inboxKeys.list(serverFilters)
          )?.pages[0]?.conversations ?? []
        )
      );
      if (top) watermarkRef.current = top;
    } catch {
      await applyAuthoritativeFirstPage();
    }
  };

  const refreshLive = async () => {
    if (!query.isSuccess) return;
    if (!isDocumentVisible()) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      if (usesServerExclusiveFilter(serverFilters)) {
        const dueAuthoritative =
          Date.now() - lastAuthoritativeAtRef.current >=
          FILTERED_AUTHORITATIVE_REFRESH_MS;
        if (dueAuthoritative || !watermarkRef.current) {
          await applyAuthoritativeFirstPage();
        } else {
          await applyFilteredDeltaMembership();
        }
        return;
      }

      const since = watermarkRef.current;
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
        queryClient.setQueryData(
          inboxKeys.list(serverFilters),
          (old: InfiniteConversationsData | undefined) => {
            const next = applyAllDeltaToConversationPages(
              page.conversations,
              old,
              {
                pageSize: PAGE_SIZE,
                totalUnreadCount: page.totalUnreadCount,
              }
            );
            const top = topWatermark(next.pages[0]?.conversations ?? []);
            if (top) watermarkRef.current = top;
            return next;
          }
        );
      } catch {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional interval rebind
  }, [query.isSuccess, queryClient, filterKey]);

  useEffect(() => {
    if (!query.isSuccess) return;
    return subscribeImmediateRefresh(() => {
      // Focus/visibility: force authoritative filtered reset.
      lastAuthoritativeAtRef.current = 0;
      void refreshLive();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isSuccess, queryClient, filterKey]);

  return {
    ...query,
    conversations,
    totalUnreadCount,
    liveRefreshMs: INBOX_LIVE_REFRESH_MS,
    filteredAuthoritativeRefreshMs: FILTERED_AUTHORITATIVE_REFRESH_MS,
  };
}
