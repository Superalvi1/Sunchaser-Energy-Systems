/**
 * Deterministic design rules for panel count, cable distance, and complexity.
 */

import type { EquipmentTier, StructureType, SupportedSystemSizeKw, SystemType } from "./SolarProposalModels.ts";

export const DEFAULT_PANEL_WATTAGE = 580;

export function panelCountForSystem(sizeKw: SupportedSystemSizeKw, panelWattage = DEFAULT_PANEL_WATTAGE): number {
  const raw = Math.ceil((sizeKw * 1000) / panelWattage);
  return Math.max(1, raw);
}

export function dcCableDistanceMeters(sizeKw: SupportedSystemSizeKw): number {
  return sizeKw * 15 + 40;
}

export function acCableDistanceMeters(sizeKw: SupportedSystemSizeKw): number {
  return Math.max(12, Math.round(sizeKw * 2.5 + 8));
}

export function earthWireMeters(sizeKw: SupportedSystemSizeKw): number {
  return Math.max(20, sizeKw * 4 + 12);
}

export function complexityMultiplier(
  systemType: SystemType,
  structureType: StructureType,
  siteComplexityScore = 0
): number {
  let m = 1;
  if (systemType === "hybrid") m += 0.08;
  if (systemType === "off-grid") m += 0.15;
  if (structureType === "elevated_hbeam") m += 0.12;
  const score = Math.max(0, Math.min(10, siteComplexityScore));
  m += score * 0.02;
  return Math.round((m + Number.EPSILON) * 1000) / 1000;
}

export function requiresBattery(systemType: SystemType): boolean {
  return systemType === "hybrid" || systemType === "off-grid";
}

export function requiresNetMetering(systemType: SystemType, sizeKw: SupportedSystemSizeKw, explicit?: boolean): boolean {
  if (systemType !== "on-grid") return false;
  if (explicit === false) return false;
  return sizeKw > 3;
}

export function structureLabel(structureType: StructureType): string {
  return structureType === "elevated_hbeam"
    ? "Elevated H-Beam / C-Channel Structure"
    : "Standard Roof Mounting Structure";
}

export function tierLabel(tier: EquipmentTier): string {
  return tier === "premium" ? "Premium" : "Budget";
}

export function systemTypeLabel(systemType: SystemType): string {
  if (systemType === "on-grid") return "On-Grid";
  if (systemType === "hybrid") return "Hybrid";
  return "Off-Grid";
}
