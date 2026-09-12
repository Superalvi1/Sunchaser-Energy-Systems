import { finiteNumber, nonNegativeFinite } from "../quoteCommercialMath";
import type { AcCableRunDetail, DcCableRunDetail, EarthingConductorDetail } from "./electricalTypes";
import type { ProjectScopeState, ScopeLine } from "./types";

function includedLine(scope: ProjectScopeState, id: string): ScopeLine | undefined {
  return scope.lines.find((l) => l.id === id && l.inclusionState === "included");
}

function trimmed(value: unknown): string {
  return String(value || "").trim();
}

export interface ScheduleCompleteness {
  complete: boolean;
  missing: string[];
}

function dcRunMissing(scope: ProjectScopeState, id: string, requirePolarity: boolean): string[] {
  const line = includedLine(scope, id);
  const label = line?.name || id;
  if (!line) return [`${label} must be included`];
  const detail: DcCableRunDetail | undefined = scope.dcCables?.[id];
  const missing: string[] = [];
  if (!detail) {
    missing.push(`${label}: structured specification`);
    return missing;
  }
  if (!(finiteNumber(detail.lengthM, 0) > 0)) missing.push(`${label}: length`);
  if (!(finiteNumber(detail.runCount, 0) > 0)) missing.push(`${label}: run count`);
  if (!detail.conductor) missing.push(`${label}: conductor`);
  if (!detail.areaMm2) missing.push(`${label}: area mm²`);
  if (detail.areaMm2 === "custom" && !trimmed(detail.customArea)) missing.push(`${label}: custom area`);
  if (!detail.voltageRating) missing.push(`${label}: voltage rating`);
  if (detail.voltageRating === "custom" && !trimmed(detail.customVoltage)) missing.push(`${label}: custom voltage`);
  if (!trimmed(detail.cableType)) missing.push(`${label}: cable type`);
  if (requirePolarity && !trimmed(detail.polarity)) missing.push(`${label}: polarity`);
  if (nonNegativeFinite(detail.ratePerMeter) == null) missing.push(`${label}: rate`);
  return missing;
}

function acRunMissing(scope: ProjectScopeState, id: string, required: boolean): string[] {
  const line = includedLine(scope, id);
  const label = line?.name || id;
  if (!line) return required ? [`${label} must be included`] : [];
  const detail: AcCableRunDetail | undefined = scope.acCables?.[id];
  const missing: string[] = [];
  if (!detail) {
    missing.push(`${label}: structured specification`);
    return missing;
  }
  if (!(finiteNumber(detail.lengthM, 0) > 0)) missing.push(`${label}: length`);
  if (!(finiteNumber(detail.runs, 0) > 0)) missing.push(`${label}: runs`);
  if (!detail.phase) missing.push(`${label}: phase`);
  if (!detail.conductor) missing.push(`${label}: conductor`);
  if (!detail.cores) missing.push(`${label}: cores`);
  if (detail.cores === "custom" && !trimmed(detail.customCores)) missing.push(`${label}: custom cores`);
  if (!detail.areaMm2) missing.push(`${label}: area mm²`);
  if (detail.areaMm2 === "custom" && !trimmed(detail.customArea)) missing.push(`${label}: custom area`);
  if (!detail.construction) missing.push(`${label}: construction`);
  if (detail.construction === "custom" && !trimmed(detail.customConstruction)) missing.push(`${label}: custom construction`);
  if (!detail.voltageRating) missing.push(`${label}: voltage rating`);
  if (detail.voltageRating === "custom" && !trimmed(detail.customVoltage)) missing.push(`${label}: custom voltage`);
  if (nonNegativeFinite(detail.ratePerMeter) == null) missing.push(`${label}: rate`);
  return missing;
}

function earthRunMissing(scope: ProjectScopeState, id: string, required: boolean): string[] {
  const line = includedLine(scope, id);
  const label = line?.name || id;
  if (!line) return required ? [`${label} must be included`] : [];
  const detail: EarthingConductorDetail | undefined = scope.earthConductors?.[id];
  const missing: string[] = [];
  if (!detail) {
    missing.push(`${label}: structured specification`);
    return missing;
  }
  if (!(finiteNumber(detail.lengthM, 0) > 0)) missing.push(`${label}: length`);
  if (!detail.conductorType) missing.push(`${label}: conductor type`);
  if (detail.conductorType === "custom" && !trimmed(detail.customType)) missing.push(`${label}: custom conductor type`);
  if (!trimmed(detail.areaMm2) && !trimmed(detail.stripSize)) missing.push(`${label}: size (area mm² or strip size)`);
  if (nonNegativeFinite(detail.ratePerMeter) == null) missing.push(`${label}: rate`);
  return missing;
}

export function dcScheduleComplete(scope: ProjectScopeState): ScheduleCompleteness {
  const missing: string[] = [...dcRunMissing(scope, "dc_pos", true), ...dcRunMissing(scope, "dc_neg", true)];
  for (const id of ["dc_string_combiner", "dc_combiner_inverter", "dc_string_inverter"] as const) {
    if (includedLine(scope, id)) missing.push(...dcRunMissing(scope, id, false));
  }
  return { complete: missing.length === 0, missing };
}

export function acScheduleComplete(scope: ProjectScopeState): ScheduleCompleteness {
  const missing = [...acRunMissing(scope, "ac_inv_db", true)];
  for (const id of ["ac_db_lt", "ac_lt_grid", "ac_backup"] as const) {
    if (includedLine(scope, id)) missing.push(...acRunMissing(scope, id, false));
  }
  return { complete: missing.length === 0, missing };
}

export function earthScheduleComplete(scope: ProjectScopeState): ScheduleCompleteness {
  const missing = [...earthRunMissing(scope, "earth_pv", true), ...earthRunMissing(scope, "earth_inv", true)];
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
