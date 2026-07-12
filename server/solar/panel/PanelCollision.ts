/**
 * Panel collision — AABB + polygon containment via roof engine helpers.
 * No duplicate point-in-polygon / overlap math.
 */

import type { Point2D } from "../roof/RoofModels.ts";
import { pointInPolygon, overlapAreaPolygons, polygonBounds } from "../roof/RoofPolygon.ts";
import { ROOF_EPSILON } from "../roof/RoofModels.ts";
import { panelPolygonFromTopLeft } from "./PanelGeometry.ts";

export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function aabbFromTopLeft(x: number, y: number, w: number, h: number): Aabb {
  return { x, y, w, h };
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function panelAabbIntersectsPanel(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return aabbIntersects(aabbFromTopLeft(ax, ay, aw, ah), aabbFromTopLeft(bx, by, bw, bh));
}

/** True if any panel corner is outside the usable polygon. */
export function panelOutsideUsablePolygon(
  usable: Point2D[],
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const corners = panelPolygonFromTopLeft(x, y, w, h);
  return !corners.every((c) => pointInPolygon(c, usable));
}

/** True if panel AABB overlaps any obstacle polygon (with positive overlap area). */
export function panelIntersectsObstaclePolygons(
  obstacles: Point2D[][],
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const panelPoly = panelPolygonFromTopLeft(x, y, w, h);
  for (const obs of obstacles) {
    if (obs.length < 3) continue;
    if (overlapAreaPolygons(panelPoly, obs) > ROOF_EPSILON) return true;
    // Also reject if any panel corner is inside obstacle
    if (panelPoly.some((c) => pointInPolygon(c, obs))) return true;
    // Or obstacle vertex inside panel
    if (obs.some((c) => pointInPolygon(c, panelPoly))) return true;
  }
  return false;
}

export function panelIntersectsAabbObstacles(
  obstacles: Aabb[],
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const panel = aabbFromTopLeft(x, y, w, h);
  return obstacles.some((o) => aabbIntersects(panel, o));
}

export function expandPolygonBoundsAsAabb(polygon: Point2D[], clearanceUnits: number): Aabb | null {
  const b = polygonBounds(polygon);
  if (!b) return null;
  const c = Math.max(0, clearanceUnits);
  return {
    x: b.minX - c,
    y: b.minY - c,
    w: b.width + c * 2,
    h: b.height + c * 2,
  };
}
