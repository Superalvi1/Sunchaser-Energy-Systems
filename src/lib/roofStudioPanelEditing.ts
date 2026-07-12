/**
 * Roof Studio — HelioScope-style panel editing helpers (client UX only).
 * No packing engine changes; pure geometry + selection utilities.
 */

import type { Point2D } from "../../server/solar/roof/RoofModels.ts";
import { distancePointToSegment, pointInPolygon, polygonBounds } from "../../server/solar/roof/RoofPolygon.ts";
import {
  aabbFromTopLeft,
  panelAabbIntersectsPanel,
  panelIntersectsAabbObstacles,
  panelOutsideUsablePolygon,
} from "../../server/solar/panel/PanelCollision.ts";
import { requireValidScale } from "./roofStudioCalibration.ts";
import type { StudioPlane } from "./roofStudioClient.ts";
import { nextStudioId } from "./roofStudioClient.ts";
import {
  panelFootprintUnits,
  type PanelModuleSpec,
  type PanelOrientation,
  type StudioPanelPlacement,
} from "./roofStudioPanels.ts";

export const PANEL_SNAP_THRESHOLD_UNITS = 5;
export const PANEL_DUPLICATE_OFFSET_UNITS = 6;

export interface PanelAabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelCollisionFeedback {
  colliding: boolean;
  outsideBoundary: boolean;
  overlapsPanel: boolean;
  overlapsObstacle: boolean;
}

export interface PanelSnapFeedback {
  x: number;
  y: number;
  snappedRoofEdge: boolean;
  snappedAdjacent: boolean;
}

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type PanelClipboardItem = Omit<StudioPanelPlacement, "id">;

function obstacleAabbs(plane: StudioPlane, metersPerUnit: number): PanelAabb[] {
  const mpu = requireValidScale(metersPerUnit);
  return plane.obstacles.flatMap((o) => {
    const b = polygonBounds(o.vertices);
    if (!b) return [];
    const clearanceU = o.clearanceM / mpu;
    return [
      {
        x: b.minX - clearanceU,
        y: b.minY - clearanceU,
        w: b.maxX - b.minX + clearanceU * 2,
        h: b.maxY - b.minY + clearanceU * 2,
      },
    ];
  });
}

export function placementAabb(
  placement: StudioPanelPlacement,
  spec: PanelModuleSpec,
  metersPerUnit: number
): PanelAabb {
  const { w, h } = panelFootprintUnits(spec, placement.orientation, metersPerUnit);
  return { x: placement.x, y: placement.y, w, h };
}

export function evaluatePanelCollision(
  placement: StudioPanelPlacement,
  allPlacements: StudioPanelPlacement[],
  plane: StudioPlane,
  spec: PanelModuleSpec,
  metersPerUnit: number,
  excludeIds: ReadonlySet<string> = new Set()
): PanelCollisionFeedback {
  const mpu = requireValidScale(metersPerUnit);
  const { w, h } = panelFootprintUnits(spec, placement.orientation, mpu);
  const outsideBoundary = panelOutsideUsablePolygon(plane.boundary, placement.x, placement.y, w, h);
  const overlapsObstacle = panelIntersectsAabbObstacles(
    obstacleAabbs(plane, mpu),
    placement.x,
    placement.y,
    w,
    h
  );
  let overlapsPanel = false;
  for (const other of allPlacements) {
    if (other.id === placement.id || excludeIds.has(other.id)) continue;
    const o = placementAabb(other, spec, mpu);
    if (panelAabbIntersectsPanel(placement.x, placement.y, w, h, o.x, o.y, o.w, o.h)) {
      overlapsPanel = true;
      break;
    }
  }
  return {
    colliding: outsideBoundary || overlapsObstacle || overlapsPanel,
    outsideBoundary,
    overlapsPanel,
    overlapsObstacle,
  };
}

function snapScalar(value: number, targets: number[], threshold: number): { value: number; snapped: boolean } {
  let best = value;
  let bestDist = threshold + 1;
  let snapped = false;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= threshold && d < bestDist) {
      best = t;
      bestDist = d;
      snapped = true;
    }
  }
  return { value: best, snapped };
}

