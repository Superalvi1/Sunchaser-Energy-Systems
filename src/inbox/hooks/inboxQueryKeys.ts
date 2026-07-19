import type { InboxListFilters } from "../types";

export const inboxKeys = {
  all: ["inbox"] as const,
  lists: () => [...inboxKeys.all, "list"] as const,
  list: (filters: InboxListFilters) =>
    [...inboxKeys.lists(), filters] as const,
  details: () => [...inboxKeys.all, "detail"] as const,
  detail: (id: string) => [...inboxKeys.details(), id] as const,
  messages: (id: string) => [...inboxKeys.all, "messages", id] as const,
};
