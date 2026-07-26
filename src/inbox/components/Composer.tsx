import { Loader2, Paperclip, Send, Smile } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FreeFormEligibility } from "../types";

const QUICK_EMOJI = ["👍", "✅", "🙏", "😊", "☀️"];

type ComposerProps = {
  freeForm: FreeFormEligibility | null | undefined;
  sending?: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  /**
   * When this token changes, replace the composer text with `seedText`.
   * Used by AI-03 “Copy to composer” — does not send.
   */
  seedText?: string | null;
  seedToken?: number;
};

export default function Composer({
  freeForm,
  sending,
  disabled,
  onSend,
  seedText,
  seedToken,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textId = useId();
  const allowed = freeForm?.freeFormAllowed !== false || freeForm == null;
  const closed = freeForm != null && !freeForm.freeFormAllowed;

  useEffect(() => {
    if (seedToken == null || seedToken <= 0) return;
    if (typeof seedText === "string") {
      setText(seedText);
    }
  }, [seedToken, seedText]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled || closed) return;
    onSend(trimmed);
    setText("");
    setEmojiOpen(false);
  };

  return (
    <div className="border-t border-[var(--inbox-border)] bg-[var(--inbox-surface)] p-3">
      {freeForm ? (
        <div
          className={`mb-2 rounded-lg px-3 py-2 text-xs ${
            closed
              ? "bg-amber-500/10 text-amber-300"
              : "bg-emerald-500/10 text-emerald-300"
          }`}
          role="status"
        >
          {closed ? (
            <>
              <strong className="font-semibold">Template required.</strong> The
              24-hour free-form window is closed
              {freeForm.windowExpiresAt
                ? ` (ended ${new Date(freeForm.windowExpiresAt).toLocaleString()})`
                : ""}
              .
            </>
          ) : (
            <>
              Free-form messaging open
              {freeForm.windowExpiresAt
                ? ` until ${new Date(freeForm.windowExpiresAt).toLocaleString()}`
                : ""}
              .
            </>
          )}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="relative">
          <button
            type="button"
            aria-label="Insert emoji"
            aria-expanded={emojiOpen}
            aria-controls="inbox-emoji-panel"
            disabled={disabled || closed}
            onClick={() => setEmojiOpen((v) => !v)}
            className="rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] p-2 text-[var(--inbox-muted)] hover:text-[var(--inbox-fg)] disabled:opacity-40"
          >
            <Smile className="h-4 w-4" aria-hidden />
          </button>
          {emojiOpen ? (
            <div
              id="inbox-emoji-panel"
              role="listbox"
              aria-label="Emoji picker"
              className="absolute bottom-11 left-0 z-10 flex gap-1 rounded-xl border border-[var(--inbox-border)] bg-[var(--inbox-surface)] p-2 shadow-lg"
            >
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="option"
                  aria-label={`Insert ${e}`}
                  className="rounded-md px-1.5 py-1 text-lg hover:bg-[var(--inbox-surface-2)]"
                  onClick={() => {
                    setText((t) => t + e);
                    setEmojiOpen(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          aria-label="Attach file (coming soon)"
          disabled
          title="Attachments coming soon"
          className="rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] p-2 text-[var(--inbox-muted)] opacity-40"
        >
          <Paperclip className="h-4 w-4" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <label htmlFor={textId} className="sr-only">
            Message text
          </label>
          <textarea
            id={textId}
            name="inbox-composer"
            aria-label="Message text"
            rows={2}
            value={text}
            disabled={disabled || closed || sending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              closed
                ? "Free-form window closed — template required"
                : "Write a reply… (Enter to send, Shift+Enter for newline)"
            }
            className="w-full resize-none rounded-xl border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] px-3 py-2 text-sm text-[var(--inbox-fg)] outline-none ring-[var(--inbox-accent)] placeholder:text-[var(--inbox-muted)] focus:ring-2 disabled:opacity-50"
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || sending || disabled || closed || !allowed}
          aria-label={sending ? "Sending message" : "Send message"}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[var(--inbox-accent)] px-3 text-sm font-semibold text-neutral-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          Send
        </button>
      </div>
    </div>
  );
}
