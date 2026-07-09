/**
 * Local site coordinate system and north reference.
 */

import type { Point2D } from "./RoofModels.ts";
import { isFiniteNumber } from "./RoofModels.ts";

export interface RoofCoordinateSystem {
  origin: Point2D;
  metersPerUnit: number;
  northAzimuthDeg: number;
}

export const DEFAULT_COORDINATE_SYSTEM: RoofCoordinateSystem = {
  origin: { x: 0, y: 0 },
  metersPerUnit: 1,
  northAzimuthDeg: 0,
};

export function normalizeCoordinateSystem(
  origin?: Point2D,
  metersPerUnit?: number,
  northAzimuthDeg?: number
): RoofCoordinateSystem {
  const o = origin ?? DEFAULT_COORDINATE_SYSTEM.origin;
  if (origin !== undefined) {
    if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y)) {
      throw new Error("origin must have finite x and y");
    }
  }
  const mpu = metersPerUnit ?? DEFAULT_COORDINATE_SYSTEM.metersPerUnit;
  if (!isFiniteNumber(mpu) || mpu <= 0) {
    throw new Error("metersPerUnit must be a positive finite number");
  }
  const north = northAzimuthDeg ?? DEFAULT_COORDINATE_SYSTEM.northAzimuthDeg;
  if (northAzimuthDeg !== undefined && !isFiniteNumber(north)) {
    throw new Error("northAzimuthDeg must be a finite number");
  }
  return {
    origin: { x: o.x, y: o.y },
    metersPerUnit: mpu,
    northAzimuthDeg: north % 360,
  };
}

export function toLocalMeters(point: Point2D, cs: RoofCoordinateSystem): Point2D {
  return {
    x: (point.x - cs.origin.x) * cs.metersPerUnit,
    y: (point.y - cs.origin.y) * cs.metersPerUnit,
  };
}

export function fromLocalMeters(point: Point2D, cs: RoofCoordinateSystem): Point2D {
  const mpu = cs.metersPerUnit > 0 ? cs.metersPerUnit : 1;
  return {
    x: point.x / mpu + cs.origin.x,
    y: point.y / mpu + cs.origin.y,
  };
}

export function rotatePointAroundOrigin(point: Point2D, angleDeg: number): Point2D {
  if (!isFiniteNumber(angleDeg)) {
    throw new Error("angleDeg must be a finite number");
  }
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function trueAzimuthFromPlan(planeAzimuthDeg: number, cs: RoofCoordinateSystem): number {
  return (planeAzimuthDeg + cs.northAzimuthDeg + 360) % 360;
}