/** Snap panel edges to roof boundary segments (axis-aligned edges). */
function snapToRoofBoundary(
  x: number,
  y: number,
  w: number,
  h: number,
  boundary: Point2D[],
  threshold: number
): { x: number; y: number; snapped: boolean } {
  if (boundary.length < 3) return { x, y, snapped: false };
  const xTargets: number[] = [];
  const yTargets: number[] = [];
  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < dy * 0.05) {
      yTargets.push(a.y, b.y);
    } else if (dy < dx * 0.05) {
      xTargets.push(a.x, b.x);
    } else {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dLeft = distancePointToSegment({ x, y }, a, b);
      const dRight = distancePointToSegment({ x: x + w, y }, a, b);
      const dTop = distancePointToSegment({ x, y }, a, b);
      const dBottom = distancePointToSegment({ x, y: y + h }, a, b);
      if (Math.min(dLeft, dRight, dTop, dBottom) <= threshold) {
        xTargets.push(mid.x);
        yTargets.push(mid.y);
      }
    }
  }
  const bounds = polygonBounds(boundary);
  if (bounds) {
    xTargets.push(bounds.minX, bounds.maxX);
    yTargets.push(bounds.minY, bounds.maxY);
  }

  let snapped = false;
  let nx = x;
  let ny = y;
  const left = snapScalar(x, xTargets, threshold);
  if (left.snapped) {
    nx = left.value;
    snapped = true;
  }
  const right = snapScalar(x + w, xTargets, threshold);
  if (right.snapped) {
    nx = right.value - w;
    snapped = true;
  }
  const top = snapScalar(y, yTargets, threshold);
  if (top.snapped) {
    ny = top.value;
    snapped = true;
  }
  const bottom = snapScalar(y + h, yTargets, threshold);
  if (bottom.snapped) {
    ny = bottom.value - h;
    snapped = true;
  }
  return { x: nx, y: ny, snapped };
}

/** Snap panel edges to neighboring panels with module gap. */
function snapToNeighborPanels(
  x: number,
  y: number,
  w: number,
  h: number,
  others: StudioPanelPlacement[],
  spec: PanelModuleSpec,
  metersPerUnit: number,
  excludeIds: ReadonlySet<string>,
  threshold: number
): { x: number; y: number; snapped: boolean } {
  const mpu = requireValidScale(metersPerUnit);
  const gapU = spec.gapM / mpu;
  const rowGapU = spec.rowSpacingM / mpu;
  const xTargets: number[] = [];
  const yTargets: number[] = [];
  const xTargetsRight: number[] = [];
  const yTargetsBottom: number[] = [];

  for (const other of others) {
    if (excludeIds.has(other.id)) continue;
    const o = placementAabb(other, spec, mpu);
    xTargets.push(o.x + o.w + gapU);
    xTargetsRight.push(o.x - w - gapU);
    yTargets.push(o.y + o.h + rowGapU);
    yTargetsBottom.push(o.y - h - rowGapU);
    xTargets.push(o.x);
    xTargetsRight.push(o.x + o.w - w);
    yTargets.push(o.y);
    yTargetsBottom.push(o.y + o.h - h);
  }

  let snapped = false;
  let nx = x;
  let ny = y;
  const left = snapScalar(x, xTargets, threshold);
  if (left.snapped) {
    nx = left.value;
    snapped = true;
  }
  const right = snapScalar(x, xTargetsRight, threshold);
  if (right.snapped) {
    nx = right.value;
    snapped = true;
  }
  const top = snapScalar(y, yTargets, threshold);
  if (top.snapped) {
    ny = top.value;
    snapped = true;
  }
  const bottom = snapScalar(y, yTargetsBottom, threshold);
  if (bottom.snapped) {
    ny = bottom.value;
    snapped = true;
  }
  return { x: nx, y: ny, snapped };
}

