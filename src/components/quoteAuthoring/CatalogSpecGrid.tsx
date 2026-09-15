import React from "react";
import { UNAVAILABLE_SPEC } from "../../lib/quoteProjectScope";
import { ScopeFieldLabel } from "./quoteScopeUi";

function safeSpecText(value: unknown, depth = 0): string {
  if (value == null || depth > 5) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => safeSpecText(item, depth + 1)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "label", "name", "text", "title", "displayValue"]) {
      if (!(key in record)) continue;
      const candidate = safeSpecText(record[key], depth + 1);
      if (candidate) return candidate;
    }
    return Object.values(record).map((item) => safeSpecText(item, depth + 1)).filter(Boolean).slice(0, 4).join(", ");
  }
  return "";
}

export default function CatalogSpecGrid({ title, fields }: { title: string; fields: Array<{ label: string; value: unknown }> }) {
  return (
    <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {fields.map((field) => {
          const value = safeSpecText(field.value) || UNAVAILABLE_SPEC;
          return (
            <div key={field.label}>
              <ScopeFieldLabel>{field.label}</ScopeFieldLabel>
              <p className={`mt-0.5 text-[11px] ${value === UNAVAILABLE_SPEC ? "text-slate-600" : "text-slate-200"}`}>
                {value}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
