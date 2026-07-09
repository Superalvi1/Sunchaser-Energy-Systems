/**
 * Financial yield — tariff offset, savings, simple payback.
 */

import { LAHORE_DEFAULTS, round2, round4, type FinancialSummary } from "./SolarSimulationModels.ts";

export interface FinancialYieldInput {
  monthlyAcKwh: number[];
  electricityTariffPkrPerKwh?: number;
  systemCapexPkr?: number;
  selfConsumptionFraction?: number;
}

export function computeFinancialYield(input: FinancialYieldInput): FinancialSummary {
  const tariff = input.electricityTariffPkrPerKwh ?? LAHORE_DEFAULTS.electricityTariffPkrPerKwh;
  const selfFrac = input.selfConsumptionFraction ?? 0.85;
  const frac = Math.max(0, Math.min(1, selfFrac));

  const monthlyBillOffsetPkr = input.monthlyAcKwh.map((kwh) =>
    round2(Math.max(0, kwh) * tariff * frac)
  );
  const yearlySavingsPkr = round2(monthlyBillOffsetPkr.reduce((s, v) => s + v, 0));

  let simplePaybackYears: number | null = null;
  if (input.systemCapexPkr !== undefined && input.systemCapexPkr > 0 && yearlySavingsPkr > 0) {
    simplePaybackYears = round4(input.systemCapexPkr / yearlySavingsPkr);
  }

  return {
    tariffPkrPerKwh: tariff,
    monthlyBillOffsetPkr,
    yearlySavingsPkr,
    simplePaybackYears,
    selfConsumptionFraction: frac,
  };
}