export function snapPanelPosition(
  x: number,
  y: number,
  placement: StudioPanelPlacement,
  plane: StudioPlane,
  allPlacements: StudioPanelPlacement[],
  spec: PanelModuleSpec,
  metersPerUnit: number,
  excludeIds: ReadonlySet<string> = new Set(),
  threshold = PANEL_SNAP_THRESHOLD_UNITS
): PanelSnapFeedback {
  const mpu = requireValidScale(metersPerUnit);
  const { w, h } = panelFootprintUnits(spec, placement.orientation, mpu);
  const roof = snapToRoofBoundary(x, y, w, h, plane.boundary, threshold);
  const neighbor = snapToNeighborPanels(
    roof.x,
    roof.y,
    w,
    h,
    allPlacements,
    spec,
    mpu,
    excludeIds,
    threshold
  );
  return {
    x: neighbor.x,
    y: neighbor.y,
    snappedRoofEdge: roof.snapped,
    snappedAdjacent: neighbor.snapped,
  };
}

export function movePanelsByDelta(
  placements: StudioPanelPlacement[],
  panelIds: ReadonlySet<string>,
  dx: number,
  dy: number
): StudioPanelPlacement[] {
  if (panelIds.size === 0 || (dx === 0 && dy === 0)) return placements;
  return placements.map((p) => (panelIds.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p));
}

export function setPanelPositions(
  placements: StudioPanelPlacement[],
  positions: ReadonlyMap<string, { x: number; y: number }>
): StudioPanelPlacement[] {
  if (positions.size === 0) return placements;
  return placements.map((p) => {
    const pos = positions.get(p.id);
    return pos ? { ...p, x: pos.x, y: pos.y } : p;
  });
}

export function rotatePlacementOrientation(placement: StudioPanelPlacement): PanelOrientation {
  return placement.orientation === "portrait" ? "landscape" : "portrait";
}

/** Toggle orientation while keeping the panel center fixed. */
export function rotatePanelInPlace(
  placement: StudioPanelPlacement,
  spec: PanelModuleSpec,
  metersPerUnit: number
): StudioPanelPlacement {
  const mpu = requireValidScale(metersPerUnit);
  const old = panelFootprintUnits(spec, placement.orientation, mpu);
  const cx = placement.x + old.w / 2;
  const cy = placement.y + old.h / 2;
  const nextOrientation = rotatePlacementOrientation(placement);
  const next = panelFootprintUnits(spec, nextOrientation, mpu);
  return {
    ...placement,
    orientation: nextOrientation,
    x: cx - next.w / 2,
    y: cy - next.h / 2,
  };
}

export function rotatePanels(
  placements: StudioPanelPlacement[],
  panelIds: ReadonlySet<string>,
  spec: PanelModuleSpec,
  metersPerUnit: number
): StudioPanelPlacement[] {
  if (panelIds.size === 0) return placements;
  return placements.map((p) =>
    panelIds.has(p.id) ? rotatePanelInPlace(p, spec, metersPerUnit) : p
  );
}

export function removePanels(
  placements: StudioPanelPlacement[],
  panelIds: ReadonlySet<string>
): StudioPanelPlacement[] {
  if (panelIds.size === 0) return placements;
  return placements.filter((p) => !panelIds.has(p.id));
}

export function duplicatePanels(
  placements: StudioPanelPlacement[],
  panelIds: ReadonlySet<string>,
  offsetX = PANEL_DUPLICATE_OFFSET_UNITS,
  offsetY = PANEL_DUPLICATE_OFFSET_UNITS
): StudioPanelPlacement[] {
  if (panelIds.size === 0) return placements;
  const clones = placements
    .filter((p) => panelIds.has(p.id))
    .map((p) => ({
      ...p,
      id: nextStudioId("panel"),
      x: p.x + offsetX,
      y: p.y + offsetY,
    }));
  return [...placements, ...clones];
}

