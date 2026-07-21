/**
 * Phase 3B — Intelligent Panel Layout Engine V2 orchestrator.
 *
 * Input: roof polygon + obstacles + walkways + setbacks + catalog module + orientation policy.
 * Output: exact placements, utilization, DC capacity.
 *
 * Fail closed: never silently drop non-finite vertices or invalid obstructions.
 * Reuses Roof Geometry Engine for self-intersection / area — no duplicate math.
 */

import type { Point2D } from "../roof/RoofModels.ts";
import { hasPolygonSelfIntersection, polygonArea } from "../roof/RoofPolygon.ts";
import { requireValidMetersPerUnit } from "../roof/RoofMeasurement.ts";
import { mergeSetbackConfig } from "../roof/RoofSetbackRules.ts";
import { ROOF_EPSILON, isFiniteNumber } from "../roof/RoofModels.ts";
import { validatePanelModule } from "./PanelCatalog.ts";
import { mergePanelLayoutConstraints } from "./PanelConstraints.ts";
import { solvePanelPacking, type PackingContext } from "./PanelPackingSolver.ts";
import { buildPanelLayoutReport, assertFiniteLayoutResult } from "./PanelLayoutReport.ts";
import {
  PANEL_ORIENTATION_POLICIES,
  PanelLayoutError,
  type PanelLayoutInput,
  type PanelLayoutResult,
  type PanelOrientationPolicy,
} from "./PanelLayoutModels.ts";
import { panelAabbIntersectsPanel } from "./PanelCollision.ts";

function requireFiniteCoordinate(value: unknown, path: string): number {
  if (value === null || value === undefined) {
    throw new PanelLayoutError("NON_FINITE", `${path} must be a number (got ${String(value)}).`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PanelLayoutError("NON_FINITE", `${path} must be a finite number (got ${String(value)}).`);
  }
  return value;
}

/** Strict polygon validation — never drops vertices. */
export function requireStrictPolygon(
  vertices: unknown,
  context: string,
  errorCode: "INVALID_BOUNDARY" | "INVALID_OBSTACLE" | "INVALID_WALKWAY" | "INSUFFICIENT_VERTICES" = "INVALID_BOUNDARY"
): Point2D[] {
  if (!Array.isArray(vertices)) {
    throw new PanelLayoutError(errorCode, `${context} must be an array of vertices.`);
  }
  if (vertices.length < 3) {
    throw new PanelLayoutError(
      "INSUFFICIENT_VERTICES",
      `${context} requires at least 3 vertices.`
    );
  }
  const out: Point2D[] = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const v = vertices[i];
    if (v === null || v === undefined || typeof v !== "object") {
      throw new PanelLayoutError(
        "NON_FINITE",
        `${context} vertex[${i}] must be an object with finite x and y.`
      );
    }
    const x = requireFiniteCoordinate((v as Point2D).x, `${context} vertex[${i}].x`);
    const y = requireFiniteCoordinate((v as Point2D).y, `${context} vertex[${i}].y`);
    out.push({ x, y });
  }
  return out;
}

function assertFiniteBoundary(boundary: unknown, planeId: string): Point2D[] {
  const verts = requireStrictPolygon(boundary, `Plane ${planeId} boundary`, "INVALID_BOUNDARY");
  if (hasPolygonSelfIntersection(verts)) {
    throw new PanelLayoutError(
      "SELF_INTERSECTING_ROOF",
      `Plane ${planeId} boundary self-intersects.`
    );
  }
  if (polygonArea(verts) < ROOF_EPSILON) {
    throw new PanelLayoutError("ZERO_AREA_ROOF", `Plane ${planeId} has zero area.`);
  }
  return verts;
}

function requireObstaclePolygons(raw: PanelLayoutInput["plane"]["obstacles"]): Point2D[][] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new PanelLayoutError("INVALID_OBSTACLE", "obstacles must be an array when provided.");
  }
  const out: Point2D[][] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const o = raw[i];
    if (!o || typeof o !== "object") {
      throw new PanelLayoutError("INVALID_OBSTACLE", `obstacles[${i}] must be an object.`);
    }
    const verts = requireStrictPolygon(o.polygon, `obstacles[${i}].polygon`, "INVALID_OBSTACLE");
    if (hasPolygonSelfIntersection(verts)) {
      throw new PanelLayoutError(
        "INVALID_OBSTACLE",
        `obstacles[${i}].polygon self-intersects.`
      );
    }
    if (polygonArea(verts) < ROOF_EPSILON) {
      throw new PanelLayoutError("INVALID_OBSTACLE", `obstacles[${i}].polygon has zero area.`);
    }
    out.push(verts);
  }
  return out;
}

