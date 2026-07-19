import { Inbox } from "lucide-react";

export default function InboxEmptyState({
  title = "No conversations",
  description = "New WhatsApp conversations will appear here.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center"
      role="status"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--inbox-surface-2)] text-[var(--inbox-muted)]">
        <Inbox className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-[var(--inbox-fg)]">{title}</h3>
      <p className="max-w-xs text-xs text-[var(--inbox-muted)]">{description}</p>
    </div>
  );
}
