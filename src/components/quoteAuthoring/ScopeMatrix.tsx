import React from "react";
import type { ScopeMatrixGroup } from "../../lib/quoteProjectScope";

export default function ScopeMatrix({ matrix }: { matrix: ScopeMatrixGroup }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Project scope matrix</h3>
      <p className="text-[11px] text-slate-500">Review included, excluded and pending items before Apply draft.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
        <MatrixCol title="Included" items={matrix.included} tone="emerald" />
        <MatrixCol title="Excluded" items={matrix.excluded} tone="slate" />
        <MatrixCol title="Conditional / pending site survey" items={matrix.pending} tone="amber" />
      </div>
    </div>
  );
}

function MatrixCol({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "emerald" | "amber" | "slate";
}) {
  const color =
    tone === "emerald" ? "text-emerald-300 border-emerald-500/20" : tone === "amber" ? "text-amber-200 border-amber-500/20" : "text-slate-400 border-slate-800";
  return (
    <div className={`rounded-xl border bg-slate-950/50 p-3 ${color}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2">{title}</p>
      {items.length ? (
        <ul className="space-y-1 list-disc pl-4">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-600">None</p>
      )}
    </div>
  );
}
