/**
 * AI-03 human-reviewed AI draft panel.
 * Manual generate only — never auto-runs on conversation open / never auto-sends.
 */
import {
  AlertTriangle,
  Copy,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useId } from "react";
import type { AiDraftUiState } from "../hooks/useAiDraft";

type AiDraftPanelProps = {
  state: AiDraftUiState;
  disabled?: boolean;
  canGenerate: boolean;
  /** Optional status line derived from config booleans. */
  statusHint?: string | null;
  onGenerate: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
  onCopyToComposer: () => void;
  onEditableTextChange: (text: string) => void;
};

function confidenceLabel(confidence: number): string {
  if (confidence < 0.55) return "Low";
  if (confidence < 0.8) return "Medium";
  return "High";
}

export default function AiDraftPanel({
  state,
  disabled,
  canGenerate,
  statusHint,
  onGenerate,
  onRegenerate,
  onDiscard,
  onCopyToComposer,
  onEditableTextChange,
}: AiDraftPanelProps) {
  const draftId = useId();
  const loading = state.status === "loading";
  const ready = state.status === "ready" && state.draft != null;

  return (
    <div
      className="border-t border-[var(--inbox-border)] bg-[var(--inbox-surface)] px-3 pt-3"
      data-testid="ai-draft-panel"
      aria-label="AI Reply Assistant"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--inbox-fg)]">
            AI Reply Assistant
          </p>
          <p className="text-[11px] text-[var(--inbox-muted)]">
            Staff-click draft only — human review required · never auto-sends.
          </p>
          {statusHint ? (
            <p
              className="mt-0.5 text-[11px] text-[var(--inbox-muted)]"
              data-testid="ai-draft-status-hint"
            >
              {statusHint}
            </p>
          ) : null}
        </div>
        {canGenerate ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={disabled || loading}
            aria-label={
              loading ? "Generating AI draft" : "Generate AI Draft"
            }
            aria-busy={loading || undefined}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
            {loading ? "Generating…" : "Generate AI Draft"}
          </button>
        ) : null}
      </div>

      {state.status === "unavailable" ? (
        <div
          role="status"
          className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          AI draft unavailable
          {state.errorMessage ? `: ${state.errorMessage}` : "."}
        </div>
      ) : null}

      {state.status === "timeout" ? (
        <div
          role="alert"
          className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          Draft generation timed out. Nothing was sent. You can try again.
        </div>
      ) : null}

      {state.status === "failure" || state.status === "denied" ? (
        <div
          role="alert"
          className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          {state.errorMessage || "Draft generation failed. Nothing was sent."}
        </div>
      ) : null}

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-[var(--inbox-border)] px-3 py-4 text-xs text-[var(--inbox-muted)]"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Generating draft… human review will still be required.
        </div>
      ) : null}

      {ready && state.draft ? (
        <div className="mb-2 space-y-2 rounded-xl border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-200">
              AI content — human review required
            </span>
            <span className="text-[var(--inbox-muted)]">
              Confidence: {confidenceLabel(state.draft.confidence)} (
              {Math.round(state.draft.confidence * 100)}%)
            </span>
            {state.draft.escalate ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 font-medium text-red-200">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Escalation suggested
                {state.draft.escalationReasons.length
                  ? `: ${state.draft.escalationReasons.join(", ")}`
                  : ""}
              </span>
            ) : null}
          </div>

          {state.draft.warnings.length > 0 ? (
            <ul className="list-inside list-disc text-[11px] text-amber-100/90">
              {state.draft.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <label htmlFor={draftId} className="sr-only">
            Editable AI draft
          </label>
          <textarea
            id={draftId}
            name="inbox-ai-draft"
            aria-label="Editable AI draft — human review required"
            rows={4}
            value={state.editableText}
            disabled={disabled || loading}
            onChange={(e) => onEditableTextChange(e.target.value)}
            className="w-full resize-y rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-bg)] px-3 py-2 text-sm text-[var(--inbox-fg)] outline-none ring-[var(--inbox-accent)] focus:ring-2 disabled:opacity-50"
          />

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onCopyToComposer}
              disabled={disabled || !state.editableText.trim()}
              aria-label="Copy draft to composer"
              className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[var(--inbox-accent)] px-2.5 py-1.5 text-xs font-semibold text-neutral-950 hover:opacity-90 disabled:opacity-40"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy to composer
            </button>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={disabled || loading || !canGenerate}
              aria-label="Regenerate AI draft"
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--inbox-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface)] disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Regenerate
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={disabled || loading}
              aria-label="Discard AI draft"
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--inbox-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface)] disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
