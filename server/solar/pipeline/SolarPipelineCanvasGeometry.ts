/**
 * Strict canvas/roof geometry validation for the Solar Design Pipeline.
 * Fail closed before any engine stage runs. No sanitizing or default substitution.
 */

import type {
  MaintenanceWalkwayDef,
  ObstacleDef,
  ParapetDef,
  Point2D,
  RidgeDef,
  RoofPlaneInput,
  RoofSiteInput,
  ValleyDef,
} from "../roof/RoofModels.ts";
import type { RoofObstacle, RoofPoint } from "../proposal/SolarProposalModels.ts";
import type { SolarDesignPipelineInput } from "./SolarPipelineModels.ts";
import { SolarPipelineValidationError } from "./SolarPipelineModels.ts";

/** Optional explicit circle obstacles on canvas (center + radius). */
export interface CanvasCircleObstacle {
  id: string;
  cx: number;
  cy: number;
  radius: number;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
  }
  return `${typeof value}(${String(value)})`;
}

function fail(path: string, detail: string): never {
  throw new SolarPipelineValidationError(
    "INVALID_CANVAS_GEOMETRY",
    `Invalid canvas geometry at ${path}: ${detail}`
  );
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (value === null || value === undefined) {
    fail(path, `must be a finite number; received ${describe(value)}`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, `must be a finite number; received ${describe(value)}`);
  }
  return value;
}

function requirePositiveFinite(value: unknown, path: string): number {
  const n = requireFiniteNumber(value, path);
  if (n <= 0) fail(path, `must be > 0; received ${n}`);
  return n;
}

function requireNonNegativeFinite(value: unknown, path: string): number {
  const n = requireFiniteNumber(value, path);
  if (n < 0) fail(path, `must be >= 0; received ${n}`);
  return n;
}

function validatePoint2D(point: unknown, path: string): void {
  if (point === null || typeof point !== "object") {
    fail(path, `must be an object with finite x and y; received ${describe(point)}`);
  }
  const p = point as Point2D;
  requireFiniteNumber(p.x, `${path}.x`);
  requireFiniteNumber(p.y, `${path}.y`);
}

function requireOptionalArray(
  value: unknown,
  path: string,
  validateItem: (item: unknown, index: number) => void
): void {
  if (value === undefined) return;
  if (value === null) {
    fail(path, `must be an array; received null`);
  }
  if (!Array.isArray(value)) {
    fail(path, `must be an array; received ${describe(value)}`);
  }
  value.forEach((item, i) => validateItem(item, i));
}

function validatePointList(points: unknown, path: string, minVertices = 1): void {
  if (!Array.isArray(points)) fail(path, `must be an array; received ${describe(points)}`);
  if (points.length < minVertices) {
    fail(path, `requires at least ${minVertices} vertex(es); received ${points.length}`);
  }
  points.forEach((pt, i) => validatePoint2D(pt, `${path}[${i}]`));
}

function validateCanvasObstacle(obstacle: unknown, index: number): void {
  const path = `obstacles[${index}]`;
  if (obstacle === null || typeof obstacle !== "object") {
    fail(path, `must be an object; received ${describe(obstacle)}`);
  }
  const o = obstacle as RoofObstacle;
  if (typeof o.id !== "string" || !o.id.trim()) {
    fail(`${path}.id`, "must be a non-empty string");
  }
  requireFiniteNumber(o.x, `${path}.x`);
  requireFiniteNumber(o.y, `${path}.y`);
  requirePositiveFinite(o.w, `${path}.w`);
  requirePositiveFinite(o.h, `${path}.h`);
}

function validateCircleObstacle(circle: unknown, index: number): void {
  const path = `circleObstacles[${index}]`;
  if (circle === null || typeof circle !== "object") {
    fail(path, `must be an object; received ${describe(circle)}`);
  }
  const c = circle as CanvasCircleObstacle;
  if (typeof c.id !== "string" || !c.id.trim()) {
    fail(`${path}.id`, "must be a non-empty string");
  }
  requireFiniteNumber(c.cx, `${path}.cx`);
  requireFiniteNumber(c.cy, `${path}.cy`);
  requirePositiveFinite(c.radius, `${path}.radius`);
}

