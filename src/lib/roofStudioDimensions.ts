/**
 * Roof Studio dimension annotations — CAD-style labeled dimensions.
 */

import type { Point2D } from "../../server/solar/roof/RoofModels.ts";
import { formatDualUnits } from "./roofStudioCalibration.ts";
import { measureDistanceM } from "./roofStudioClient.ts";
import { nextStudioId } from "./roofStudioClient.ts";

export interface DimensionAnnotation {
  id: string;
  start: Point2D;
  end: Point2D;
  /** Manual label override; when set, displayed instead of computed distance */
  labelOverride?: string;
}

export function addDimension(
  dimensions: DimensionAnnotation[],
  start: Point2D,
  end: Point2D
): DimensionAnnotation[] {
  return [...dimensions, { id: nextStudioId("dim"), start: { ...start }, end: { ...end } }];
}

export function updateDimensionLabel(
  dimensions: DimensionAnnotation[],
  id: string,
  labelOverride: string
): DimensionAnnotation[] {
  return dimensions.map((d) => (d.id === id ? { ...d, labelOverride: labelOverride || undefined } : d));
}

export function removeDimension(dimensions: DimensionAnnotation[], id: string): DimensionAnnotation[] {
  return dimensions.filter((d) => d.id !== id);
}

export function dimensionLengthM(dim: DimensionAnnotation, metersPerUnit: number): number {
  return measureDistanceM(dim.start, dim.end, metersPerUnit);
}

export function dimensionLabel(dim: DimensionAnnotation, metersPerUnit: number): string {
  if (dim.labelOverride?.trim()) return dim.labelOverride.trim();
  const m = dimensionLengthM(dim, metersPerUnit);
  return formatDualUnits(m);
}
