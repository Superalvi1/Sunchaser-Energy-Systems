/**
 * Obstacle and parapet normalization for roof planes.
 */

import type { ObstacleDef, ParapetDef, Point2D } from "./RoofModels.ts";
import { finiteNum, isFinitePoint } from "./RoofModels.ts";
import {
  clipRectToPolygon,
  filterFiniteVertices,
  overlapAreaPolygons,
  polygonArea,
  polygonBounds,
  rectFromCenter,
} from "./RoofPolygon.ts";
import { requireValidMetersPerUnit } from "./RoofMeasurement.ts";

export interface NormalizedObstacle {
  id: string;
  polygon: Point2D[];
  heightM: number;
  setbackM: number;
  areaUnits: number;
}

export interface NormalizedParapet {
  id: string;
  polygon: Point2D[];
  heightM: number;
  thicknessM: number;
  areaUnits: number;
}

function obstacleToPolygon(raw: ObstacleDef): Point2D[] | null {
  const poly = raw.polygon;
  if (!Array.isArray(poly) || poly.length < 3 || polygonArea(poly) <= 0) return null;
  return poly;
}

export function normalizeObstacles(raw: unknown, planeBoundary: Point2D[]): NormalizedObstacle[] {
  if (!Array.isArray(raw)) return [];
  const result: NormalizedObstacle[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const o = item as ObstacleDef;
    const polygon = obstacleToPolygon(o);
    if (!polygon) continue;
    const clippedArea = clipRectToPolygon(
      (polygonBounds(polygon) as any) ?? { x: 0, y: 0, w: 0, h: 0 },
      planeBoundary
    );
    const areaUnits = Math.max(overlapAreaPolygons(polygon, planeBoundary), clippedArea > 0 ? clippedArea : polygonArea(polygon));
    if (areaUnits <= 0) continue;
    result.push({
      id: typeof o.id === "string" && o.id ? o.id : `obs-${i}`,
      polygon,
      heightM: Math.max(0, finiteNum(o.heightM, 0)),
      setbackM: Math.max(0, finiteNum(o.setbackM, 0)),
      areaUnits: areaUnits,
    });
  }
  return result;
}

export function parapetStripForEdge(
  boundary: Point2D[],
  edgeIndex: number,
  thickness: number
): Point2D[] | null {
  const pts = filterFiniteVertices(boundary);
  if (pts.length < 3 || edgeIndex < 0 || edgeIndex >= pts.length || thickness <= 0) return null;
  const a = pts[edgeIndex];
  const b = pts[(edgeIndex + 1) % pts.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const nx = (-dy / len) * thickness;
  const ny = (dx / len) * thickness;
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
    { x: b.x + nx, y: b.y + ny },
    { x: a.x + nx, y: a.y + ny },
  ];
}

export function normalizeParapets(raw: unknown, planeBoundary: Point2D[]): NormalizedParapet[] {
  if (!Array.isArray(raw)) return [];
  const result: NormalizedParapet[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const p = item as ParapetDef;
    const heightM = Math.max(0, finiteNum(p.heightM, 0));
    const thicknessM = Math.max(0.05, finiteNum(p.thicknessM, 0.3));
    let polygon: Point2D[] | null = null;
    if (Array.isArray(p.strip) && p.strip.length >= 3) {
      polygon = filterFiniteVertices(p.strip);
    } else if (typeof p.edgeIndex === "number") {
      polygon = parapetStripForEdge(planeBoundary, p.edgeIndex, thicknessM);
    }
    if (!polygon || polygon.length < 3) continue;
    const areaUnits = overlapAreaPolygons(polygon, planeBoundary);
    if (areaUnits <= 0) continue;
    result.push({
      id: typeof p.id === "string" && p.id ? p.id : `parapet-${i}`,
      polygon,
      heightM,
      thicknessM,
      areaUnits,
    });
  }
  return result;
}

export function obstacleFootprintWithClearance(obstacle: NormalizedObstacle, clearanceM: number, metersPerUnit: number): Point2D[] {
  const mpu = requireValidMetersPerUnit(metersPerUnit);
  if (clearanceM <= 0) return obstacle.polygon;
  const bounds = polygonBounds(obstacle.polygon);
  if (!bounds) return obstacle.polygon;
  const pad = clearanceM / mpu;
  return rectFromCenter(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    bounds.width + pad * 2,
    bounds.height + pad * 2
  );
}

export function totalObstacleAreaUnits(obstacles: NormalizedObstacle[], clearanceM: number, metersPerUnit: number, planeBoundary: Point2D[]): number {
  let sum = 0;
  for (const o of obstacles) {
    const footprint = obstacleFootprintWithClearance(o, clearanceM + o.setbackM, metersPerUnit);
    sum += overlapAreaPolygons(footprint, planeBoundary);
  }
  return sum;
}

export function totalParapetAreaUnits(parapets: NormalizedParapet[]): number {
  return parapets.reduce((s, p) => s + p.areaUnits, 0);
}

export function safeObstacleRect(cx: number, cy: number, w: number, h: number): Point2D[] {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return [];
  }
  return rectFromCenter(cx, cy, w, h);
}
