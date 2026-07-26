import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchInboxConversation } from "../api/inboxApi";
import { inboxKeys } from "./inboxQueryKeys";
import {
  INBOX_LIVE_REFRESH_MS,
  isDocumentVisible,
  subscribeImmediateRefresh,
} from "./inboxLiveRefresh";

export function useInboxConversation(conversationId: string | null) {
  const query = useQuery({
    queryKey: inboxKeys.detail(conversationId ?? ""),
    queryFn: () => fetchInboxConversation(conversationId!),
    enabled: Boolean(conversationId),
    refetchInterval: (q) => {
      if (!conversationId) return false;
      if (!isDocumentVisible()) return false;
      if (q.state.status === "error") return false;
      return INBOX_LIVE_REFRESH_MS;
    },
  });

  useEffect(() => {
    if (!conversationId) return;
    return subscribeImmediateRefresh(() => {
      if (!isDocumentVisible()) return;
      void query.refetch();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return query;
}
