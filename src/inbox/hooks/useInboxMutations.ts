import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  assignInboxConversation,
  createInboxLead,
  markInboxRead,
  sendInboxMessage,
  unassignInboxConversation,
  updateInboxStatus,
} from "../api/inboxApi";
import type {
  InboxConversation,
  InboxConversationDetail,
  InboxListPage,
  InboxMessage,
  InboxMessagesPage,
  InboxConversationStatus,
} from "../types";
import { newIdempotencyKey } from "../utils/format";
import { applyFilteredMembershipUpdate } from "./inboxConversationCache";
import { inboxKeys } from "./inboxQueryKeys";
import type { InboxListFilters } from "../types";

function patchConversationInLists(
  queryClient: ReturnType<typeof useQueryClient>,
  conversation: InboxConversation
) {
  const lists = queryClient.getQueriesData<InfiniteData<InboxListPage>>({
    queryKey: inboxKeys.lists(),
  });
  for (const [key, data] of lists) {
    if (!data) continue;
    queryClient.setQueryData<InfiniteData<InboxListPage>>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        conversations: page.conversations.map((c) =>
          c.id === conversation.id ? conversation : c
        ),
      })),
    });
  }
}

export function useInboxMutations() {
  const queryClient = useQueryClient();

  const send = useMutation({
    mutationFn: (input: { conversationId: string; text: string }) =>
      sendInboxMessage({
        conversationId: input.conversationId,
        text: input.text,
        idempotencyKey: newIdempotencyKey(),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: inboxKeys.messages(input.conversationId),
      });
      const previous = queryClient.getQueryData<InfiniteData<InboxMessagesPage>>(
        inboxKeys.messages(input.conversationId)
      );
      const optimistic: InboxMessage = {
        id: `optimistic_${Date.now()}`,
        companyId: "sunchaser",
        conversationId: input.conversationId,
        direction: "outbound",
        status: "pending",
        textBody: input.text,
        createdAt: new Date().toISOString(),
        occurredAt: new Date().toISOString(),
      };
      queryClient.setQueryData<InfiniteData<InboxMessagesPage>>(
        inboxKeys.messages(input.conversationId),
        (old) => {
          if (!old) {
            return {
              pageParams: [null],
              pages: [{ messages: [optimistic], nextCursor: null }],
            };
          }
          const pages = [...old.pages];
          const first = pages[0] ?? { messages: [], nextCursor: null };
          pages[0] = {
            ...first,
            messages: [optimistic, ...first.messages],
          };
          return { ...old, pages };
        }
      );
      return { previous };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          inboxKeys.messages(input.conversationId),
          ctx.previous
        );
      }
    },
    onSettled: (_data, _err, input) => {
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.messages(input.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.detail(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: inboxKeys.lists() });
    },
  });

  const assign = useMutation({
    mutationFn: assignInboxConversation,
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: inboxKeys.detail(input.conversationId),
      });
      const previous = queryClient.getQueryData<InboxConversationDetail>(
        inboxKeys.detail(input.conversationId)
      );
      if (previous) {
        const next: InboxConversationDetail = {
          ...previous,
          conversation: {
            ...previous.conversation,
            assignedUserId: input.assigneeUserId,
            lockVersion: previous.conversation.lockVersion + 1,
          },
        };
        queryClient.setQueryData(inboxKeys.detail(input.conversationId), next);
        patchConversationInLists(queryClient, next.conversation);
      }
      return { previous };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          inboxKeys.detail(input.conversationId),
          ctx.previous
        );
        patchConversationInLists(queryClient, ctx.previous.conversation);
      }
    },
    onSuccess: (conversation) => {
      patchConversationInLists(queryClient, conversation);
      queryClient.setQueryData<InboxConversationDetail>(
        inboxKeys.detail(conversation.id),
        (old) => (old ? { ...old, conversation } : old)
      );
    },
    onSettled: (_d, _e, input) => {
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.detail(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: inboxKeys.lists() });
    },
  });

  const unassign = useMutation({
    mutationFn: unassignInboxConversation,
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: inboxKeys.detail(input.conversationId),
      });
      const previous = queryClient.getQueryData<InboxConversationDetail>(
        inboxKeys.detail(input.conversationId)
      );
      if (previous) {
        const next: InboxConversationDetail = {
          ...previous,
          conversation: {
            ...previous.conversation,
            assignedUserId: null,
            lockVersion: previous.conversation.lockVersion + 1,
          },
        };
        queryClient.setQueryData(inboxKeys.detail(input.conversationId), next);
        patchConversationInLists(queryClient, next.conversation);
      }
      return { previous };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          inboxKeys.detail(input.conversationId),
          ctx.previous
        );
        patchConversationInLists(queryClient, ctx.previous.conversation);
      }
    },
    onSuccess: (conversation) => {
      patchConversationInLists(queryClient, conversation);
      queryClient.setQueryData<InboxConversationDetail>(
        inboxKeys.detail(conversation.id),
        (old) => (old ? { ...old, conversation } : old)
      );
    },
    onSettled: (_d, _e, input) => {
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.detail(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: inboxKeys.lists() });
    },
  });

  const setStatus = useMutation({
    mutationFn: (input: {
      conversationId: string;
      status: InboxConversationStatus;
      expectedLockVersion: number;
    }) => updateInboxStatus(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: inboxKeys.detail(input.conversationId),
      });
      const previous = queryClient.getQueryData<InboxConversationDetail>(
        inboxKeys.detail(input.conversationId)
      );
      if (previous) {
        const next: InboxConversationDetail = {
          ...previous,
          conversation: {
            ...previous.conversation,
            status: input.status,
            lockVersion: previous.conversation.lockVersion + 1,
          },
        };
        queryClient.setQueryData(inboxKeys.detail(input.conversationId), next);
        patchConversationInLists(queryClient, next.conversation);
      }
      return { previous };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          inboxKeys.detail(input.conversationId),
          ctx.previous
        );
        patchConversationInLists(queryClient, ctx.previous.conversation);
      }
    },
    onSuccess: (conversation) => {
      patchConversationInLists(queryClient, conversation);
      queryClient.setQueryData<InboxConversationDetail>(
        inboxKeys.detail(conversation.id),
        (old) => (old ? { ...old, conversation } : old)
      );
    },
    onSettled: (_d, _e, input) => {
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.detail(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: inboxKeys.lists() });
    },
  });

  const markRead = useMutation({
    mutationFn: markInboxRead,
    onSuccess: (_data, input) => {
      // Server watermark advanced — clear unread badges and drop from Unread caches.
      const lists = queryClient.getQueriesData<InfiniteData<InboxListPage>>({
        queryKey: inboxKeys.lists(),
      });
      for (const [key, data] of lists) {
        if (!data) continue;
        const filters = (Array.isArray(key) ? key[key.length - 1] : null) as
          | InboxListFilters
          | null;
        const quick = filters?.quickFilter ?? (filters?.unreadOnly ? "unread" : "all");

        const patchedPages = data.pages.map((page) => ({
          ...page,
          conversations: page.conversations.map((c) =>
            c.id === input.conversationId
              ? { ...c, isUnread: false, unreadCount: 0 }
              : c
          ),
        }));
        const patched = { ...data, pages: patchedPages };
        const target = patched.pages
          .flatMap((p) => p.conversations)
          .find((c) => c.id === input.conversationId);

        if (quick === "unread") {
          queryClient.setQueryData(
            key,
            applyFilteredMembershipUpdate(patched, {
              upsert: [],
              removeIds: [input.conversationId],
              totalUnreadCount: Math.max(
                0,
                (patched.pages[0]?.totalUnreadCount ?? 1) - 1
              ),
            })
          );
        } else if (quick === "read" && target) {
          queryClient.setQueryData(
            key,
            applyFilteredMembershipUpdate(patched, {
              upsert: [target],
              removeIds: [],
              totalUnreadCount: Math.max(
                0,
                (patched.pages[0]?.totalUnreadCount ?? 1) - 1
              ),
            })
          );
        } else {
          queryClient.setQueryData<InfiniteData<InboxListPage>>(key, patched);
        }
      }
      queryClient.setQueryData<InboxConversationDetail>(
        inboxKeys.detail(input.conversationId),
        (old) =>
          old
            ? {
                ...old,
                conversation: {
                  ...old.conversation,
                  isUnread: false,
                  unreadCount: 0,
                },
              }
            : old
      );
    },
  });

  const createLead = useMutation({
    mutationFn: createInboxLead,
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.detail(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: inboxKeys.lists() });
    },
  });

  return { send, assign, unassign, setStatus, markRead, createLead };
}
