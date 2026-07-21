import { useQuery } from "@tanstack/react-query";
import { fetchInboxConversation } from "../api/inboxApi";
import { inboxKeys } from "./inboxQueryKeys";

export function useInboxConversation(conversationId: string | null) {
  return useQuery({
    queryKey: inboxKeys.detail(conversationId ?? ""),
    queryFn: () => fetchInboxConversation(conversationId!),
    enabled: Boolean(conversationId),
  });
}