function requireWalkwayPolygons(raw: PanelLayoutInput["plane"]["walkways"]): Point2D[][] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new PanelLayoutError("INVALID_WALKWAY", "walkways must be an array when provided.");
  }
  const out: Point2D[][] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const w = raw[i];
    if (!w || typeof w !== "object") {
      throw new PanelLayoutError("INVALID_WALKWAY", `walkways[${i}] must be an object.`);
    }
    const verts = requireStrictPolygon(w.polygon, `walkways[${i}].polygon`, "INVALID_WALKWAY");
    if (hasPolygonSelfIntersection(verts)) {
      throw new PanelLayoutError("INVALID_WALKWAY", `walkways[${i}].polygon self-intersects.`);
    }
    if (polygonArea(verts) < ROOF_EPSILON) {
      throw new PanelLayoutError("INVALID_WALKWAY", `walkways[${i}].polygon has zero area.`);
    }
    out.push(verts);
  }
  return out;
}

export function requireOrientationPolicy(policy: unknown): PanelOrientationPolicy {
  if (typeof policy !== "string" || !(PANEL_ORIENTATION_POLICIES as readonly string[]).includes(policy)) {
    throw new PanelLayoutError(
      "INVALID_ORIENTATION_POLICY",
      `orientationPolicy must be one of: ${PANEL_ORIENTATION_POLICIES.join(", ")}.`
    );
  }
  if (policy === "mixed") {
    throw new PanelLayoutError(
      "MIXED_NOT_IMPLEMENTED",
      "Mixed orientation packing is a future interface only in Phase 3B V2."
    );
  }
  return policy as PanelOrientationPolicy;
}

function assertNoPanelOverlap(result: PanelLayoutResult): void {
  const panels = result.panels;
  for (let i = 0; i < panels.length; i += 1) {
    for (let j = i + 1; j < panels.length; j += 1) {
      const a = panels[i];
      const b = panels[j];
      if (
        panelAabbIntersectsPanel(
          a.x,
          a.y,
          a.widthUnits,
          a.heightUnits,
          b.x,
          b.y,
          b.widthUnits,
          b.heightUnits
        )
      ) {
        throw new PanelLayoutError(
          "NON_FINITE",
          `Internal packing error: panels ${a.panelId} and ${b.panelId} overlap.`
        );
      }
    }
  }
}

/**
 * Run deterministic panel packing for a single roof plane.
 * All validation runs before any placement.
 */
export function layoutPanelsOnPlane(input: PanelLayoutInput): PanelLayoutResult {
  if (!input?.plane?.planeId) {
    throw new PanelLayoutError("INVALID_BOUNDARY", "plane.planeId is required.");
  }
  if (!isFiniteNumber(input.metersPerUnit) || input.metersPerUnit <= 0) {
    throw new PanelLayoutError("INVALID_METERS_PER_UNIT", "metersPerUnit must be a positive finite number.");
  }
  requireValidMetersPerUnit(input.metersPerUnit);
  validatePanelModule(input.module);

  const orientationPolicy = requireOrientationPolicy(input.orientationPolicy);
  const boundary = assertFiniteBoundary(input.plane.boundary, input.plane.planeId);
  const obstaclePolygons = requireObstaclePolygons(input.plane.obstacles);
  const walkwayPolygons = requireWalkwayPolygons(input.plane.walkways);

  const constraints = mergePanelLayoutConstraints({
    ...input.constraints,
    setbacks: { ...input.constraints?.setbacks, ...input.plane.setbacks },
  });
  const setbacks = mergeSetbackConfig(constraints.setbacks);

  const ctx: PackingContext = {
    planeId: input.plane.planeId,
    boundary,
    metersPerUnit: input.metersPerUnit,
    module: input.module,
    constraints,
    setbacks,
    obstaclePolygons,
    walkwayPolygons,
    hasParapet: false,
  };

  const warnings: string[] = [];
  let attempt;
  try {
    attempt = solvePanelPacking(ctx, orientationPolicy);
  } catch (e) {
    if (e instanceof PanelLayoutError && e.code === "NO_USABLE_AREA") {
      const empty = buildPanelLayoutReport({
        planeId: input.plane.planeId,
        moduleId: input.module.moduleId,
        orientationPolicy,
        orientationUsed: "none",
        panels: [],
        usableAreaM2: 0,
        unusedRegions: [],
        metersPerUnit: input.metersPerUnit,
        warnings: [e.message],
      });
      assertFiniteLayoutResult(empty);
      return empty;
    }
    throw e;
  }

  if (attempt.panels.length === 0) {
    warnings.push("No panels fit under the current constraints.");
  }

  const result = buildPanelLayoutReport({
    planeId: input.plane.planeId,
    moduleId: input.module.moduleId,
    orientationPolicy,
    orientationUsed: attempt.panels.length ? attempt.orientation : "none",
    panels: attempt.panels,
    usableAreaM2: attempt.usableAreaM2,
    unusedRegions: attempt.unusedRegions,
    metersPerUnit: input.metersPerUnit,
    warnings,
  });

  assertFiniteLayoutResult(result);
  assertNoPanelOverlap(result);
  return result;
}

/** Alias matching module name expectation. */
export const PanelLayoutEngine = {
  layout: layoutPanelsOnPlane,
};
