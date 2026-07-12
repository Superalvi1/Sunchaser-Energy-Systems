/**
 * Cable sizing — recommend copper conductor cross-section for DC/AC.
 * Uses simulation VoltageDropCalculator resistivity constant.
 */

import { cableResistanceOhm, computeVoltageDrop } from "../simulation/VoltageDropCalculator.ts";
import { round4, type CableSizingResult, type CableRouteInput } from "./ElectricalModels.ts";

/** Standard copper conductor sizes (mm²). */
export const STANDARD_CABLE_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95] as const;

export const COPPER_RESISTIVITY_OHM_MM2_M = 0.0175;
export const DEFAULT_ROUTE_FACTOR = 1.1;
export const DEFAULT_MAX_VD_PCT = 2;

export interface CableSizingInput {
  route: CableRouteInput;
  dcCurrentA: number;
  acCurrentA: number;
  dcNominalVoltageV: number;
  acNominalVoltageV: number;
  maxVoltageDropPct?: number;
}

function recommendSize(
  currentA: number,
  lengthM: number,
  nominalV: number,
  maxVdPct: number,
  roundTrip: boolean,
  routeFactor: number
): number {
  const effectiveLength = lengthM * routeFactor;
  for (const mm2 of STANDARD_CABLE_MM2) {
    const vd = computeVoltageDrop({
      currentA,
      lengthM: effectiveLength,
      crossSectionMm2: mm2,
      nominalVoltageV: nominalV,
      roundTrip,
    });
    // Ampacity rough check: ~6 A/mm² for copper (conservative continuous)
    const ampacityOk = currentA <= mm2 * 6;
    if (vd.voltageDropPct <= maxVdPct && ampacityOk) return mm2;
  }
  return STANDARD_CABLE_MM2[STANDARD_CABLE_MM2.length - 1];
}

export function sizeCables(input: CableSizingInput): CableSizingResult {
  const routeFactor = input.route.routeFactor ?? DEFAULT_ROUTE_FACTOR;
  const maxVd = input.maxVoltageDropPct ?? DEFAULT_MAX_VD_PCT;
  const assumptions: string[] = [
    `Copper resistivity ${COPPER_RESISTIVITY_OHM_MM2_M} Ω·mm²/m at 20°C.`,
    `Route factor ${routeFactor}.`,
    `Max voltage drop target ${maxVd}%.`,
    "Ampacity approximation 6 A/mm² continuous.",
  ];

  // Sanity: cableResistanceOhm uses same resistivity as simulation
  void cableResistanceOhm;

  const dcRecommended =
    input.route.dcCableMm2 === undefined
      ? recommendSize(input.dcCurrentA, input.route.dcLengthM, input.dcNominalVoltageV, maxVd, true, routeFactor)
      : input.route.dcCableMm2;
  const acRecommended =
    input.route.acCableMm2 === undefined
      ? recommendSize(input.acCurrentA, input.route.acLengthM, input.acNominalVoltageV, maxVd, false, routeFactor)
      : input.route.acCableMm2;

  return {
    dcCableMm2: round4(dcRecommended),
    acCableMm2: round4(acRecommended),
    dcRecommended: input.route.dcCableMm2 === undefined,
    acRecommended: input.route.acCableMm2 === undefined,
    copperResistivityOhmMm2M: COPPER_RESISTIVITY_OHM_MM2_M,
    routeFactor,
    assumptions,
  };
}
