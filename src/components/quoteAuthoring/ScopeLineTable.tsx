import React from "react";
import type { IncludeChoice, ScopeLine } from "../../lib/quoteProjectScope";
import { lineAmount } from "../../lib/quoteProjectScope";
import { inclusionTone, money, patchLine, ScopeFieldLabel, statusTone } from "./quoteScopeUi";

export function ScopeLineTable({
  lines,
  onChangeLine,
  compact,
}: {
  lines: ScopeLine[];
  onChangeLine: (id: string, next: ScopeLine) => void;
  compact?: boolean;
}) {
  if (!lines.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[11px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-500">
            <th className="pb-2 pr-2 font-bold">Include</th>
            <th className="pb-2 pr-2 font-bold">Item</th>
            {!compact && <th className="pb-2 pr-2 font-bold">Specification</th>}
            <th className="pb-2 pr-2 font-bold">Qty</th>
            <th className="pb-2 pr-2 font-bold">Unit</th>
            <th className="pb-2 pr-2 font-bold">Rate</th>
            <th className="pb-2 pr-2 font-bold">Total</th>
            <th className="pb-2 font-bold">Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const total = lineAmount(line);
            return (
              <tr key={line.id} className="border-t border-slate-800/80 align-top">
                <td className="py-2 pr-2">
                  <select
                    value={line.include}
                    onChange={(e) =>
                      onChangeLine(line.id, patchLine(line, { include: e.target.value as IncludeChoice }))
                    }
                    className="w-[7.5rem] rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-white"
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="conditional">Conditional</option>
                  </select>
                  <div className={`mt-0.5 text-[10px] ${inclusionTone(line.inclusionState)}`}>
                    {line.inclusionState}
                  </div>
                </td>
                <td className="py-2 pr-2 text-slate-200">
                  <div className="font-semibold">{line.name}</div>
                  {line.catalogProductId ? (
                    <div className="text-[10px] text-slate-500">CRM {line.catalogProductId}</div>
                  ) : null}
                </td>
                {!compact && (
                  <td className="py-2 pr-2">
                    <input
                      value={line.specification}
                      onChange={(e) => onChangeLine(line.id, patchLine(line, { specification: e.target.value }))}
                      placeholder="Spec / notes"
                      className="w-full min-w-[8rem] rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-white"
                    />
                  </td>
                )}
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={line.qty}
                    onChange={(e) => onChangeLine(line.id, patchLine(line, { qty: Number(e.target.value) }))}
                    className="w-20 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-white"
                  />
                </td>
                <td className="py-2 pr-2 text-slate-400">{line.unit}</td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={line.rate}
                    onChange={(e) =>
                      onChangeLine(line.id, patchLine(line, { rate: Number(e.target.value), rateSource: "manual" }))
                    }
                    className="w-24 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-white"
                  />
                  {line.rateSource === "company_preset" && line.rate > 0 ? (
                    <div className="text-[9px] text-slate-500">company preset</div>
                  ) : line.rateSource === "none" && line.rate === 0 ? (
                    <div className="text-[9px] text-slate-600">no invented price</div>
                  ) : null}
                </td>
                <td className="py-2 pr-2 text-white font-semibold">
                  {line.inclusionState === "included" ? money(total) : "—"}
                </td>
                <td className="py-2">
                  <span className={statusTone(line.scopeStatus)}>{line.scopeStatus}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-slate-500">
        Pending and excluded lines are not priced. Empty rates stay blank — catalog / company preset / manual only.
      </p>
    </div>
  );
}

export function ScopeDetails({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-amber-400/90">
        {title}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
      <span>
        <span className="block text-xs font-semibold text-slate-200">{label}</span>
        {hint ? <span className="block text-[10px] text-slate-500 mt-0.5">{hint}</span> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <ScopeFieldLabel>{label}</ScopeFieldLabel>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
      />
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <ScopeFieldLabel>{label}</ScopeFieldLabel>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
      />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <ScopeFieldLabel>{label}</ScopeFieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
      >
        {options.map((opt) => (
          <option key={opt.value || "blank"} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
