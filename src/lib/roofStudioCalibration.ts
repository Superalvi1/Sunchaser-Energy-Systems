/**
 * Roof Studio scale calibration — Google Earth ruler style.
 * User draws a line and enters a known real-world distance. No guessing.
 */

import type { Point2D } from "../../server/solar/roof/RoofModels.ts";
import { segmentLength } from "../../server/solar/roof/RoofMeasurement.ts";

export interface ScaleCalibration {
  calibrated: boolean;
  lineStart: Point2D;
  lineEnd: Point2D;
  realLengthM: number;
  /** Original user input string, e.g. "51 ft 9 in" */
  inputLabel: string;
}

const FT_TO_M = 0.3048;
const IN_TO_M = 0.0254;

/** Parse real-world distance strings: "15 m", "51 ft 9 in", "51'9\"", "15.77m". */
export function parseRealWorldDistance(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;

  const normalized = raw
    .toLowerCase()
    .replace(/″|"/g, " in")
    .replace(/′|'/g, " ft ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Pure meters
  const mMatch = normalized.match(/^(-?\d+(?:\.\d+)?)\s*(?:m|meter|meters|metre|metres)$/);
  if (mMatch) {
    const v = Number(mMatch[1]);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  // Feet + optional inches: "51 ft 9 in", "51 ft", "51ft9in"
  const ftInMatch = normalized.match(/^(-?\d+(?:\.\d+)?)\s*ft(?:\s*(-?\d+(?:\.\d+)?)\s*in)?$/);
  if (ftInMatch) {
    const ft = Number(ftInMatch[1]);
    const inches = ftInMatch[2] !== undefined ? Number(ftInMatch[2]) : 0;
    if (!Number.isFinite(ft) || ft < 0 || !Number.isFinite(inches) || inches < 0) return null;
    const totalM = ft * FT_TO_M + inches * IN_TO_M;
    return totalM > 0 ? totalM : null;
  }

  // Bare number — assume meters
  const bare = Number(normalized);
  if (Number.isFinite(bare) && bare > 0) return bare;

  return null;
}

export function metersPerUnitFromCalibration(lineStart: Point2D, lineEnd: Point2D, realLengthM: number): number {
  const units = segmentLength(lineStart, lineEnd);
  if (!Number.isFinite(units) || units <= 0) return 0;
  if (!Number.isFinite(realLengthM) || realLengthM <= 0) return 0;
  return realLengthM / units;
}

export function applyScaleCalibration(
  lineStart: Point2D,
  lineEnd: Point2D,
  distanceInput: string
): { calibration: ScaleCalibration; metersPerUnit: number } | null {
  const realLengthM = parseRealWorldDistance(distanceInput);
  if (!realLengthM) return null;
  const metersPerUnit = metersPerUnitFromCalibration(lineStart, lineEnd, realLengthM);
  if (metersPerUnit <= 0) return null;
  return {
    calibration: {
      calibrated: true,
      lineStart: { ...lineStart },
      lineEnd: { ...lineEnd },
      realLengthM,
      inputLabel: distanceInput.trim(),
    },
    metersPerUnit,
  };
}

export function isScaleCalibrated(
  calibration: ScaleCalibration | null | undefined,
  metersPerUnit: number
): boolean {
  try {
    requireValidScale(metersPerUnit);
    return Boolean(calibration?.calibrated);
  } catch {
    return false;
  }
}

export class RoofCalibrationError extends Error {
  readonly code = "SCALE_NOT_CALIBRATED" as const;
  constructor(message = "Scale not calibrated") {
    super(message);
    this.name = "RoofCalibrationError";
  }
}

/** Fail-closed: no default/fallback scale. Throws when metersPerUnit is not a positive finite number. */
export function requireValidScale(metersPerUnit: number): number {
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) {
    throw new RoofCalibrationError("Scale not calibrated");
  }
  return metersPerUnit;
}

export function isValidScale(metersPerUnit: number): boolean {
  return Number.isFinite(metersPerUnit) && metersPerUnit > 0;
}

const M_TO_FT = 1 / FT_TO_M;

export function formatMeters(meters: number, digits = 2): string {
  if (!Number.isFinite(meters)) return "—";
  return `${meters.toFixed(digits)} m`;
}

export function formatFeetInches(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  const totalInches = meters / IN_TO_M;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return `${feet} ft ${inches} in`;
}

export function formatDualUnits(meters: number): string {
  return `${formatFeetInches(meters)} · ${formatMeters(meters)}`;
}
