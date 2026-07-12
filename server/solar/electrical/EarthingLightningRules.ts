/**
 * Earthing and lightning protection recommendations.
 */

import type {
  EarthingLightningResult,
  ElectricalSystemType,
  ProtectionPreferences,
} from "./ElectricalModels.ts";

export interface EarthingLightningInput {
  systemType: ElectricalSystemType;
  dcCapacityKw: number;
  preferences?: ProtectionPreferences;
}

export function recommendEarthingLightning(input: EarthingLightningInput): EarthingLightningResult {
  const earthingMm2 =
    input.preferences?.earthingConductorMm2 ??
    (input.dcCapacityKw >= 10 ? 16 : input.dcCapacityKw >= 5 ? 10 : 6);

  const lightning =
    input.preferences?.requireLightningArrestor === true ||
    input.dcCapacityKw >= 8 ||
    input.systemType === "off-grid";

  const notes: string[] = [
    "Earthing electrode resistance target ≤ 5 Ω (site-dependent).",
    "Bond PV array frames, inverter PE, and AC DB earth bar.",
  ];
  if (lightning) {
    notes.push("Recommend Type 1+2 SPD at main DB and DC Type 2 at inverter.");
  }

  return {
    earthingConductorMm2: earthingMm2,
    earthingLabel: `PE conductor ${earthingMm2} mm² Cu`,
    lightningArrestorRecommended: lightning,
    lightningLabel: lightning ? "Lightning / surge arrestor recommended" : "Lightning arrestor optional",
    notes,
  };
}
