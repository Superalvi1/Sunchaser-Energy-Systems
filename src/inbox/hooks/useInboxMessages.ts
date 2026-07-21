import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchInboxMessages } from "../api/inboxApi";
import { inboxKeys } from "./inboxQueryKeys";

export function useInboxMessages(conversationId: string | null) {
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

  // API returns newest-first pages; timeline wants oldest → newest.
  const messages = useMemo(() => {
    const rows = query.data?.pages.flatMap((p) => p.messages) ?? [];
    return [...rows].reverse();
  }, [query.data]);

  return { ...query, messages };
}
