/**
 * Roof geometry helpers for panel layout feasibility.
 */

import type { RoofObstacle, RoofPoint } from "./SolarProposalModels.ts";

export const DEFAULT_PANEL_WIDTH_M = 1.134;
export const DEFAULT_PANEL_HEIGHT_M = 2.278;
export const DEFAULT_PANEL_GAP_M = 0.02;

export interface RoofBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function polygonBounds(points: RoofPoint[]): RoofBounds | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function pointInPolygon(point: RoofPoint, polygon: RoofPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function rectOverlapsObstacle(
  x: number,
  y: number,
  w: number,
  h: number,
  obstacles: RoofObstacle[]
): boolean {
  for (const o of obstacles) {
    if (x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y) return true;
  }
  return false;
}

export function roofWidthMetersFromCanvas(
  boundary: RoofPoint[],
  canvasWidth: number,
  roofWidthMeters: number
): number {
  const bounds = polygonBounds(boundary);
  if (!bounds || canvasWidth <= 0) return roofWidthMeters;
  const scale = roofWidthMeters / bounds.width;
  return bounds.width * scale;
}

export function estimateUsableRoofAreaM2(
  boundary: RoofPoint[],
  obstacles: RoofObstacle[],
  canvasWidth: number,
  roofWidthMeters: number
): number {
  const bounds = polygonBounds(boundary);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return 0;
  const scale = roofWidthMeters / bounds.width;
  const roofHeightM = bounds.height * scale;
  const gross = roofWidthMeters * roofHeightM;
  const obstacleArea = obstacles.reduce((sum, o) => sum + o.w * o.h * scale * scale, 0);
  return Math.max(0, gross - obstacleArea);
}

export function defaultRoofBoundary(canvasWidth = 800, canvasHeight = 500): RoofPoint[] {
  const pad = 40;
  return [
    { x: pad, y: pad },
    { x: canvasWidth - pad, y: pad },
    { x: canvasWidth - pad, y: canvasHeight - pad },
    { x: pad, y: canvasHeight - pad },
  ];
}
