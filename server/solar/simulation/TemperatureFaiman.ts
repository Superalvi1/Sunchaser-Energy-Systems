/**
 * Faiman cell temperature model.
 * T_cell = T_amb + POA / (U0 + U1 * wind)
 */

import { HOURS_PER_YEAR, round4, safeFinite } from "./SolarSimulationModels.ts";

export const FAIMAN_U0 = 25;
export const FAIMAN_U1 = 6.84;

export function faimanCellTempC(poaWm2: number, ambientTempC: number, windSpeedMs: number): number {
  const u0 = FAIMAN_U0;
  const u1 = FAIMAN_U1;
  const wind = Math.max(0, windSpeedMs);
  const t = ambientTempC + safeFinite(poaWm2) / (u0 + u1 * wind);
  return round4(Math.max(-40, Math.min(90, t)));
}

export function buildCellTempSeries8760(
  poaWm2: Float64Array,
  ambientTempC: Float64Array,
  windSpeedMs: Float64Array
): Float64Array {
  const cell = new Float64Array(HOURS_PER_YEAR);
  for (let h = 0; h < HOURS_PER_YEAR; h += 1) {
    cell[h] = faimanCellTempC(poaWm2[h], ambientTempC[h], windSpeedMs[h]);
  }
  return cell;
}

export function temperatureDerateFactor(cellTempC: number, tempCoeffPmaxPctPerC: number): number {
  const f = 1 + (tempCoeffPmaxPctPerC / 100) * (cellTempC - 25);
  return round4(Math.max(0.5, Math.min(1.05, f)));
}

export function assertCellTempReasonable(cellTempC: Float64Array): boolean {
  for (let i = 0; i < cellTempC.length; i += 1) {
    if (!Number.isFinite(cellTempC[i]) || cellTempC[i] < -40 || cellTempC[i] > 90) return false;
  }
  return true;
}
