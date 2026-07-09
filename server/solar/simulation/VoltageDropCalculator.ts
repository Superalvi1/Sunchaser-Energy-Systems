/**
 * DC and AC cable voltage drop (ohmic, deterministic).
 */

import { round4 } from "./SolarSimulationModels.ts";

/** Copper resistivity at ~20°C: Ω·mm²/m */
const COPPER_RESISTIVITY_OHM_MM2_M = 0.0175;

export interface VoltageDropInput {
  currentA: number;
  lengthM: number;
  crossSectionMm2: number;
  nominalVoltageV: number;
  /** Round-trip for DC (true) or one-way for AC (false). */
  roundTrip?: boolean;
}

export interface VoltageDropResult {
  voltageDropV: number;
  voltageDropPct: number;
}

export function cableResistanceOhm(lengthM: number, crossSectionMm2: number, roundTrip: boolean): number {
  if (lengthM <= 0 || crossSectionMm2 <= 0) return 0;
  const mult = roundTrip ? 2 : 1;
  return (COPPER_RESISTIVITY_OHM_MM2_M * lengthM * mult) / crossSectionMm2;
}

export function computeVoltageDrop(input: VoltageDropInput): VoltageDropResult {
  const r = cableResistanceOhm(input.lengthM, input.crossSectionMm2, input.roundTrip ?? true);
  const dropV = round4(Math.max(0, input.currentA * r));
  const pct = input.nominalVoltageV > 0 ? round4((dropV / input.nominalVoltageV) * 100) : 0;
  return { voltageDropV: dropV, voltageDropPct: pct };
}

export interface DcAcVoltageDropInput {
  dcCurrentA: number;
  acCurrentA: number;
  dcCableLengthM: number;
  acCableLengthM: number;
  dcCableMm2: number;
  acCableMm2: number;
  dcStringVoltageV: number;
  acNominalVoltageV?: number;
}

export interface DcAcVoltageDropResult {
  dcVoltageDropV: number;
  dcVoltageDropPct: number;
  acVoltageDropV: number;
  acVoltageDropPct: number;
}

export function computeDcAcVoltageDrop(input: DcAcVoltageDropInput): DcAcVoltageDropResult {
  const acV = input.acNominalVoltageV ?? 230;
  const dc = computeVoltageDrop({
    currentA: input.dcCurrentA,
    lengthM: input.dcCableLengthM,
    crossSectionMm2: input.dcCableMm2,
    nominalVoltageV: input.dcStringVoltageV,
    roundTrip: true,
  });
  const ac = computeVoltageDrop({
    currentA: input.acCurrentA,
    lengthM: input.acCableLengthM,
    crossSectionMm2: input.acCableMm2,
    nominalVoltageV: acV,
    roundTrip: false,
  });
  return {
    dcVoltageDropV: dc.voltageDropV,
    dcVoltageDropPct: dc.voltageDropPct,
    acVoltageDropV: ac.voltageDropV,
    acVoltageDropPct: ac.voltageDropPct,
  };
}
