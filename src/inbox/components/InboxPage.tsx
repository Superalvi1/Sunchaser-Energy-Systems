import { Moon, Sun } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useToast } from "../../lib/toast";
import type { User } from "../../types";
import { useInboxConversation } from "../hooks/useInboxConversation";
import { useInboxConversations } from "../hooks/useInboxConversations";
import { useInboxMessages } from "../hooks/useInboxMessages";
import { useInboxMutations } from "../hooks/useInboxMutations";
import type { InboxListFilters } from "../types";
import ConversationList from "./ConversationList";
import ConversationView from "./ConversationView";
import CRMPanel from "./CRMPanel";

type InboxPageProps = {
  staffUser: User;
};

export default function InboxPage({ staffUser }: InboxPageProps) {
  const toast = useToast();
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (
      (localStorage.getItem("sunchaser_inbox_theme") as "dark" | "light") ||
      "dark"
    );
  });
  const [filters, setFilters] = useState<InboxListFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => new Set());
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");

  const list = useInboxConversations(filters);
  const detail = useInboxConversation(selectedId);
  const messages = useInboxMessages(selectedId);
  const mutations = useInboxMutations();

  useEffect(() => {
    localStorage.setItem("sunchaser_inbox_theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!selectedId && list.conversations[0]) {
      setSelectedId(list.conversations[0].id);
    }
  }, [selectedId, list.conversations]);

  useEffect(() => {
    if (!selectedId) return;
    setUnreadIds((prev) => {
      if (!prev.has(selectedId)) return prev;
      const next = new Set(prev);
      next.delete(selectedId);
      return next;
    });
  }, [selectedId]);

  // Mark newly delta-updated conversations as unread when not selected.
  useEffect(() => {
    setUnreadIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const c of list.conversations) {
        if (c.id === selectedId) continue;
        // Heuristic: failed messages always surface as unread attention.
        if (c.hasFailedMessage && !next.has(c.id)) {
          next.add(c.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [list.conversations, selectedId]);

  useEffect(() => {
    const latestInbound = [...messages.messages]
      .reverse()
      .find((m) => m.direction === "inbound");
    if (!selectedId || !latestInbound) return;
    mutations.markRead.mutate({
      conversationId: selectedId,
      lastSeenMessageId: latestInbound.id,
      lastSeenMessageCreatedAt: latestInbound.createdAt,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mark once per conversation/latest inbound
  }, [selectedId, messages.messages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = list.conversations.findIndex((c) => c.id === selectedId);
        const next = list.conversations[idx + 1];
        if (next) {
          setSelectedId(next.id);
          setMobilePane("thread");
        }
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = list.conversations.findIndex((c) => c.id === selectedId);
        const prev = list.conversations[Math.max(0, idx - 1)];
        if (prev) {
          setSelectedId(prev.id);
          setMobilePane("thread");
        }
      }
      if (e.key === "Escape") {
        setMobilePane("list");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.conversations, selectedId]);

  const mutating =
    mutations.assign.isPending ||
    mutations.unassign.isPending ||
    mutations.setStatus.isPending ||
    mutations.createLead.isPending;

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setMobilePane("thread");
  }, []);

  const conversation = detail.data?.conversation;

  const handleSend = (text: string) => {
    if (!selectedId) return;
    mutations.send.mutate(
      { conversationId: selectedId, text },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Send failed"),
      }
    );
  };

  const lock = conversation?.lockVersion ?? 1;

  const themeVars = useMemo(
    () =>
      theme === "light"
        ? ({
            "--inbox-bg": "#f4f6f8",
            "--inbox-surface": "#ffffff",
            "--inbox-surface-2": "#f0f2f5",
            "--inbox-border": "#e2e6eb",
            "--inbox-fg": "#111827",
            "--inbox-muted": "#6b7280",
            "--inbox-accent": "#f59e0b",
            "--inbox-bubble-in": "#ffffff",
            "--inbox-bubble-out": "#dcf8c6",
          } as CSSProperties)
        : ({
            "--inbox-bg": "#0b0c0e",
            "--inbox-surface": "#121417",
            "--inbox-surface-2": "#1a1d22",
            "--inbox-border": "#2a2f36",
            "--inbox-fg": "#f3f4f6",
            "--inbox-muted": "#9ca3af",
            "--inbox-accent": "#f59e0b",
            "--inbox-bubble-in": "#1f242c",
            "--inbox-bubble-out": "#1f3d2a",
          } as CSSProperties),
    [theme]
  );

  return (
    <div
      className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-[var(--inbox-border)] shadow-xl"
      style={themeVars}
      data-inbox-theme={theme}
    >
      <div className="flex items-center justify-between border-b border-[var(--inbox-border)] bg-[var(--inbox-surface)] px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold text-[var(--inbox-fg)]">
            WhatsApp Shared Inbox
          </h1>
          <p className="text-[11px] text-[var(--inbox-muted)]">
            j/k navigate · Esc back to list · Enter send
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--inbox-border)] px-2.5 py-1.5 text-xs text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface-2)]"
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Moon className="h-3.5 w-3.5" aria-hidden />
          )}
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_300px]">
        <div
          className={`min-h-0 ${mobilePane === "list" ? "block" : "hidden"} lg:block`}
        >
          <ConversationList
            filters={filters}
            onFiltersChange={setFilters}
            currentUserId={staffUser.id}
            conversations={list.conversations}
            selectedId={selectedId}
            onSelect={onSelect}
            isLoading={list.isLoading}
            isError={list.isError}
            errorMessage={
              list.error instanceof Error
                ? list.error.message
                : "Failed to load conversations"
            }
            onRetry={() => void list.refetch()}
            hasNextPage={Boolean(list.hasNextPage)}
            isFetchingNextPage={list.isFetchingNextPage}
            fetchNextPage={() => void list.fetchNextPage()}
            unreadIds={unreadIds}
          />
        </div>

        <div
          className={`min-h-0 ${mobilePane === "thread" ? "block" : "hidden"} lg:block`}
        >
          <ConversationView
            detail={detail.data}
            detailLoading={detail.isLoading}
            messages={messages.messages}
            messagesLoading={messages.isLoading}
            messagesError={messages.isError}
            messagesErrorMessage={
              messages.error instanceof Error
                ? messages.error.message
                : "Failed to load messages"
            }
            onRetryMessages={() => void messages.refetch()}
            hasOlderMessages={Boolean(messages.hasNextPage)}
            loadingOlder={messages.isFetchingNextPage}
            onLoadOlder={() => void messages.fetchNextPage()}
            sending={mutations.send.isPending}
            onSend={handleSend}
            currentUserId={staffUser.id}
            mutating={mutating}
            onAssignToMe={() => {
              if (!selectedId) return;
              mutations.assign.mutate(
                {
                  conversationId: selectedId,
                  assigneeUserId: staffUser.id,
                  expectedLockVersion: lock,
                },
                {
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Assign failed"
                    ),
                  onSuccess: () => toast.success("Assigned to you"),
                }
              );
            }}
            onUnassign={() => {
              if (!selectedId) return;
              mutations.unassign.mutate(
                {
                  conversationId: selectedId,
                  expectedLockVersion: lock,
                },
                {
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Unassign failed"
                    ),
                }
              );
            }}
            onResolve={() => {
              if (!selectedId) return;
              mutations.setStatus.mutate(
                {
                  conversationId: selectedId,
                  status: "resolved",
                  expectedLockVersion: lock,
                },
                {
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Resolve failed"
                    ),
                  onSuccess: () => toast.success("Marked resolved"),
                }
              );
            }}
            onArchive={() => {
              if (!selectedId) return;
              mutations.setStatus.mutate(
                {
                  conversationId: selectedId,
                  status: "archived",
                  expectedLockVersion: lock,
                },
                {
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Archive failed"
                    ),
                  onSuccess: () => toast.success("Archived"),
                }
              );
            }}
            onCreateLead={() => {
              if (!selectedId) return;
              mutations.createLead.mutate(
                { conversationId: selectedId },
                {
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Create lead failed"
                    ),
                  onSuccess: () => toast.success("Lead created"),
                }
              );
            }}
            onOpenCrm={() => {
              const link = detail.data?.crmLink;
              if (!link) {
                toast.info("No CRM link yet — create a lead first.");
                return;
              }
              toast.success(
                `Open ${link.linkedEntityType}: ${link.linkedEntityId}`
              );
            }}
          />
        </div>

        <div className="hidden min-h-0 lg:block">
          <CRMPanel
            detail={detail.data}
            isLoading={detail.isLoading && Boolean(selectedId)}
            creatingLead={mutations.createLead.isPending}
            onCreateLead={() => {
              if (!selectedId) return;
              mutations.createLead.mutate(
                { conversationId: selectedId },
                {
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Create lead failed"
                    ),
                  onSuccess: () => toast.success("Lead created"),
                }
              );
            }}
            onOpenCrm={() => {
              const link = detail.data?.crmLink;
              if (!link) {
                toast.info("No CRM link yet — create a lead first.");
                return;
              }
              toast.success(
                `Open ${link.linkedEntityType}: ${link.linkedEntityId}`
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}
