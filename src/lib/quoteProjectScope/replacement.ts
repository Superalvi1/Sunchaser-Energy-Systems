import { finiteNumber } from "../quoteCommercialMath";
import type { ProjectScopeState, ScopeLine } from "./types";

function includedQty(scope: ProjectScopeState, id: string): number {
  const line = scope.lines.find((l) => l.id === id);
  if (!line || line.inclusionState !== "included") return 0;
  return finiteNumber(line.qty, 0);
}

function includedLine(scope: ProjectScopeState, id: string): ScopeLine | undefined {
  return scope.lines.find((l) => l.id === id && l.inclusionState === "included");
}

export interface ScheduleCompleteness {
  complete: boolean;
  missing: string[];
}

export function dcScheduleComplete(scope: ProjectScopeState): ScheduleCompleteness {
  const missing: string[] = [];
  if (!(includedQty(scope, "dc_pos") > 0)) missing.push("DC positive run length");
  if (!(includedQty(scope, "dc_neg") > 0)) missing.push("DC negative run length");
  const combinerPath = includedQty(scope, "dc_string_combiner") > 0 || includedQty(scope, "dc_combiner_inverter") > 0;
  const directPath = includedQty(scope, "dc_string_inverter") > 0;
  if (!combinerPath && !directPath) {
    // Positive + negative already represent the string → inverter path.
  }
  if (includedLine(scope, "dc_string_combiner") && !(includedQty(scope, "dc_string_combiner") > 0)) {
    missing.push("String → Combiner DC length");
  }
  if (includedLine(scope, "dc_combiner_inverter") && !(includedQty(scope, "dc_combiner_inverter") > 0)) {
    missing.push("Combiner → Inverter DC length");
  }
  if (includedLine(scope, "dc_string_inverter") && !(includedQty(scope, "dc_string_inverter") > 0)) {
    missing.push("Direct String → Inverter DC length");
  }
  return { complete: missing.length === 0, missing };
}

export function acScheduleComplete(scope: ProjectScopeState): ScheduleCompleteness {
  const missing: string[] = [];
  if (!(includedQty(scope, "ac_inv_db") > 0)) missing.push("Inverter → AC DB cable length");
  for (const id of ["ac_db_lt", "ac_lt_grid", "ac_backup"] as const) {
    const line = includedLine(scope, id);
    if (line && !(includedQty(scope, id) > 0)) missing.push(`${line.name} length`);
  }
  return { complete: missing.length === 0, missing };
}

export function earthScheduleComplete(scope: ProjectScopeState): ScheduleCompleteness {
  const missing: string[] = [];
  if (!(includedQty(scope, "earth_pv") > 0)) missing.push("PV structure earth length");
  if (!(includedQty(scope, "earth_inv") > 0)) missing.push("Inverter earth length");
  return { complete: missing.length === 0, missing };
}

export function canSuppressGenericDc(scope: ProjectScopeState | null | undefined): boolean {
  return Boolean(scope && scope.scopeMode === "advanced" && scope.replaceGenericDc && dcScheduleComplete(scope).complete);
}

export function canSuppressGenericAc(scope: ProjectScopeState | null | undefined): boolean {
  return Boolean(scope && scope.scopeMode === "advanced" && scope.replaceGenericAc && acScheduleComplete(scope).complete);
}

export function canSuppressGenericEarth(scope: ProjectScopeState | null | undefined): boolean {
  return Boolean(scope && scope.scopeMode === "advanced" && scope.replaceGenericEarth && earthScheduleComplete(scope).complete);
}
