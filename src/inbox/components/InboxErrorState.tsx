import { AlertTriangle } from "lucide-react";

export default function InboxErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center"
      role="alert"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
        <AlertTriangle className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-[var(--inbox-fg)]">
        Something went wrong
      </h3>
      <p className="max-w-sm text-xs text-[var(--inbox-muted)]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry loading inbox"
          className="rounded-lg bg-[var(--inbox-accent)] px-3 py-2 text-xs font-semibold text-neutral-950 transition hover:opacity-90"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
