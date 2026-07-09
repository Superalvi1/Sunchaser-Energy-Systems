/**
 * PVWatts-style module DC power model.
 * P_dc = P_dc0 * (POA/1000) * f_temp
 */

import { DEFAULT_MODULE_580W, HOURS_PER_YEAR, round4, safeFinite, type ModuleInput } from "./SolarSimulationModels.ts";
import { temperatureDerateFactor } from "./TemperatureFaiman.ts";

export interface NormalizedModule {
  wattageW: number;
  vocStcV: number;
  vmpStcV: number;
  iscStcA: number;
  impStcA: number;
  tempCoeffPmaxPctPerC: number;
  tempCoeffVocPctPerC: number;
}

export function normalizeModule(input?: ModuleInput): NormalizedModule {
  return {
    wattageW: input?.wattageW ?? DEFAULT_MODULE_580W.wattageW,
    vocStcV: input?.vocStcV ?? DEFAULT_MODULE_580W.vocStcV,
    vmpStcV: input?.vmpStcV ?? DEFAULT_MODULE_580W.vmpStcV,
    iscStcA: input?.iscStcA ?? DEFAULT_MODULE_580W.iscStcA,
    impStcA: input?.impStcA ?? DEFAULT_MODULE_580W.impStcA,
    tempCoeffPmaxPctPerC: input?.tempCoeffPmaxPctPerC ?? DEFAULT_MODULE_580W.tempCoeffPmaxPctPerC,
    tempCoeffVocPctPerC: input?.tempCoeffVocPctPerC ?? DEFAULT_MODULE_580W.tempCoeffVocPctPerC,
  };
}

export function moduleDcPowerW(poaWm2: number, wattageW: number, cellTempC: number, tempCoeffPmaxPctPerC: number): number {
  const irr = Math.max(0, poaWm2) / 1000;
  const fTemp = temperatureDerateFactor(cellTempC, tempCoeffPmaxPctPerC);
  return round4(Math.max(0, wattageW * irr * fTemp));
}

export function voltageAtTemp(stcV: number, tempCoeffPctPerC: number, cellTempC: number): number {
  const f = 1 + (tempCoeffPctPerC / 100) * (cellTempC - 25);
  return round4(stcV * f);
}

export interface ArrayDcSeriesResult {
  dcPowerW: Float64Array;
  idealDcPowerW: Float64Array;
  tempLossW: Float64Array;
}

export function buildArrayDcSeries8760(
  poaWm2: Float64Array,
  cellTempC: Float64Array,
  moduleCount: number,
  module: NormalizedModule
): ArrayDcSeriesResult {
  const dcPowerW = new Float64Array(HOURS_PER_YEAR);
  const idealDcPowerW = new Float64Array(HOURS_PER_YEAR);
  const tempLossW = new Float64Array(HOURS_PER_YEAR);

  for (let h = 0; h < HOURS_PER_YEAR; h += 1) {
    const ideal = moduleCount * module.wattageW * (Math.max(0, poaWm2[h]) / 1000);
    const actual = moduleCount * moduleDcPowerW(poaWm2[h], module.wattageW, cellTempC[h], module.tempCoeffPmaxPctPerC);
    idealDcPowerW[h] = safeFinite(ideal);
    dcPowerW[h] = safeFinite(actual);
    tempLossW[h] = safeFinite(Math.max(0, ideal - actual));
  }
  return { dcPowerW, idealDcPowerW, tempLossW };
}
