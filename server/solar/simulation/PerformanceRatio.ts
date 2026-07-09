/**
 * Performance ratio (PR) and specific yield.
 */

import { round4 } from "./SolarSimulationModels.ts";

export interface PerformanceRatioInput {
  acEnergyKwh: number;
  arrayDcKw: number;
  referencePoaKwhM2Year: number;
}

export interface PerformanceRatioResult {
  performanceRatio: number;
  referenceYieldKwhPerKwp: number;
  specificYieldKwhPerKwp: number;
}

export function computePerformanceRatio(input: PerformanceRatioInput): PerformanceRatioResult {
  const referenceYield = input.arrayDcKw * input.referencePoaKwhM2Year;
  const pr = referenceYield > 0 ? input.acEnergyKwh / referenceYield : 0;
  const specific = input.arrayDcKw > 0 ? input.acEnergyKwh / input.arrayDcKw : 0;
  return {
    performanceRatio: round4(Math.max(0, Math.min(1.2, pr))),
    referenceYieldKwhPerKwp: round4(referenceYield),
    specificYieldKwhPerKwp: round4(specific),
  };
}

export function sumReferencePoaYear(dailyPoaKwhM2: number[], daysPerMonth: number[]): number {
  let sum = 0;
  for (let m = 0; m < 12; m += 1) {
    sum += dailyPoaKwhM2[m] * daysPerMonth[m];
  }
  return round4(sum);
}