function validateObstacleDef(obstacle: unknown, planeId: string, index: number): void {
  const path = `roofSite.planes[${planeId}].obstacles[${index}]`;
  if (obstacle === null || typeof obstacle !== "object") {
    fail(path, `must be an object; received ${describe(obstacle)}`);
  }
  const o = obstacle as ObstacleDef;
  if (typeof o.id !== "string" || !o.id.trim()) {
    fail(`${path}.id`, "must be a non-empty string");
  }
  validatePointList(o.polygon, `${path}.polygon`, 3);
  if (Object.prototype.hasOwnProperty.call(o, "heightM")) {
    requirePositiveFinite(o.heightM, `${path}.heightM`);
  }
  if (Object.prototype.hasOwnProperty.call(o, "setbackM")) {
    requireNonNegativeFinite(o.setbackM, `${path}.setbackM`);
  }
}

function validateParapet(parapet: unknown, planeId: string, index: number): void {
  const path = `roofSite.planes[${planeId}].parapets[${index}]`;
  if (parapet === null || typeof parapet !== "object") {
    fail(path, `must be an object; received ${describe(parapet)}`);
  }
  const p = parapet as ParapetDef;
  if (typeof p.id !== "string" || !p.id.trim()) {
    fail(`${path}.id`, "must be a non-empty string");
  }
  requirePositiveFinite(p.heightM, `${path}.heightM`);
  requirePositiveFinite(p.thicknessM, `${path}.thicknessM`);
  if (Object.prototype.hasOwnProperty.call(p, "edgeIndex")) {
    const edge = requireNonNegativeFinite(p.edgeIndex, `${path}.edgeIndex`);
    if (!Number.isInteger(edge)) fail(`${path}.edgeIndex`, "must be an integer");
  }
  if (p.strip !== undefined) {
    validatePointList(p.strip, `${path}.strip`, 3);
  }
}

function validateWalkway(walkway: unknown, planeId: string, index: number): void {
  const path = `roofSite.planes[${planeId}].walkways[${index}]`;
  if (walkway === null || typeof walkway !== "object") {
    fail(path, `must be an object; received ${describe(walkway)}`);
  }
  const w = walkway as MaintenanceWalkwayDef;
  if (typeof w.id !== "string" || !w.id.trim()) {
    fail(`${path}.id`, "must be a non-empty string");
  }
  validatePointList(w.polygon, `${path}.polygon`, 3);
  requirePositiveFinite(w.widthM, `${path}.widthM`);
}

function validateRidgeOrValley(segment: unknown, path: string): void {
  if (segment === null || typeof segment !== "object") {
    fail(path, `must be an object; received ${describe(segment)}`);
  }
  const s = segment as RidgeDef | ValleyDef;
  if (typeof s.id !== "string" || !s.id.trim()) {
    fail(`${path}.id`, "must be a non-empty string");
  }
  validatePoint2D(s.start, `${path}.start`);
  validatePoint2D(s.end, `${path}.end`);
}

