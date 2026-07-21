import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { fetchInboxConversations, fetchInboxDelta } from "../api/inboxApi";
import type { InboxConversation, InboxListFilters, InboxListPage } from "../types";
import { inboxKeys } from "./inboxQueryKeys";

const PAGE_SIZE = 40;
const DELTA_MS = 8_000;

function mergeByActivity(
  existing: InboxConversation[],
  incoming: InboxConversation[]
): InboxConversation[] {
  const map = new Map<string, InboxConversation>();
  for (const row of existing) map.set(row.id, row);
  for (const row of incoming) map.set(row.id, row);
  return [...map.values()].sort((a, b) => {
    const atA = a.lastMessageAt ?? a.updatedAt ?? a.createdAt;
    const atB = b.lastMessageAt ?? b.updatedAt ?? b.createdAt;
    if (atA !== atB) return atB < atA ? -1 : 1;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
}

function matchesSearch(row: InboxConversation, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return (
    row.id.toLowerCase().includes(q) ||
    row.contactId.toLowerCase().includes(q) ||
    row.channelId.toLowerCase().includes(q) ||
    (row.assignedUserId ?? "").toLowerCase().includes(q)
  );
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

  const conversations = useMemo(() => {
    const rows = query.data?.pages.flatMap((p) => p.conversations) ?? [];
    let next = rows;
    if (filters.unreadOnly) {
      // Client heuristic until unread counts are API-backed:
      // treat failed or recently updated open/pending as attention-needed.
      next = next.filter(
        (c) =>
          c.hasFailedMessage ||
          c.status === "open" ||
          c.status === "pending"
      );
    }
    if (filters.search) {
      next = next.filter((c) => matchesSearch(c, filters.search!));
    }
    return next;
  }, [query.data, filters.unreadOnly, filters.search]);

  const watermarkRef = useRef<{ at: string; id: string } | null>(null);

  useEffect(() => {
    const first = conversations[0];
    if (!first) return;
    const at = first.lastMessageAt ?? first.updatedAt ?? first.createdAt;
    if (
      !watermarkRef.current ||
      at > watermarkRef.current.at ||
      (at === watermarkRef.current.at && first.id > watermarkRef.current.id)
    ) {
      watermarkRef.current = { at, id: first.id };
    }
  }, [conversations]);

  useEffect(() => {
    if (!query.isSuccess) return;
    const timer = window.setInterval(async () => {
      const since = watermarkRef.current;
      if (!since) return;
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
            const top = merged[0];
            if (top) {
              watermarkRef.current = {
                at: top.lastMessageAt ?? top.updatedAt ?? top.createdAt,
                id: top.id,
              };
            }
            return {
              ...old,
              pages: [{ ...first, conversations: merged }, ...rest],
            };
          }
        );
      } catch {
        // Delta failures are soft — list query remains authoritative.
      }
    }, DELTA_MS);
    return () => window.clearInterval(timer);
  }, [query.isSuccess, queryClient, serverFilters]);

  return {
    ...query,
    conversations,
  };
}