export function copyPanelsToClipboard(
  placements: StudioPanelPlacement[],
  panelIds: ReadonlySet<string>
): PanelClipboardItem[] {
  return placements
    .filter((p) => panelIds.has(p.id))
    .map(({ id: _id, ...rest }) => ({ ...rest }));
}

export function pastePanelsFromClipboard(
  clipboard: PanelClipboardItem[],
  planeId: string,
  anchor: Point2D
): StudioPanelPlacement[] {
  if (clipboard.length === 0) return [];
  const bounds = clipboard.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      minY: Math.min(acc.minY, p.y),
    }),
    { minX: Infinity, minY: Infinity }
  );
  const dx = anchor.x - bounds.minX;
  const dy = anchor.y - bounds.minY;
  return clipboard.map((item) => ({
    ...item,
    id: nextStudioId("panel"),
    planeId,
    x: item.x + dx,
    y: item.y + dy,
  }));
}

export function normalizeWorldRect(a: Point2D, b: Point2D): WorldRect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function rectIntersectsAabb(rect: WorldRect, box: PanelAabb): boolean {
  return (
    box.x < rect.maxX &&
    box.x + box.w > rect.minX &&
    box.y < rect.maxY &&
    box.y + box.h > rect.minY
  );
}

export function panelIdsInWorldRect(
  placements: StudioPanelPlacement[],
  spec: PanelModuleSpec,
  metersPerUnit: number,
  rect: WorldRect
): string[] {
  const mpu = requireValidScale(metersPerUnit);
  return placements
    .filter((p) => rectIntersectsAabb(rect, placementAabb(p, spec, mpu)))
    .map((p) => p.id);
}

export function togglePanelIdSelection(selectedIds: string[], panelId: string): string[] {
  return selectedIds.includes(panelId) ? selectedIds.filter((id) => id !== panelId) : [...selectedIds, panelId];
}

export interface PanelDragSession {
  panelIds: string[];
  offsets: Map<string, { offsetX: number; offsetY: number }>;
}

export function beginPanelDragSession(
  placements: StudioPanelPlacement[],
  primaryPanelId: string,
  selectedIds: string[],
  world: Point2D
): PanelDragSession {
  const dragIds = selectedIds.includes(primaryPanelId) ? selectedIds : [primaryPanelId];
  const offsets = new Map<string, { offsetX: number; offsetY: number }>();
  for (const id of dragIds) {
    const p = placements.find((pl) => pl.id === id);
    if (!p) continue;
    offsets.set(id, { offsetX: world.x - p.x, offsetY: world.y - p.y });
  }
  return { panelIds: [...offsets.keys()], offsets };
}

export function resolvePanelDragPlacements(
  session: PanelDragSession,
  placements: StudioPanelPlacement[],
  world: Point2D,
  plane: StudioPlane,
  spec: PanelModuleSpec,
  metersPerUnit: number
): { placements: StudioPanelPlacement[]; collidingIds: Set<string> } {
  const dragIds = new Set(session.panelIds);
  const positions = new Map<string, { x: number; y: number }>();
  const collidingIds = new Set<string>();

  for (const id of session.panelIds) {
    const offset = session.offsets.get(id);
    const current = placements.find((p) => p.id === id);
    if (!offset || !current) continue;
    let x = world.x - offset.offsetX;
    let y = world.y - offset.offsetY;
    const snapped = snapPanelPosition(x, y, current, plane, placements, spec, metersPerUnit, dragIds);
    x = snapped.x;
    y = snapped.y;
    positions.set(id, { x, y });
  }

  const next = setPanelPositions(placements, positions);
  for (const id of session.panelIds) {
    const p = next.find((pl) => pl.id === id);
    if (!p) continue;
    const feedback = evaluatePanelCollision(p, next, plane, spec, metersPerUnit, dragIds);
    if (feedback.colliding) collidingIds.add(id);
  }
  return { placements: next, collidingIds };
}

/** True when point is inside polygon (for plane hit fallback). */
export function pointInsidePlane(point: Point2D, boundary: Point2D[]): boolean {
  return boundary.length >= 3 && pointInPolygon(point, boundary);
}