function validateRoofPlane(plane: unknown, index: number): void {
  const path = `roofSite.planes[${index}]`;
  if (plane === null || typeof plane !== "object" || Array.isArray(plane)) {
    fail(path, `must be a non-null object; received ${describe(plane)}`);
  }
  const p = plane as RoofPlaneInput;
  if (typeof p.id !== "string" || !p.id.trim()) {
    fail(`${path}.id`, "must be a non-empty string");
  }
  validatePointList(p.boundary, `${path}.boundary`, 3);
  const pitch = requireFiniteNumber(p.pitchDeg, `${path}.pitchDeg`);
  if (pitch < 0 || pitch > 60) {
    fail(`${path}.pitchDeg`, `must be between 0 and 60; received ${pitch}`);
  }
  requireFiniteNumber(p.azimuthDeg, `${path}.azimuthDeg`);

  requireOptionalArray(p.obstacles, `${path}.obstacles`, (o, i) => validateObstacleDef(o, p.id, i));
  requireOptionalArray(p.parapets, `${path}.parapets`, (pp, i) => validateParapet(pp, p.id, i));
  requireOptionalArray(p.walkways, `${path}.walkways`, (w, i) => validateWalkway(w, p.id, i));
  requireOptionalArray(p.ridges, `${path}.ridges`, (r, i) => validateRidgeOrValley(r, `${path}.ridges[${i}]`));
  requireOptionalArray(p.valleys, `${path}.valleys`, (v, i) => validateRidgeOrValley(v, `${path}.valleys[${i}]`));

  if (p.setbacks !== undefined) {
    const sb = p.setbacks;
    if (sb === null || typeof sb !== "object") {
      fail(`${path}.setbacks`, `must be an object; received ${describe(sb)}`);
    }
    const keys = [
      "edgeSetbackM",
      "ridgeSetbackM",
      "valleySetbackM",
      "parapetSetbackM",
      "obstacleClearanceM",
      "maintenanceWalkwayM",
    ] as const;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(sb, key)) {
        requireNonNegativeFinite((sb as Record<string, unknown>)[key], `${path}.setbacks.${key}`);
      }
    }
  }
}

function validateRoofSite(site: unknown): void {
  if (site === null || typeof site !== "object" || Array.isArray(site)) {
    fail("roofSite", `must be a non-null object; received ${describe(site)}`);
  }
  const s = site as RoofSiteInput;
  if (typeof s.siteId !== "string" || !s.siteId.trim()) {
    fail("roofSite.siteId", "must be a non-empty string");
  }
  if (Object.prototype.hasOwnProperty.call(s, "metersPerUnit")) {
    requirePositiveFinite(s.metersPerUnit, "roofSite.metersPerUnit");
  }
  if (s.origin !== undefined) {
    validatePoint2D(s.origin, "roofSite.origin");
  }
  if (Object.prototype.hasOwnProperty.call(s, "northAzimuthDeg")) {
    requireFiniteNumber(s.northAzimuthDeg, "roofSite.northAzimuthDeg");
  }
  if (!Array.isArray(s.planes)) {
    fail("roofSite.planes", `must be an array; received ${describe(s.planes)}`);
  }
  if (s.planes.length === 0) {
    fail("roofSite.planes", "must contain at least one plane");
  }
  s.planes.forEach((plane, i) => validateRoofPlane(plane, i));
}

function validateRoofBoundary(boundary: RoofPoint[], path: string): void {
  validatePointList(boundary, path, 3);
}

/**
 * Validate all canvas/roof geometry on pipeline input.
 * Throws SolarPipelineValidationError with code INVALID_CANVAS_GEOMETRY.
 */
export function validateCanvasGeometry(input: SolarDesignPipelineInput): void {
  if (input.roofBoundary !== undefined) {
    if (!Array.isArray(input.roofBoundary)) {
      fail("roofBoundary", `must be an array; received ${describe(input.roofBoundary)}`);
    }
    validateRoofBoundary(input.roofBoundary, "roofBoundary");
  }

  if (input.obstacles !== undefined) {
    if (!Array.isArray(input.obstacles)) {
      fail("obstacles", `must be an array; received ${describe(input.obstacles)}`);
    }
    input.obstacles.forEach((o, i) => validateCanvasObstacle(o, i));
  }

  if (input.circleObstacles !== undefined) {
    if (!Array.isArray(input.circleObstacles)) {
      fail("circleObstacles", `must be an array; received ${describe(input.circleObstacles)}`);
    }
    input.circleObstacles.forEach((c, i) => validateCircleObstacle(c, i));
  }

  if (Object.prototype.hasOwnProperty.call(input, "roofSite")) {
    validateRoofSite((input as SolarDesignPipelineInput & { roofSite?: unknown }).roofSite);
  }
}
