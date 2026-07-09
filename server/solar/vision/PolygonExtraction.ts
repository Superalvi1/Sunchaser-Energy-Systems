/**
 * Polygon extraction — converts coarse segmentation contours into clean,
 * editable CAD polygons.
 *
 * All heavy geometry math is DELEGATED to the existing Roof Geometry Engine
 * (RoofPolygon.ts): bounds, area, point-to-segment distance, finite filtering,
 * and boundary validation. The only vision-specific step here is deterministic
 * Douglas–Peucker simplification, which composes the engine's
 * distancePointToSegment rather than re-deriving it.
 */

import {
  distancePointToSegment,
  filterFiniteVertices,
  polygonArea,
  polygonBounds,
} from "../roof/RoofPolygon.ts";
import { validateBoundaryVertices } from "../roof/RoofValidation.ts";
import type { Point2D } from "../roof/RoofModels.ts";
import {
  clampUnit,
  polygonKindFromLabel,
  round4,
  VisionPipelineError,
  type ExtractedPolygon,
  type SegmentationRegion,
} from "./VisionModels.ts";

export interface PolygonExtractionOptions {
  /** Douglas–Peucker tolerance in pixels. Default 2. */
  simplifyTolerancePx?: number;
  /** Minimum polygon area (px²) to keep. Filters specks. Default 1. */
  minAreaPx2?: number;
}

/**
 * Deterministic Douglas–Peucker. Reuses distancePointToSegment from the geometry
 * engine. Returns the simplified open vertex list (no duplicated closing point).
 */
export function simplifyContour(vertices: Point2D[], tolerancePx: number): Point2D[] {
  const pts = filterFiniteVertices(vertices);
  if (pts.length <= 2 || tolerancePx <= 0) return pts;

  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;

  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distancePointToSegment(pts[i], pts[start], pts[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }
    if (maxDist > tolerancePx && maxIndex !== -1) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex]);
      stack.push([maxIndex, end]);
    }
  }

  return pts.filter((_, i) => keep[i]);
}

/**
 * Extract one editable polygon from a segmentation region. Throws
 * VisionPipelineError when the region cannot yield a valid polygon.
 */
export function extractPolygonFromRegion(
  region: SegmentationRegion,
  options: PolygonExtractionOptions = {}
): ExtractedPolygon {
  const tolerance = options.simplifyTolerancePx ?? 2;
  const minArea = options.minAreaPx2 ?? 1;

  const simplified = simplifyContour(region.contourPx, tolerance);

  // Delegate structural validation to the geometry engine (min-vertex count,
  // self-intersection, zero-area) — do not re-implement those checks here.
  let validated: Point2D[];
  try {
    validated = validateBoundaryVertices(simplified, region.regionId);
  } catch (err) {
    throw new VisionPipelineError(
      "REGION_NOT_EXTRACTABLE",
      `Region ${region.regionId} did not yield a valid polygon: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const bounds = polygonBounds(validated);
  const area = polygonArea(validated);
  if (!bounds || area < minArea) {
    throw new VisionPipelineError("REGION_TOO_SMALL", `Region ${region.regionId} is below the minimum area threshold.`);
  }

  return {
    polygonId: `${region.regionId}-poly`,
    regionId: region.regionId,
    kind: polygonKindFromLabel(region.label),
    verticesPx: validated,
    confidence: clampUnit(round4(region.confidence)),
    label: region.label,
    boundsPx: bounds,
    areaPx2: round4(area),
  };
}

/**
 * Extract all polygons from a segmentation result. Regions that cannot yield a
 * valid polygon are skipped and reported via the `skipped` list, so a single
 * bad region never fails the whole extraction (supports concave/irregular
 * roofs where some model regions are noise). Deterministic ordering by regionId.
 */
export interface PolygonExtractionResult {
  polygons: ExtractedPolygon[];
  skipped: { regionId: string; reason: string }[];
}

export function extractPolygons(
  regions: SegmentationRegion[],
  options: PolygonExtractionOptions = {}
): PolygonExtractionResult {
  const ordered = [...regions].sort((a, b) => a.regionId.localeCompare(b.regionId));
  const polygons: ExtractedPolygon[] = [];
  const skipped: { regionId: string; reason: string }[] = [];

  for (const region of ordered) {
    try {
      polygons.push(extractPolygonFromRegion(region, options));
    } catch (err) {
      skipped.push({
        regionId: region.regionId,
        reason: err instanceof VisionPipelineError ? err.code : "UNKNOWN",
      });
    }
  }

  return { polygons, skipped };
}
