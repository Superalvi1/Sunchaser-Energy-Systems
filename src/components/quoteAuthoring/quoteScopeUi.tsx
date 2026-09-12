import React from "react";
import type { IncludeChoice, InclusionState, ScopeLine, ScopeStatus } from "../../lib/quoteProjectScope";

export function ScopeFieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{children}</label>;
}

export function scopeChipClass(active: boolean, tone: "amber" | "emerald" | "sky" = "amber"): string {
  if (active && tone === "emerald") return "bg-emerald-600 text-white";
  if (active && tone === "sky") return "bg-sky-600 text-white";
  if (active) return "bg-amber-500 text-slate-950";
  return "border border-slate-800 text-slate-300 hover:border-amber-500/40";
}

export function money(value: number, digits = 0): string {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function statusTone(status: ScopeStatus): string {
  if (status === "mandatory") return "text-emerald-300";
  if (status === "conditional") return "text-amber-300";
  return "text-slate-400";
}

export function inclusionTone(state: InclusionState): string {
  if (state === "included") return "text-emerald-300";
  if (state === "pending") return "text-amber-300";
  return "text-slate-500";
}

export function choiceFromState(state: InclusionState): IncludeChoice {
  if (state === "included") return "yes";
  if (state === "pending") return "conditional";
  return "no";
}

export function stateFromChoice(choice: IncludeChoice): InclusionState {
  if (choice === "yes") return "included";
  if (choice === "conditional") return "pending";
  return "excluded";
}

export function patchLine(
  line: ScopeLine,
  patch: Partial<ScopeLine>
): ScopeLine {
  const next = { ...line, ...patch };
  if (patch.include && patch.inclusionState == null) {
    next.inclusionState = stateFromChoice(patch.include);
  }
  if (patch.inclusionState && patch.include == null) {
    next.include = choiceFromState(patch.inclusionState);
  }
  if (next.include === "yes" && next.qty === 0 && /job|set|lot/i.test(next.unit)) {
    next.qty = 1;
  }
  return next;
}
