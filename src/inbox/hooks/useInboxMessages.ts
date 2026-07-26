import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { fetchInboxMessages } from "../api/inboxApi";
import { inboxKeys } from "./inboxQueryKeys";
import {
  INBOX_LIVE_REFRESH_MS,
  isDocumentVisible,
  subscribeImmediateRefresh,
} from "./inboxLiveRefresh";
import {
  INBOX_MESSAGE_PAGE_SIZE,
  repartitionLiveMessagePages,
  type InfiniteMessagesData,
} from "./inboxMessageCache";

export { repartitionLiveMessagePages, INBOX_MESSAGE_PAGE_SIZE } from "./inboxMessageCache";

export function useInboxMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);

  const query = useInfiniteQuery({
    queryKey: inboxKeys.messages(conversationId ?? ""),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchInboxMessages(conversationId!, {
        before: pageParam,
        limit: INBOX_MESSAGE_PAGE_SIZE,
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
        limit: INBOX_MESSAGE_PAGE_SIZE,
      });
      queryClient.setQueryData(
        inboxKeys.messages(conversationId),
        (old: InfiniteMessagesData | undefined) =>
          repartitionLiveMessagePages(page, old, INBOX_MESSAGE_PAGE_SIZE)
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
