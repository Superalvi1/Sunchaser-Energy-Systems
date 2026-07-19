import {
  Archive,
  CheckCircle2,
  Loader2,
  UserPlus,
  UserRoundMinus,
  ExternalLink,
} from "lucide-react";
import type { InboxConversationDetail, InboxMessage } from "../types";
import { displayContactLabel, initialsFromId } from "../utils/format";
import Composer from "./Composer";
import MessageTimeline from "./MessageTimeline";
import InboxEmptyState from "./InboxEmptyState";
import { TimelineSkeleton } from "./InboxSkeleton";

type ConversationViewProps = {
  detail: InboxConversationDetail | undefined;
  detailLoading: boolean;
  messages: InboxMessage[];
  messagesLoading: boolean;
  messagesError: boolean;
  messagesErrorMessage?: string;
  onRetryMessages: () => void;
  hasOlderMessages?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  sending?: boolean;
  onSend: (text: string) => void;
  onAssignToMe: () => void;
  onUnassign: () => void;
  onResolve: () => void;
  onArchive: () => void;
  onCreateLead: () => void;
  onOpenCrm: () => void;
  currentUserId: string;
  mutating?: boolean;
};

export default function ConversationView({
  detail,
  detailLoading,
  messages,
  messagesLoading,
  messagesError,
  messagesErrorMessage,
  onRetryMessages,
  hasOlderMessages,
  loadingOlder,
  onLoadOlder,
  sending,
  onSend,
  onAssignToMe,
  onUnassign,
  onResolve,
  onArchive,
  onCreateLead,
  onOpenCrm,
  currentUserId,
  mutating,
}: ConversationViewProps) {
  if (!detail && !detailLoading) {
    return (
      <section
        className="flex h-full min-h-0 flex-col bg-[var(--inbox-bg)]"
        aria-label="Conversation view"
      >
        <InboxEmptyState
          title="Select a conversation"
          description="Choose a thread from the left to reply and manage CRM links."
        />
      </section>
    );
  }

  if (detailLoading && !detail) {
    return (
      <section
        className="flex h-full min-h-0 flex-col bg-[var(--inbox-bg)]"
        aria-label="Conversation view loading"
        aria-busy="true"
      >
        <TimelineSkeleton />
      </section>
    );
  }

  const conversation = detail!.conversation;
  const contact = displayContactLabel(conversation.contactId);
  const assignedToMe = conversation.assignedUserId === currentUserId;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--inbox-bg)]"
      aria-label={`Conversation with ${contact}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--inbox-border)] bg-[var(--inbox-surface)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--inbox-surface-2)] text-xs font-semibold"
            aria-hidden
          >
            {initialsFromId(conversation.contactId)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[var(--inbox-fg)]">
              {contact}
            </h2>
            <p className="truncate text-xs text-[var(--inbox-muted)]">
              Phone · contact {conversation.contactId.slice(-8)} · Channel{" "}
              {conversation.channelId.slice(-6)}
            </p>
            <p className="mt-0.5 text-xs text-[var(--inbox-muted)]">
              Assigned:{" "}
              {conversation.assignedUserId
                ? conversation.assignedUserId === currentUserId
                  ? "You"
                  : conversation.assignedUserId
                : "Unassigned"}{" "}
              · Status{" "}
              <span className="font-medium text-[var(--inbox-fg)]">
                {conversation.status}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={assignedToMe ? onUnassign : onAssignToMe}
            disabled={mutating}
            aria-label={assignedToMe ? "Unassign conversation" : "Assign to me"}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--inbox-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface-2)] disabled:opacity-40"
          >
            {assignedToMe ? (
              <UserRoundMinus className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            )}
            {assignedToMe ? "Unassign" : "Assign"}
          </button>
          <button
            type="button"
            onClick={onResolve}
            disabled={mutating || conversation.status === "resolved"}
            aria-label="Resolve conversation"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--inbox-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface-2)] disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Resolve
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={mutating || conversation.status === "archived"}
            aria-label="Archive conversation"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--inbox-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface-2)] disabled:opacity-40"
          >
            <Archive className="h-3.5 w-3.5" aria-hidden />
            Archive
          </button>
          <button
            type="button"
            onClick={onCreateLead}
            disabled={mutating || Boolean(detail?.crmLink)}
            aria-label="Create lead"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--inbox-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface-2)] disabled:opacity-40"
          >
            {mutating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            )}
            Create Lead
          </button>
          <button
            type="button"
            onClick={onOpenCrm}
            aria-label="Open CRM record"
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--inbox-accent)] px-2.5 py-1.5 text-xs font-semibold text-neutral-950 hover:opacity-90"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Open CRM
          </button>
        </div>
      </header>

      <MessageTimeline
        messages={messages}
        isLoading={messagesLoading}
        isError={messagesError}
        errorMessage={messagesErrorMessage}
        onRetry={onRetryMessages}
        hasOlder={hasOlderMessages}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        onRetryFailed={(m) => {
          if (m.textBody) onSend(m.textBody);
        }}
        events={
          detail?.selfHealed
            ? [
                {
                  id: `sys_reopen_${conversation.id}`,
                  kind: "system" as const,
                  text: "Conversation reopened from inbound activity",
                  at: conversation.updatedAt,
                },
              ]
            : []
        }
      />

      <Composer
        freeForm={detail?.freeForm}
        sending={sending}
        disabled={mutating}
        onSend={onSend}
      />
    </section>
  );
}
