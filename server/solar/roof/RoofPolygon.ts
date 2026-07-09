/**
 * 2D polygon primitives for roof plan geometry.
 */

import type { Point2D, RoofBounds2D, RoofPolygonDef } from "./RoofModels.ts";
import { ROOF_EPSILON, finiteNum, isFinitePoint, round4 } from "./RoofModels.ts";

export interface PolygonSelfIntersection {
  edgeIndexes: [number, number];
  intersectionPoint: Point2D;
}

function segmentIntersectionPoint(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): Point2D | null {
  const dxa = a2.x - a1.x;
  const dya = a2.y - a1.y;
  const dxb = b2.x - b1.x;
  const dyb = b2.y - b1.y;
  const denom = dxa * dyb - dya * dxb;
  if (Math.abs(denom) < ROOF_EPSILON) return null;
  const t = ((b1.x - a1.x) * dyb - (b1.y - a1.y) * dxb) / denom;
  const u = ((b1.x - a1.x) * dya - (b1.y - a1.y) * dxa) / denom;
  if (t < -ROOF_EPSILON || t > 1 + ROOF_EPSILON || u < -ROOF_EPSILON || u > 1 + ROOF_EPSILON) return null;
  return { x: round4(a1.x + t * dxa), y: round4(a1.y + t * dya) };
}

function polygonEdgesAdjacent(i: number, j: number, edgeCount: number): boolean {
  if (i === j) return true;
  if ((i + 1) % edgeCount === j) return true;
  if ((j + 1) % edgeCount === i) return true;
  return false;
}

export function detectPolygonSelfIntersections(vertices: Point2D[]): PolygonSelfIntersection[] {
  const pts = vertices;
  if (pts.length < 4) return [];
  const hits: PolygonSelfIntersection[] = [];
  const edgeCount = pts.length;
  for (let i = 0; i < edgeCount; i += 1) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % edgeCount];
    for (let j = i + 1; j < edgeCount; j += 1) {
      if (polygonEdgesAdjacent(i, j, edgeCount)) continue;
      const b1 = pts[j];
      const b2 = pts[(j + 1) % edgeCount];
      const intersectionPoint = segmentIntersectionPoint(a1, a2, b1, b2);
      if (intersectionPoint) {
        hits.push({ edgeIndexes: [i, j], intersectionPoint });
      }
    }
  }
  return hits;
}

export function hasPolygonSelfIntersection(vertices: Point2D[]): boolean {
  return detectPolygonSelfIntersections(vertices).length > 0;
}

export function filterFiniteVertices(vertices: Point2D[]): Point2D[] {
  return vertices.filter(isFinitePoint);
}

export function polygonVertexCount(vertices: Point2D[]): number {
  return filterFiniteVertices(vertices).length;
}

export function polygonCentroid(vertices: Point2D[]): Point2D | null {
  const pts = filterFiniteVertices(vertices);
  if (pts.length < 3) return null;
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area2) < ROOF_EPSILON) return null;
  const f = 1 / (3 * area2);
  return { x: cx * f, y: cy * f };
}

export function polygonSignedArea(vertices: Point2D[]): number {
  const pts = filterFiniteVertices(vertices);
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(vertices: Point2D[]): number {
  return Math.abs(polygonSignedArea(vertices));
}

export function polygonPerimeter(vertices: Point2D[]): number {
  const pts = filterFiniteVertices(vertices);
  if (pts.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

export function polygonBounds(vertices: Point2D[]): RoofBounds2D | null {
  const pts = filterFiniteVertices(vertices);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (!isFinitePoint(point)) return false;
  const pts = filterFiniteVertices(polygon);
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + ROOF_EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonIsSimpleConvex(vertices: Point2D[]): boolean {
  const pts = filterFiniteVertices(vertices);
  if (pts.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < ROOF_EPSILON) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return sign !== 0;
}

export function insetPolygonTowardCentroid(vertices: Point2D[], inset: number): Point2D[] {
  const pts = filterFiniteVertices(vertices);
  if (pts.length < 3 || inset <= 0) return [...pts];
  const c = polygonCentroid(pts);
  if (!c) return [...pts];
  return pts.map((v) => {
    const dx = c.x - v.x;
    const dy = c.y - v.y;
    const len = Math.hypot(dx, dy);
    if (len < ROOF_EPSILON) return { ...v };
    const move = Math.min(inset, len * 0.45);
    return { x: v.x + (dx / len) * move, y: v.y + (dy / len) * move };
  });
}

export function clipRectToPolygon(rect: { x: number; y: number; w: number; h: number }, polygon: Point2D[]): number {
  if (rect.w <= 0 || rect.h <= 0) return 0;
  const samples = 5;
  let inside = 0;
  let total = 0;
  for (let i = 0; i <= samples; i += 1) {
    for (let j = 0; j <= samples; j += 1) {
      const x = rect.x + (rect.w * i) / samples;
      const y = rect.y + (rect.h * j) / samples;
      total += 1;
      if (pointInPolygon({ x, y }, polygon)) inside += 1;
    }
  }
  return (inside / Math.max(1, total)) * rect.w * rect.h;
}

export function overlapAreaPolygons(a: Point2D[], b: Point2D[]): number {
  const boundsA = polygonBounds(a);
  const boundsB = polygonBounds(b);
  if (!boundsA || !boundsB) return 0;
  const minX = Math.max(boundsA.minX, boundsB.minX);
  const minY = Math.max(boundsA.minY, boundsB.minY);
  const maxX = Math.min(boundsA.maxX, boundsB.maxX);
  const maxY = Math.min(boundsA.maxY, boundsB.maxY);
  if (maxX <= minX || maxY <= minY) return 0;
  const grid = 8;
  const stepX = (maxX - minX) / grid;
  const stepY = (maxY - minY) / grid;
  let hits = 0;
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      const p = { x: minX + stepX * (i + 0.5), y: minY + stepY * (j + 0.5) };
      if (pointInPolygon(p, a) && pointInPolygon(p, b)) hits += 1;
    }
  }
  return (hits / (grid * grid)) * (maxX - minX) * (maxY - minY);
}

export function normalizePolygonDef(raw: RoofPolygonDef): RoofPolygonDef | null {
  const vertices = filterFiniteVertices(raw.vertices);
  if (vertices.length < 3 || polygonArea(vertices) < ROOF_EPSILON) return null;
  return { id: raw.id || "polygon", vertices };
}

export function polygonEdgeLength(vertices: Point2D[], edgeIndex: number): number {
  const pts = filterFiniteVertices(vertices);
  if (pts.length < 2 || edgeIndex < 0 || edgeIndex >= pts.length) return 0;
  const a = pts[edgeIndex];
  const b = pts[(edgeIndex + 1) % pts.length];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function distancePointToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < ROOF_EPSILON) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function rectFromCenter(cx: number, cy: number, w: number, h: number): Point2D[] {
  const hw = finiteNum(w, 0) / 2;
  const hh = finiteNum(h, 0) / 2;
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ];
}

export function scalePolygonAreaToM2(areaUnits: number, metersPerUnit: number): number {
  return round4(areaUnits * metersPerUnit * metersPerUnit);
}
