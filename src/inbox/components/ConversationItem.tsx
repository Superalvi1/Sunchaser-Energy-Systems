import { AlertCircle } from "lucide-react";
import type { InboxConversation } from "../types";
import {
  displayContactLabel,
  formatPhoneDisplay,
  formatRelativeTime,
  initialsFromContact,
  initialsFromId,
} from "../utils/format";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-emerald-500/15 text-emerald-400",
  pending: "bg-amber-500/15 text-amber-400",
  resolved: "bg-sky-500/15 text-sky-400",
  archived: "bg-neutral-500/20 text-neutral-400",
};

type ConversationItemProps = {
  conversation: InboxConversation;
  selected: boolean;
  unread?: boolean;
  onSelect: () => void;
};

export default function ConversationItem({
  conversation,
  selected,
  unread,
  onSelect,
}: ConversationItemProps) {
  const label = displayContactLabel(conversation);
  const phone = formatPhoneDisplay(conversation.phoneE164);
  const showPhoneUnderName =
    Boolean(String(conversation.profileName || "").trim()) && Boolean(phone);
  const activity =
    conversation.lastMessageAt ??
    conversation.updatedAt ??
    conversation.createdAt;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Conversation with ${label}, status ${conversation.status}`}
      aria-current={selected ? "true" : undefined}
      className={`group flex w-full gap-3 rounded-xl border px-3 py-3 text-left transition ${
        selected
          ? "border-[var(--inbox-accent)]/50 bg-[var(--inbox-accent)]/10"
          : "border-transparent hover:border-[var(--inbox-border)] hover:bg-[var(--inbox-surface-2)]"
      }`}
    >
      <div
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--inbox-surface-2)] text-xs font-semibold text-[var(--inbox-fg)]"
        aria-hidden
      >
        {initialsFromContact(conversation)}
        {unread ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--inbox-accent)] ring-2 ring-[var(--inbox-surface)]" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold text-[var(--inbox-fg)]">
            {label}
          </p>
          <time
            className="shrink-0 text-[11px] text-[var(--inbox-muted)]"
            dateTime={activity}
          >
            {formatRelativeTime(activity)}
          </time>
        </div>
        <p className="mt-0.5 truncate text-xs text-[var(--inbox-muted)]">
          {showPhoneUnderName
            ? phone
            : `Channel ${conversation.channelId.slice(-6)}`}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[conversation.status] ?? STATUS_STYLES.open}`}
          >
            {conversation.status}
          </span>
          {conversation.assignedUserId ? (
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--inbox-border)] text-[9px] font-bold text-[var(--inbox-fg)]"
              title={`Assigned ${conversation.assignedUserId}`}
              aria-label={`Assigned to ${conversation.assignedUserId}`}
            >
              {initialsFromId(conversation.assignedUserId)}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--inbox-muted)]">
              Unassigned
            </span>
          )}
          {conversation.hasFailedMessage ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400"
              aria-label="Has failed message"
            >
              <AlertCircle className="h-3 w-3" aria-hidden />
              Failed
            </span>
          ) : null}
          {unread ? (
            <span className="rounded-md bg-[var(--inbox-accent)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--inbox-accent)]">
              Unread
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
