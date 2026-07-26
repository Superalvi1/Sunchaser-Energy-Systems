import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { fetchInboxMessages } from "../api/inboxApi";
import type { InboxMessagesPage } from "../types";
import { inboxKeys } from "./inboxQueryKeys";
import {
  INBOX_LIVE_REFRESH_MS,
  isDocumentVisible,
  subscribeImmediateRefresh,
} from "./inboxLiveRefresh";

/**
 * Merge newest-first API pages without duplicating message ids.
 * Live refresh replaces the first (newest) page; older pages are preserved.
 */
function mergeNewestFirst(
  existing: InboxMessagesPage["messages"],
  incoming: InboxMessagesPage["messages"]
): InboxMessagesPage["messages"] {
  const map = new Map<string, (typeof existing)[number]>();
  // Incoming first so newer fields win, then keep prior order for the rest.
  for (const row of incoming) map.set(row.id, row);
  for (const row of existing) {
    if (!map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt < a.createdAt ? -1 : 1;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
}

export function useInboxMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);

  const query = useInfiniteQuery({
    queryKey: inboxKeys.messages(conversationId ?? ""),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchInboxMessages(conversationId!, {
        before: pageParam,
        limit: 50,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(conversationId),
  });

  const refreshLatest = async () => {
    if (!conversationId) return;
    if (!query.isSuccess) return;
    if (!isDocumentVisible()) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const page = await fetchInboxMessages(conversationId, {
        before: null,
        limit: 50,
      });
      queryClient.setQueryData(
        inboxKeys.messages(conversationId),
        (old: { pages: InboxMessagesPage[]; pageParams: unknown[] } | undefined) => {
          if (!old) {
            return {
              pages: [page],
              pageParams: [null],
            };
          }
          const [first, ...rest] = old.pages;
          const mergedFirst: InboxMessagesPage = {
            messages: mergeNewestFirst(first?.messages ?? [], page.messages),
            // Keep existing older-page cursor; first-page live refresh uses null before.
            nextCursor: first?.nextCursor ?? page.nextCursor,
          };
          return {
            ...old,
            pages: [mergedFirst, ...rest],
          };
        }
      );
    } catch {
      // Soft failure — timeline remains; next tick retries.
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!conversationId || !query.isSuccess) return;
    const timer = window.setInterval(() => {
      void refreshLatest();
    }, INBOX_LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, query.isSuccess, queryClient]);

  useEffect(() => {
    if (!conversationId || !query.isSuccess) return;
    return subscribeImmediateRefresh(() => {
      void refreshLatest();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, query.isSuccess, queryClient]);

  // API returns newest-first pages; timeline wants oldest → newest.
  const messages = useMemo(() => {
    const rows = query.data?.pages.flatMap((p) => p.messages) ?? [];
    // Deduplicate across pages (live merge + older pages).
    const seen = new Set<string>();
    const unique = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      unique.push(row);
    }
    return unique.reverse();
  }, [query.data]);

  return {
    ...query,
    messages,
    liveRefreshMs: INBOX_LIVE_REFRESH_MS,
  };
}
