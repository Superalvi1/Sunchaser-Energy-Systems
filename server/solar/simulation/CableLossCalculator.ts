/**
 * Cable I²R energy loss over a year (deterministic).
 */

import { round4 } from "./SolarSimulationModels.ts";
import { cableResistanceOhm } from "./VoltageDropCalculator.ts";

export interface CableLossInput {
  currentA: number;
  lengthM: number;
  crossSectionMm2: number;
  operatingHoursPerYear: number;
  roundTrip?: boolean;
}

export function computeCablePowerLossKw(input: CableLossInput): number {
  const r = cableResistanceOhm(input.lengthM, input.crossSectionMm2, input.roundTrip ?? true);
  const lossW = input.currentA * input.currentA * r;
  return round4(lossW / 1000);
}

export function computeCableEnergyLossKwhYear(input: CableLossInput): number {
  const lossKw = computeCablePowerLossKw(input);
  return round4(lossKw * input.operatingHoursPerYear);
}

export interface SystemCableLossInput {
  dcCurrentA: number;
  acCurrentA: number;
  dcCableLengthM: number;
  acCableLengthM: number;
  dcCableMm2: number;
  acCableMm2: number;
  equivalentFullLoadHours: number;
}

export function computeSystemCableLossKwhYear(input: SystemCableLossInput): number {
  const dc = computeCableEnergyLossKwhYear({
    currentA: input.dcCurrentA,
    lengthM: input.dcCableLengthM,
    crossSectionMm2: input.dcCableMm2,
    operatingHoursPerYear: input.equivalentFullLoadHours,
    roundTrip: true,
  });
  const ac = computeCableEnergyLossKwhYear({
    currentA: input.acCurrentA,
    lengthM: input.acCableLengthM,
    crossSectionMm2: input.acCableMm2,
    operatingHoursPerYear: input.equivalentFullLoadHours,
    roundTrip: false,
  });
  return round4(dc + ac);
}
