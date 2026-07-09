/**
 * Roof geometry input validation — fail closed, no silent sanitizing.
 */

import type { ObstacleDef, Point2D, RoofPlaneInput, RoofSiteInput } from "./RoofModels.ts";
import {
  InvalidRoofBoundaryError,
  ROOF_EPSILON,
  RoofGeometryError,
  isFiniteNumber,
} from "./RoofModels.ts";
import { detectPolygonSelfIntersections, polygonArea, polygonSignedArea } from "./RoofPolygon.ts";
import { normalizeAzimuthDeg } from "./RoofPlane.ts";

export interface RoofValidationIssue {
  code: string;
  message: string;
  planeId?: string;
}

export interface RoofValidationResult {
  valid: boolean;
  issues: RoofValidationIssue[];
}

export function requireFiniteNumber(value: unknown, field: string, planeId?: string, vertexIndex?: number): number {
  if (!isFiniteNumber(value)) {
    throw new InvalidRoofBoundaryError({
      errorCode: "INVALID_VERTEX",
      message: `${field} must be a finite number.`,
      planeId,
      vertexIndex,
    });
  }
  return value;
}

export function requirePoint2D(raw: unknown, index: number, planeId?: string): Point2D {
  if (!raw || typeof raw !== "object") {
    throw new InvalidRoofBoundaryError({
      errorCode: "INVALID_VERTEX",
      message: `Vertex at index ${index} must be an object with finite x and y.`,
      planeId,
      vertexIndex: index,
    });
  }
  const p = raw as Point2D;
  return {
    x: requireFiniteNumber(p.x, `vertex[${index}].x`, planeId, index),
    y: requireFiniteNumber(p.y, `vertex[${index}].y`, planeId, index),
  };
}

export function validateBoundaryVertices(vertices: unknown, planeId?: string): Point2D[] {
  if (!Array.isArray(vertices)) {
    throw new InvalidRoofBoundaryError({
      errorCode: "INVALID_BOUNDARY",
      message: "Roof boundary must be an array of vertices.",
      planeId,
    });
  }
  if (vertices.length < 3) {
    throw new InvalidRoofBoundaryError({
      errorCode: "INSUFFICIENT_VERTICES",
      message: "Roof plane boundary requires at least 3 vertices.",
      planeId,
    });
  }
  const parsed = vertices.map((v, i) => requirePoint2D(v, i, planeId));

  const intersections = detectPolygonSelfIntersections(parsed);
  if (intersections.length > 0) {
    const first = intersections[0];
    throw new InvalidRoofBoundaryError({
      errorCode: "INVALID_SELF_INTERSECTION",
      message: `Roof boundary self-intersects at edge indexes ${first.edgeIndexes[0]} and ${first.edgeIndexes[1]}.`,
      planeId,
      edgeIndexes: first.edgeIndexes,
      intersectionPoint: first.intersectionPoint,
    });
  }

  if (Math.abs(polygonSignedArea(parsed)) < ROOF_EPSILON) {
    throw new InvalidRoofBoundaryError({
      errorCode: "ZERO_AREA",
      message: "Roof plane boundary has zero area.",
      planeId,
    });
  }

  return parsed;
}

export function validateObstaclePolygon(polygon: unknown, obstacleId: string, planeId?: string): Point2D[] {
  if (!Array.isArray(polygon)) {
    throw new InvalidRoofBoundaryError({
      errorCode: "INVALID_OBSTACLE",
      message: `Obstacle ${obstacleId} polygon must be an array.`,
      planeId,
    });
  }
  return validateBoundaryVertices(polygon, planeId ? `${planeId}/obstacle/${obstacleId}` : obstacleId);
}

export function validateRoofPlane(input: RoofPlaneInput): RoofValidationResult {
  try {
    validateRoofPlaneStrict(input);
    return { valid: true, issues: [] };
  } catch (e) {
    if (e instanceof InvalidRoofBoundaryError) {
      return {
        valid: false,
        issues: [{ code: e.errorCode, message: e.message, planeId: input.id }],
      };
    }
    if (e instanceof RoofGeometryError) {
      return { valid: false, issues: [{ code: e.code, message: e.message, planeId: input.id }] };
    }
    throw e;
  }
}

