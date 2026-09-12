import React from "react";
import { UNAVAILABLE_SPEC } from "../../lib/quoteProjectScope";
import { ScopeFieldLabel } from "./quoteScopeUi";

export default function CatalogSpecGrid({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {fields.map((field) => (
          <div key={field.label}>
            <ScopeFieldLabel>{field.label}</ScopeFieldLabel>
            <p className={`mt-0.5 text-[11px] ${field.value === UNAVAILABLE_SPEC ? "text-slate-600" : "text-slate-200"}`}>
              {field.value || UNAVAILABLE_SPEC}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
