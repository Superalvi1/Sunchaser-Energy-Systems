/**
 * Ridge, valley, and site measurement conversions.
 */

import type { Point2D, RidgeDef, ValleyDef } from "./RoofModels.ts";
import { finiteNum, isFinitePoint, round4 } from "./RoofModels.ts";
import { distancePointToSegment, polygonArea, polygonPerimeter, scalePolygonAreaToM2 } from "./RoofPolygon.ts";

export interface NormalizedRidge {
  id: string;
  start: Point2D;
  end: Point2D;
  lengthUnits: number;
}

export interface NormalizedValley {
  id: string;
  start: Point2D;
  end: Point2D;
  lengthUnits: number;
}

export function segmentLength(a: Point2D, b: Point2D): number {
  if (!isFinitePoint(a) || !isFinitePoint(b)) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Interior angle (degrees) at `vertex` formed by rays to `a` and `b`.
 * Canonical measurement primitive — the CAD studio's angle tool delegates here.
 */
export function angleBetweenPointsDeg(a: Point2D, vertex: Point2D, b: Point2D): number {
  if (!isFinitePoint(a) || !isFinitePoint(vertex) || !isFinitePoint(b)) return 0;
  const v1x = a.x - vertex.x;
  const v1y = a.y - vertex.y;
  const v2x = b.x - vertex.x;
  const v2y = b.y - vertex.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return round4((Math.acos(cos) * 180) / Math.PI);
}

export function normalizeRidge(raw: RidgeDef, index: number): NormalizedRidge | null {
  if (!raw || !isFinitePoint(raw.start) || !isFinitePoint(raw.end)) return null;
  const lengthUnits = segmentLength(raw.start, raw.end);
  if (lengthUnits <= 0) return null;
  return { id: raw.id || `ridge-${index}`, start: raw.start, end: raw.end, lengthUnits };
}

export function normalizeValley(raw: ValleyDef, index: number): NormalizedValley | null {
  if (!raw || !isFinitePoint(raw.start) || !isFinitePoint(raw.end)) return null;
  const lengthUnits = segmentLength(raw.start, raw.end);
  if (lengthUnits <= 0) return null;
  return { id: raw.id || `valley-${index}`, start: raw.start, end: raw.end, lengthUnits };
}

export function normalizeRidges(raw: unknown): NormalizedRidge[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedRidge[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = normalizeRidge(raw[i] as RidgeDef, i);
    if (r) out.push(r);
  }
  return out;
}

export function normalizeValleys(raw: unknown): NormalizedValley[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedValley[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const v = normalizeValley(raw[i] as ValleyDef, i);
    if (v) out.push(v);
  }
  return out;
}

export function totalRidgeLengthUnits(ridges: NormalizedRidge[]): number {
  return ridges.reduce((s, r) => s + r.lengthUnits, 0);
}

export function totalValleyLengthUnits(valleys: NormalizedValley[]): number {
  return valleys.reduce((s, v) => s + v.lengthUnits, 0);
}

export function ridgeSetbackAreaUnits(ridges: NormalizedRidge[], setbackM: number, metersPerUnit: number): number {
  if (setbackM <= 0 || metersPerUnit <= 0) return 0;
  const halfWidth = setbackM / metersPerUnit;
  return ridges.reduce((s, r) => s + r.lengthUnits * halfWidth * 2, 0);
}

export function valleySetbackAreaUnits(valleys: NormalizedValley[], setbackM: number, metersPerUnit: number): number {
  if (setbackM <= 0 || metersPerUnit <= 0) return 0;
  const halfWidth = setbackM / metersPerUnit;
  return valleys.reduce((s, v) => s + v.lengthUnits * halfWidth * 2, 0);
}

export function distanceToRidgeM(point: Point2D, ridge: NormalizedRidge, metersPerUnit: number): number {
  if (metersPerUnit <= 0) return 0;
  return distancePointToSegment(point, ridge.start, ridge.end) * metersPerUnit;
}

export function unitsToMeters(units: number, metersPerUnit: number): number {
  return finiteNum(units, 0) * finiteNum(metersPerUnit, 1);
}

export function metersToUnits(meters: number, metersPerUnit: number): number {
  const mpu = finiteNum(metersPerUnit, 1);
  if (mpu <= 0) return 0;
  return finiteNum(meters, 0) / mpu;
}

export function planAreaM2(vertices: Point2D[], metersPerUnit: number): number {
  return scalePolygonAreaToM2(polygonArea(vertices), metersPerUnit);
}

export function perimeterM(vertices: Point2D[], metersPerUnit: number): number {
  return round4(unitsToMeters(polygonPerimeter(vertices), metersPerUnit));
}

export function lengthM(lengthUnits: number, metersPerUnit: number): number {
  return round4(unitsToMeters(lengthUnits, metersPerUnit));
}

export function areaUnitsFromM2(areaM2: number, metersPerUnit: number): number {
  const mpu = metersPerUnit > 0 ? metersPerUnit : 1;
  return areaM2 / (mpu * mpu);
}

export function panelCapacityEstimateKw(netUsableAreaM2: number, panelAreaM2 = 2.58, panelWattage = 580): number {
  if (netUsableAreaM2 <= 0 || panelAreaM2 <= 0) return 0;
  const panels = Math.floor(netUsableAreaM2 / panelAreaM2);
  return round4((panels * panelWattage) / 1000);
}
