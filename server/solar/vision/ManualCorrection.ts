/**
 * Manual correction tools — deterministic, pure editing operations on the
 * editable CAD polygons produced by extraction.
 *
 * Each operation returns a NEW polygon set (never mutates its input) so callers
 * can append the result to the version store as an immutable "manual" version.
 * Every geometric result is re-validated through the existing geometry engine
 * (validateBoundaryVertices) so a manual edit can never produce an invalid roof
 * polygon (degenerate, self-intersecting, zero-area).
 */

import { polygonArea, polygonBounds } from "../roof/RoofPolygon.ts";
import { validateBoundaryVertices } from "../roof/RoofValidation.ts";
import type { Point2D } from "../roof/RoofModels.ts";
import {
  round4,
  VisionPipelineError,
  type ExtractedPolygon,
} from "./VisionModels.ts";

function requirePolygon(polygons: ExtractedPolygon[], polygonId: string): ExtractedPolygon {
  const found = polygons.find((p) => p.polygonId === polygonId);
  if (!found) {
    throw new VisionPipelineError("POLYGON_NOT_FOUND", `Polygon ${polygonId} not found.`);
  }
  return found;
}

/** Re-derive bounds/area and re-validate a polygon after an edit. */
function rebuildPolygon(base: ExtractedPolygon, vertices: Point2D[]): ExtractedPolygon {
  let validated: Point2D[];
  try {
    validated = validateBoundaryVertices(vertices, base.polygonId);
  } catch (err) {
    throw new VisionPipelineError(
      "INVALID_EDIT",
      `Edit to ${base.polygonId} produced an invalid polygon: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const bounds = polygonBounds(validated)!;
  return {
    ...base,
    verticesPx: validated,
    boundsPx: bounds,
    areaPx2: round4(polygonArea(validated)),
    // A manually corrected polygon is asserted by the operator: full confidence.
    confidence: 1,
  };
}

function replacePolygon(polygons: ExtractedPolygon[], next: ExtractedPolygon): ExtractedPolygon[] {
  return polygons.map((p) => (p.polygonId === next.polygonId ? next : p));
}

/** Move a single vertex to a new position. */
export function moveVertex(
  polygons: ExtractedPolygon[],
  polygonId: string,
  vertexIndex: number,
  to: Point2D
): ExtractedPolygon[] {
  const target = requirePolygon(polygons, polygonId);
  if (vertexIndex < 0 || vertexIndex >= target.verticesPx.length) {
    throw new VisionPipelineError("INVALID_VERTEX_INDEX", `Vertex index ${vertexIndex} is out of range.`);
  }
  const nextVertices = target.verticesPx.map((v, i) => (i === vertexIndex ? { ...to } : { ...v }));
  return replacePolygon(polygons, rebuildPolygon(target, nextVertices));
}

/** Insert a new vertex after `afterIndex`. */
export function addVertex(
  polygons: ExtractedPolygon[],
  polygonId: string,
  afterIndex: number,
  vertex: Point2D
): ExtractedPolygon[] {
  const target = requirePolygon(polygons, polygonId);
  if (afterIndex < -1 || afterIndex >= target.verticesPx.length) {
    throw new VisionPipelineError("INVALID_VERTEX_INDEX", `Insert index ${afterIndex} is out of range.`);
  }
  const nextVertices = target.verticesPx.map((v) => ({ ...v }));
  nextVertices.splice(afterIndex + 1, 0, { ...vertex });
  return replacePolygon(polygons, rebuildPolygon(target, nextVertices));
}

/** Delete a vertex. Refuses when it would drop the polygon below 3 vertices. */
export function deleteVertex(
  polygons: ExtractedPolygon[],
  polygonId: string,
  vertexIndex: number
): ExtractedPolygon[] {
  const target = requirePolygon(polygons, polygonId);
  if (vertexIndex < 0 || vertexIndex >= target.verticesPx.length) {
    throw new VisionPipelineError("INVALID_VERTEX_INDEX", `Vertex index ${vertexIndex} is out of range.`);
  }
  if (target.verticesPx.length <= 3) {
    throw new VisionPipelineError("MIN_VERTICES", "A roof polygon must retain at least 3 vertices.");
  }
  const nextVertices = target.verticesPx.filter((_, i) => i !== vertexIndex).map((v) => ({ ...v }));
  return replacePolygon(polygons, rebuildPolygon(target, nextVertices));
}

/** Add a brand-new polygon (e.g. a roof face the model missed). */
export function addPolygon(
  polygons: ExtractedPolygon[],
  polygonId: string,
  vertices: Point2D[],
  label = "roof"
): ExtractedPolygon[] {
  if (polygons.some((p) => p.polygonId === polygonId)) {
    throw new VisionPipelineError("DUPLICATE_POLYGON_ID", `Polygon ${polygonId} already exists.`);
  }
  const base: ExtractedPolygon = {
    polygonId,
    regionId: `manual-${polygonId}`,
    kind: label.toLowerCase().includes("obstacle") ? "obstacle" : "roof",
    verticesPx: vertices,
    confidence: 1,
    label,
    boundsPx: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
    areaPx2: 0,
  };
  return [...polygons, rebuildPolygon(base, vertices)];
}

/** Delete a whole polygon (e.g. a false-positive region). */
export function deletePolygon(polygons: ExtractedPolygon[], polygonId: string): ExtractedPolygon[] {
  requirePolygon(polygons, polygonId);
  return polygons.filter((p) => p.polygonId !== polygonId);
}
