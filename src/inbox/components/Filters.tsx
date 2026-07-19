import type { InboxListFilters, InboxConversationStatus } from "../types";

type FiltersProps = {
  filters: InboxListFilters;
  onChange: (next: InboxListFilters) => void;
  currentUserId: string;
};

const STATUSES: { value: "" | InboxConversationStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
];

export default function Filters({
  filters,
  onChange,
  currentUserId,
}: FiltersProps) {
  return (
    <div className="space-y-2 border-b border-[var(--inbox-border)] p-3">
      <div>
        <label
          htmlFor="inbox-search"
          className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--inbox-muted)]"
        >
          Search
        </label>
        <input
          id="inbox-search"
          name="inbox-search"
          type="search"
          aria-label="Search conversations"
          placeholder="Search contact, channel…"
          value={filters.search ?? ""}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-full rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] px-3 py-2 text-sm text-[var(--inbox-fg)] outline-none ring-[var(--inbox-accent)] placeholder:text-[var(--inbox-muted)] focus:ring-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor="inbox-status-filter"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--inbox-muted)]"
          >
            Status
          </label>
          <select
            id="inbox-status-filter"
            name="inbox-status-filter"
            aria-label="Filter by status"
            value={filters.status ?? ""}
            onChange={(e) =>
              onChange({
                ...filters,
                status: e.target.value as InboxListFilters["status"],
              })
            }
            className="w-full rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] px-2 py-2 text-sm text-[var(--inbox-fg)] outline-none focus:ring-2 focus:ring-[var(--inbox-accent)]"
          >
            {STATUSES.map((s) => (
              <option key={s.value || "all"} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="inbox-assigned-filter"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--inbox-muted)]"
          >
            Assigned
          </label>
          <select
            id="inbox-assigned-filter"
            name="inbox-assigned-filter"
            aria-label="Filter by assignee"
            value={filters.assignedTo ?? ""}
            onChange={(e) =>
              onChange({ ...filters, assignedTo: e.target.value })
            }
            className="w-full rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] px-2 py-2 text-sm text-[var(--inbox-fg)] outline-none focus:ring-2 focus:ring-[var(--inbox-accent)]"
          >
            <option value="">Anyone</option>
            <option value={currentUserId}>Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-1">
        <label
          htmlFor="inbox-unread-filter"
          className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--inbox-fg)]"
        >
          <input
            id="inbox-unread-filter"
            name="inbox-unread-filter"
            type="checkbox"
            aria-label="Show attention-needed conversations"
            checked={Boolean(filters.unreadOnly)}
            onChange={(e) =>
              onChange({ ...filters, unreadOnly: e.target.checked })
            }
            className="h-4 w-4 rounded border-[var(--inbox-border)]"
          />
          Unread / open
        </label>
        <label
          htmlFor="inbox-failed-filter"
          className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--inbox-fg)]"
        >
          <input
            id="inbox-failed-filter"
            name="inbox-failed-filter"
            type="checkbox"
            aria-label="Show conversations with failed messages"
            checked={Boolean(filters.hasFailedMessage)}
            onChange={(e) =>
              onChange({
                ...filters,
                hasFailedMessage: e.target.checked ? true : undefined,
              })
            }
            className="h-4 w-4 rounded border-[var(--inbox-border)]"
          />
          Failures only
        </label>
      </div>
    </div>
  );
}
