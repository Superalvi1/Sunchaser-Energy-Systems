/**
 * HDKR transposition model — GHI/DNI/DHI to plane-of-array irradiance (W/m²).
 * Assumption documented: HDKR (not Perez) for V1 deterministic pipeline.
 */

import { HOURS_PER_YEAR, round4, safeFinite } from "./SolarSimulationModels.ts";
import { cosIncidenceAngle, type SunPositionHour } from "./SunPositionPSA.ts";

export const TRANSPOSITION_MODEL = "HDKR" as const;

export interface TranspositionInput {
  ghiWm2: Float64Array;
  dniWm2: Float64Array;
  dhiWm2: Float64Array;
  sunPositions: SunPositionHour[];
  tiltDeg: number;
  azimuthDeg: number;
  albedo: number;
  shadingFactor?: number;
}

export function hdkrPoaWm2(
  ghi: number,
  dni: number,
  dhi: number,
  cosTheta: number,
  zenithDeg: number,
  tiltDeg: number,
  albedo: number
): number {
  if (ghi <= 0 || cosTheta <= 0) return 0;
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const zenRad = (zenithDeg * Math.PI) / 180;
  const cosZen = Math.max(0, Math.cos(zenRad));

  const beam = dni * Math.max(0, cosTheta);
  const f = Math.max(0, Math.min(1, (dhi / Math.max(ghi, 1e-6)) ** 2));
  const diffuseSky = dhi * ((1 + Math.cos(tiltRad)) / 2) * (1 + f * (Math.sin(tiltRad / 2) ** 3));
  const ground = ghi * albedo * ((1 - Math.cos(tiltRad)) / 2);
  return Math.max(0, beam + diffuseSky + ground);
}

export function buildPoaSeries8760(input: TranspositionInput): Float64Array {
  const poa = new Float64Array(HOURS_PER_YEAR);
  const shade = input.shadingFactor ?? 1;
  for (let h = 0; h < HOURS_PER_YEAR; h += 1) {
    const sun = input.sunPositions[h];
    const cosT = cosIncidenceAngle(sun.zenithDeg, sun.azimuthDeg, input.tiltDeg, input.azimuthDeg);
    const val = hdkrPoaWm2(
      input.ghiWm2[h],
      input.dniWm2[h],
      input.dhiWm2[h],
      cosT,
      sun.zenithDeg,
      input.tiltDeg,
      input.albedo
    );
    poa[h] = safeFinite(val * shade);
  }
  return poa;
}

export function assertIrradianceNonNegative(poa: Float64Array): boolean {
  for (let i = 0; i < poa.length; i += 1) {
    if (poa[i] < 0 || !Number.isFinite(poa[i])) return false;
  }
  return true;
}

export function annualPoaKwhM2(poaWm2: Float64Array): number {
  let wh = 0;
  for (let i = 0; i < poaWm2.length; i += 1) wh += poaWm2[i];
  return round4(wh / 1000);
}
