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

/** Auto-label roof boundary segments (layout-report style) when scale is calibrated. */
export function planeBoundarySegmentDimensions(
  boundary: Point2D[],
  planeName: string
): Array<Omit<DimensionAnnotation, "id"> & { segmentIndex: number }> {
  if (boundary.length < 3) return [];
  const segments: Array<Omit<DimensionAnnotation, "id"> & { segmentIndex: number }> = [];
  for (let i = 0; i < boundary.length; i += 1) {
    const j = (i + 1) % boundary.length;
    segments.push({
      segmentIndex: i,
      start: { ...boundary[i] },
      end: { ...boundary[j] },
      labelOverride: `${planeName} edge ${i + 1}`,
    });
  }
  return segments;
}

export function mergeSegmentDimensions(
  existing: DimensionAnnotation[],
  segments: Array<Omit<DimensionAnnotation, "id"> & { segmentIndex: number }>
): DimensionAnnotation[] {
  return [
    ...existing,
    ...segments.map((s) => ({
      id: nextStudioId("dim"),
      start: s.start,
      end: s.end,
      labelOverride: s.labelOverride,
    })),
  ];
}
