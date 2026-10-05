import { FileText, Loader2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { fetchInboxTemplates } from "../api/inboxApi";
import type { InboxTemplateSendInput, InboxTemplateSummary } from "../types";

type TemplatePickerProps = {
  conversationId: string;
  sending?: boolean;
  disabled?: boolean;
  onSend: (input: InboxTemplateSendInput) => void;
  onClose: () => void;
};

/** Values Meta rejects (error 132018): line breaks, tabs, 5+ spaces. */
function paramError(value: string): string | null {
  if (!value.trim()) return "Required";
  if (/[\r\n\t]/.test(value)) return "No line breaks or tabs";
  if (/ {5,}/.test(value)) return "No more than four spaces in a row";
  if (value.length > 1024) return "Too long";
  return null;
}

function fill(text: string, values: readonly string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (m, n) => values[Number(n) - 1] || m);
}

const keyOf = (t: InboxTemplateSummary) => `${t.name}::${t.language}`;

export default function TemplatePicker({
  conversationId,
  sending,
  disabled,
  onSend,
  onClose,
}: TemplatePickerProps) {
  const [templates, setTemplates] = useState<InboxTemplateSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [body, setBody] = useState<string[]>([]);
  const [header, setHeader] = useState("");
  const [buttons, setButtons] = useState<Record<number, string>>({});
  const selectId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchInboxTemplates()
      .then((r) => {
        if (!cancelled) setTemplates(r.templates);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load templates");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendable = useMemo(() => (templates ?? []).filter((t) => t.sendable), [templates]);
  const unavailable = useMemo(() => (templates ?? []).filter((t) => !t.sendable), [templates]);
  const selected = sendable.find((t) => keyOf(t) === selectedKey) ?? null;
  const headerVar = selected?.header?.format === "TEXT" && "varCount" in selected.header
    ? selected.header.varCount === 1
    : false;
  const urlButtons = (selected?.buttons ?? [])
    .map((b, index) => ({ ...b, index }))
    .filter((b) => b.kind === "URL" && b.urlVarCount === 1);

  const choose = (key: string) => {
    setSelectedKey(key);
    const t = sendable.find((x) => keyOf(x) === key);
    setBody(Array.from({ length: t?.bodyVarCount ?? 0 }, () => ""));
    setHeader("");
    setButtons({});
  };

  const errors = [
    ...body.map(paramError),
    ...(headerVar ? [paramError(header)] : []),
    ...urlButtons.map((b) => paramError(buttons[b.index] ?? "")),
  ];
  const valid = selected != null && errors.every((e) => e === null);

  const preview = selected
    ? [
        selected.header?.format === "TEXT" && "text" in selected.header
          ? fill(selected.header.text, headerVar ? [header] : [])
          : "",
        fill(selected.bodyText, body),
        selected.footerText ?? "",
      ]
        .filter((p) => p.trim())
        .join("\n\n")
    : "";

  const submit = () => {
    if (!selected || !valid || sending || disabled) return;
    onSend({
      conversationId,
      templateName: selected.name,
      languageCode: selected.language,
      bodyParameters: body,
      ...(headerVar ? { headerParameter: header } : {}),
      buttonUrlParameters: Object.fromEntries(urlButtons.map((b) => [b.index, buttons[b.index] ?? ""])),
    });
  };

  const input = (value: string, onChange: (v: string) => void, label: string) => {
    const error = paramError(value);
    return (
      <label className="block text-xs text-[var(--inbox-muted)]" key={label}>
        {label}
        <input
          value={value}
          aria-label={label}
          aria-invalid={error !== null}
          disabled={sending || disabled}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] px-2 py-1.5 text-sm text-[var(--inbox-fg)] outline-none ring-[var(--inbox-accent)] focus:ring-2"
        />
        {value && error ? <span className="text-amber-300">{error}</span> : null}
      </label>
    );
  };

  return (
    <div
      role="dialog"
      aria-label="Send approved template"
      className="mb-2 space-y-3 rounded-xl border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] p-3"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--inbox-fg)]">
          <FileText className="h-4 w-4" aria-hidden /> Approved template
        </span>
        <button
          type="button"
          aria-label="Close template picker"
          onClick={onClose}
          className="rounded-md p-1 text-[var(--inbox-muted)] hover:text-[var(--inbox-fg)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {loadError ? (
        <p role="alert" className="text-xs text-amber-300">{loadError}</p>
      ) : templates === null ? (
        <p className="flex items-center gap-2 text-xs text-[var(--inbox-muted)]">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading templates…
        </p>
      ) : sendable.length === 0 ? (
        <p className="text-xs text-[var(--inbox-muted)]">
          No approved templates are available for this WhatsApp account yet. Create and
          get them approved in WhatsApp Manager.
        </p>
      ) : (
        <>
          <label htmlFor={selectId} className="sr-only">Template</label>
          <select
            id={selectId}
            value={selectedKey}
            disabled={sending || disabled}
            onChange={(e) => choose(e.target.value)}
            className="w-full rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface)] px-2 py-1.5 text-sm text-[var(--inbox-fg)]"
          >
            <option value="">Choose a template…</option>
            {sendable.map((t) => (
              <option key={keyOf(t)} value={keyOf(t)}>
                {t.name} ({t.language}) · {t.category.toLowerCase()}
              </option>
            ))}
          </select>

          {selected ? (
            <div className="space-y-2">
              {headerVar ? input(header, setHeader, "Header value") : null}
              {body.map((v, i) =>
                input(v, (next) => setBody((prev) => prev.map((x, j) => (j === i ? next : x))), `Body value {{${i + 1}}}`)
              )}
              {urlButtons.map((b) =>
                input(
                  buttons[b.index] ?? "",
                  (next) => setButtons((prev) => ({ ...prev, [b.index]: next })),
                  `“${b.text}” link value`
                )
              )}
              <pre className="whitespace-pre-wrap rounded-lg bg-[var(--inbox-surface)] p-2 text-xs text-[var(--inbox-fg)]" aria-label="Template preview">
                {preview}
              </pre>
              <button
                type="button"
                onClick={submit}
                disabled={!valid || sending || disabled}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--inbox-accent)] px-3 py-1.5 text-sm font-semibold text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Send template
              </button>
            </div>
          ) : null}
        </>
      )}

      {unavailable.length > 0 ? (
        <details className="text-xs text-[var(--inbox-muted)]">
          <summary>{unavailable.length} template(s) not available to send</summary>
          <ul className="mt-1 space-y-0.5">
            {unavailable.map((t) => (
              <li key={keyOf(t)}>
                {t.name} ({t.language}): {t.unsupportedReason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
