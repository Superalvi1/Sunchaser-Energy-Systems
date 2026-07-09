/**
 * Inverter efficiency and AC clipping model.
 */

import {
  HOURS_PER_YEAR,
  round4,
  safeFinite,
  type InverterInput,
  type SimulationSystemSizeKw,
  type SimulationSystemType,
  defaultInverterForSizeKw,
} from "./SolarSimulationModels.ts";

export interface NormalizedInverter {
  acRatingKw: number;
  maxDcVoltageV: number;
  mpptMinV: number;
  mpptMaxV: number;
  efficiencyPct: number;
}

export function normalizeInverter(sizeKw: SimulationSystemSizeKw, input?: InverterInput): NormalizedInverter {
  const d = defaultInverterForSizeKw(sizeKw);
  return {
    acRatingKw: input?.acRatingKw ?? d.acRatingKw,
    maxDcVoltageV: input?.maxDcVoltageV ?? d.maxDcVoltageV,
    mpptMinV: input?.mpptMinV ?? d.mpptMinV,
    mpptMaxV: input?.mpptMaxV ?? d.mpptMaxV,
    efficiencyPct: input?.efficiencyPct ?? d.efficiencyPct,
  };
}

export function systemAvailabilityFactor(systemType: SimulationSystemType): number {
  switch (systemType) {
    case "on-grid":
      return 1;
    case "hybrid":
      return 0.96;
    case "off-grid":
      return 0.9;
    default:
      return 1;
  }
}

export interface InverterSeriesResult {
  acPowerW: Float64Array;
  clippingLossW: Float64Array;
  availabilityLossW: Float64Array;
}

export function inverterAcPowerW(dcPowerW: number, inverter: NormalizedInverter): { acW: number; clipW: number } {
  const eta = inverter.efficiencyPct / 100;
  const theoreticalAcKw = (dcPowerW / 1000) * eta;
  const acKw = Math.min(inverter.acRatingKw, theoreticalAcKw);
  const clipKw = Math.max(0, theoreticalAcKw - acKw);
  return { acW: round4(acKw * 1000), clipW: round4(clipKw * 1000) };
}

export function buildAcSeries8760(
  dcPowerW: Float64Array,
  inverter: NormalizedInverter,
  systemType: SimulationSystemType
): InverterSeriesResult {
  const acPowerW = new Float64Array(HOURS_PER_YEAR);
  const clippingLossW = new Float64Array(HOURS_PER_YEAR);
  const availabilityLossW = new Float64Array(HOURS_PER_YEAR);
  const avail = systemAvailabilityFactor(systemType);

  for (let h = 0; h < HOURS_PER_YEAR; h += 1) {
    const { acW, clipW } = inverterAcPowerW(dcPowerW[h], inverter);
    const afterAvail = acW * avail;
    availabilityLossW[h] = safeFinite(acW - afterAvail);
    acPowerW[h] = safeFinite(afterAvail);
    clippingLossW[h] = safeFinite(clipW);
  }
  return { acPowerW, clippingLossW, availabilityLossW };
}

export function assertNoNanInfinity(arr: Float64Array): boolean {
  for (let i = 0; i < arr.length; i += 1) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}
