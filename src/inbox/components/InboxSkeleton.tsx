export function ConversationListSkeleton() {
  return (
    <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex animate-pulse gap-3 rounded-xl border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] p-3"
        >
          <div className="h-10 w-10 rounded-full bg-[var(--inbox-border)]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 rounded bg-[var(--inbox-border)]" />
            <div className="h-3 w-3/4 rounded bg-[var(--inbox-border)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TimelineSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading messages">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`flex animate-pulse ${i % 2 ? "justify-end" : "justify-start"}`}
        >
          <div className="h-12 w-[55%] rounded-2xl bg-[var(--inbox-border)]" />
        </div>
      ))}
    </div>
  );
}