export function validateRoofPlaneStrict(input: RoofPlaneInput): void {
  if (!input.id?.trim()) {
    throw new RoofGeometryError("MISSING_PLANE_ID", "Roof plane id is required.");
  }

  validateBoundaryVertices(input.boundary, input.id);

  const pitch = input.pitchDeg;
  if (!isFiniteNumber(pitch) || pitch < 0 || pitch > 60) {
    throw new RoofGeometryError("PITCH_OUT_OF_RANGE", "Pitch must be a finite number between 0 and 60 degrees.");
  }

  if (!isFiniteNumber(input.azimuthDeg)) {
    throw new RoofGeometryError("INVALID_AZIMUTH", "Azimuth must be a finite number.");
  }
  normalizeAzimuthDeg(input.azimuthDeg);

  for (const obstacle of input.obstacles ?? []) {
    if (!obstacle?.id?.trim()) {
      throw new InvalidRoofBoundaryError({
        errorCode: "INVALID_OBSTACLE",
        message: "Obstacle id is required.",
        planeId: input.id,
      });
    }
    validateObstaclePolygon(obstacle.polygon, obstacle.id, input.id);
    if (obstacle.heightM !== undefined && !isFiniteNumber(obstacle.heightM)) {
      throw new InvalidRoofBoundaryError({
        errorCode: "INVALID_OBSTACLE",
        message: `Obstacle ${obstacle.id} heightM must be a finite number.`,
        planeId: input.id,
      });
    }
    if (obstacle.setbackM !== undefined && !isFiniteNumber(obstacle.setbackM)) {
      throw new InvalidRoofBoundaryError({
        errorCode: "INVALID_OBSTACLE",
        message: `Obstacle ${obstacle.id} setbackM must be a finite number.`,
        planeId: input.id,
      });
    }
  }

  for (const walkway of input.walkways ?? []) {
    if (!walkway?.id?.trim()) {
      throw new InvalidRoofBoundaryError({
        errorCode: "INVALID_WALKWAY",
        message: "Walkway id is required.",
        planeId: input.id,
      });
    }
    validateBoundaryVertices(walkway.polygon, `${input.id}/walkway/${walkway.id}`);
    if (!isFiniteNumber(walkway.widthM) || walkway.widthM <= 0) {
      throw new InvalidRoofBoundaryError({
        errorCode: "INVALID_WALKWAY",
        message: `Walkway ${walkway.id} widthM must be a positive finite number.`,
        planeId: input.id,
      });
    }
  }
}

export function validateRoofSite(input: RoofSiteInput): RoofValidationResult {
  try {
    validateRoofSiteStrict(input);
    return { valid: true, issues: [] };
  } catch (e) {
    if (e instanceof RoofGeometryError) {
      return { valid: false, issues: [{ code: e instanceof InvalidRoofBoundaryError ? e.errorCode : e.code, message: e.message }] };
    }
    throw e;
  }
}

export function validateRoofSiteStrict(input: RoofSiteInput): void {
  if (!input.siteId?.trim()) {
    throw new RoofGeometryError("MISSING_SITE_ID", "Site id is required.");
  }
  if (!Array.isArray(input.planes) || input.planes.length === 0) {
    throw new RoofGeometryError("NO_PLANES", "At least one roof plane is required.");
  }
  if (input.metersPerUnit !== undefined && (!isFiniteNumber(input.metersPerUnit) || input.metersPerUnit <= 0)) {
    throw new RoofGeometryError("INVALID_SCALE", "metersPerUnit must be a positive finite number.");
  }
  if (input.origin !== undefined) {
    requirePoint2D(input.origin, 0, input.siteId);
  }
  if (input.northAzimuthDeg !== undefined && !isFiniteNumber(input.northAzimuthDeg)) {
    throw new RoofGeometryError("INVALID_NORTH_AZIMUTH", "northAzimuthDeg must be a finite number.");
  }

  for (const plane of input.planes) {
    validateRoofPlaneStrict(plane);
  }

  const ids = input.planes.map((p) => p.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    throw new RoofGeometryError("DUPLICATE_PLANE_ID", `Duplicate plane ids: ${[...new Set(dupes)].join(", ")}`);
  }
}

export function assertValidRoofSite(input: RoofSiteInput): void {
  validateRoofSiteStrict(input);
}

export function isValidPitch(pitchDeg: number): boolean {
  return isFiniteNumber(pitchDeg) && pitchDeg >= 0 && pitchDeg <= 60;
}
