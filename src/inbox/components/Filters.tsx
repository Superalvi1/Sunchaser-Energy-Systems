import type {
  InboxListFilters,
  InboxQuickFilter,
} from "../types";

type FiltersProps = {
  filters: InboxListFilters;
  onChange: (next: InboxListFilters) => void;
  currentUserId: string;
  totalUnreadCount?: number;
};

const QUICK_FILTERS: { value: InboxQuickFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
];

export default function Filters({
  filters,
  onChange,
  currentUserId,
  totalUnreadCount = 0,
}: FiltersProps) {
  const active: InboxQuickFilter =
    filters.quickFilter ??
    (filters.unreadOnly ? "unread" : "all");

  return (
    <div className="space-y-2 border-b border-[var(--inbox-border)] p-3">
      <div
        className="flex flex-wrap gap-1"
        role="tablist"
        aria-label="Inbox quick filters"
      >
        {QUICK_FILTERS.map((tab) => {
          const selected = active === tab.value;
          const badge =
            tab.value === "unread" && totalUnreadCount > 0
              ? totalUnreadCount
              : null;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() =>
                onChange({
                  ...filters,
                  quickFilter: tab.value,
                  unreadOnly: tab.value === "unread" ? true : undefined,
                  // Status dropdown stays independent; quick tabs own status buckets.
                  status:
                    tab.value === "open" ||
                    tab.value === "resolved" ||
                    tab.value === "archived"
                      ? undefined
                      : filters.status,
                })
              }
              className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                selected
                  ? "bg-[var(--inbox-accent)] text-neutral-950"
                  : "bg-[var(--inbox-surface-2)] text-[var(--inbox-fg)] hover:opacity-90"
              }`}
            >
              {tab.label}
              {badge != null ? (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-bold ${
                    selected
                      ? "bg-neutral-950/15 text-neutral-950"
                      : "bg-[var(--inbox-accent)]/20 text-[var(--inbox-accent)]"
                  }`}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

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
          aria-label="Search conversations by name or phone"
          placeholder="Search name or phone…"
          value={filters.search ?? ""}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-full rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] px-3 py-2 text-sm text-[var(--inbox-fg)] outline-none ring-[var(--inbox-accent)] placeholder:text-[var(--inbox-muted)] focus:ring-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
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
        <div className="flex items-end">
          <label
            htmlFor="inbox-failed-filter"
            className="inline-flex cursor-pointer items-center gap-2 pb-2 text-xs text-[var(--inbox-fg)]"
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
    </div>
  );
}
