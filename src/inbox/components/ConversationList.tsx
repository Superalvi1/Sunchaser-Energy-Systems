import { useEffect, useRef } from "react";
import type { InboxConversation, InboxListFilters } from "../types";
import ConversationItem from "./ConversationItem";
import Filters from "./Filters";
import InboxEmptyState from "./InboxEmptyState";
import InboxErrorState from "./InboxErrorState";
import { ConversationListSkeleton } from "./InboxSkeleton";

type ConversationListProps = {
  filters: InboxListFilters;
  onFiltersChange: (next: InboxListFilters) => void;
  currentUserId: string;
  conversations: InboxConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  totalUnreadCount?: number;
};

export default function ConversationList({
  filters,
  onFiltersChange,
  currentUserId,
  conversations,
  selectedId,
  onSelect,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  totalUnreadCount = 0,
}: ConversationListProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || !fetchNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "120px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r border-[var(--inbox-border)] bg-[var(--inbox-surface)]"
      aria-label="Conversation list"
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <h2 className="text-sm font-semibold text-[var(--inbox-fg)]">Inbox</h2>
        <span className="text-[11px] text-[var(--inbox-muted)]">
          {totalUnreadCount > 0 ? `${totalUnreadCount} unread · ` : ""}
          {conversations.length}
        </span>
      </div>
      <Filters
        filters={filters}
        onChange={onFiltersChange}
        currentUserId={currentUserId}
        totalUnreadCount={totalUnreadCount}
      />
      <div className="min-h-0 flex-1 overflow-y-auto" role="list">
        {isLoading ? <ConversationListSkeleton /> : null}
        {isError ? (
          <InboxErrorState
            message={errorMessage || "Could not load conversations"}
            onRetry={onRetry}
          />
        ) : null}
        {!isLoading && !isError && conversations.length === 0 ? (
          <InboxEmptyState />
        ) : null}
        {!isLoading && !isError
          ? conversations.map((c) => (
              <div key={c.id} className="px-2 py-0.5" role="listitem">
                <ConversationItem
                  conversation={c}
                  selected={selectedId === c.id}
                  unread={
                    c.isUnread === true || (c.unreadCount ?? 0) > 0
                  }
                  onSelect={() => onSelect(c.id)}
                />
              </div>
            ))
          : null}
        <div ref={sentinelRef} className="h-6" aria-hidden />
        {isFetchingNextPage ? (
          <p className="px-3 pb-3 text-center text-[11px] text-[var(--inbox-muted)]">
            Loading more…
          </p>
        ) : null}
      </div>
    </aside>
  );
}
