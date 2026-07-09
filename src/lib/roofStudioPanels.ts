/**
 * Roof Studio — exact panel placement on calibrated scale.
 * Real module dimensions. No capacity estimate before calibration.
 */

import { DEFAULT_PANEL_GAP_M, DEFAULT_PANEL_HEIGHT_M, DEFAULT_PANEL_WIDTH_M } from "../../server/solar/proposal/RoofGeometry.ts";
import type { Point2D } from "../../server/solar/roof/RoofModels.ts";
import { pointInPolygon, polygonBounds } from "../../server/solar/roof/RoofPolygon.ts";
import { requireValidScale } from "./roofStudioCalibration.ts";
import type { StudioObstacle, StudioPlane } from "./roofStudioClient.ts";
import { nextStudioId } from "./roofStudioClient.ts";

export type PanelOrientation = "portrait" | "landscape";

export interface PanelModuleSpec {
  widthM: number;
  heightM: number;
  wattage: number;
  gapM: number;
  rowSpacingM: number;
  orientation: PanelOrientation;
}

export interface StudioPanelPlacement {
  id: string;
  planeId: string;
  /** Top-left corner in world units */
  x: number;
  y: number;
  orientation: PanelOrientation;
}

export const DEFAULT_PANEL_MODULE: PanelModuleSpec = {
  widthM: DEFAULT_PANEL_WIDTH_M,
  heightM: DEFAULT_PANEL_HEIGHT_M,
  wattage: 580,
  gapM: DEFAULT_PANEL_GAP_M,
  rowSpacingM: DEFAULT_PANEL_GAP_M,
  orientation: "portrait",
};

export function panelFootprintUnits(spec: PanelModuleSpec, orientation: PanelOrientation, metersPerUnit: number): {
  w: number;
  h: number;
} {
  const mpu = requireValidScale(metersPerUnit);
  const portraitW = spec.widthM / mpu;
  const portraitH = spec.heightM / mpu;
  if (orientation === "portrait") return { w: portraitW, h: portraitH };
  return { w: portraitH, h: portraitW };
}

function obstacleRects(plane: StudioPlane, metersPerUnit: number): Array<{ x: number; y: number; w: number; h: number }> {
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

function overlapsObstacle(
  x: number,
  y: number,
  w: number,
  h: number,
  obstacles: Array<{ x: number; y: number; w: number; h: number }>
): boolean {
  for (const o of obstacles) {
    if (x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y) return true;
  }
  return false;
}

function panelCornersFitBoundary(
  boundary: Point2D[],
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const corners = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return corners.every((c) => pointInPolygon(c, boundary));
}

export function autoFillPanelsOnPlane(
  plane: StudioPlane,
  spec: PanelModuleSpec,
  metersPerUnit: number,
  orientation: PanelOrientation = spec.orientation
): StudioPanelPlacement[] {
  const mpu = requireValidScale(metersPerUnit);
  const bounds = polygonBounds(plane.boundary);
  if (!bounds) return [];
  const { w: panelW, h: panelH } = panelFootprintUnits(spec, orientation, mpu);
  const gapU = spec.gapM / mpu;
  const rowGapU = spec.rowSpacingM / mpu;
  const obstacles = obstacleRects(plane, mpu);
  const placements: StudioPanelPlacement[] = [];

  const stepX = panelW + gapU;
  const stepY = panelH + rowGapU;

  for (let y = bounds.minY; y + panelH <= bounds.maxY; y += stepY) {
    for (let x = bounds.minX; x + panelW <= bounds.maxX; x += stepX) {
      if (!panelCornersFitBoundary(plane.boundary, x, y, panelW, panelH)) continue;
      if (overlapsObstacle(x, y, panelW, panelH, obstacles)) continue;
      placements.push({
        id: nextStudioId("panel"),
        planeId: plane.id,
        x,
        y,
        orientation,
      });
    }
  }
  return placements;
}

export function panelSystemKw(placements: StudioPanelPlacement[], wattage: number): number {
  return Math.round((placements.length * wattage) / 100) / 10;
}

export function movePanelPlacement(
  placements: StudioPanelPlacement[],
  panelId: string,
  x: number,
  y: number
): StudioPanelPlacement[] {
  return placements.map((p) => (p.id === panelId ? { ...p, x, y } : p));
}

export function addPanelAt(
  placements: StudioPanelPlacement[],
  planeId: string,
  x: number,
  y: number,
  orientation: PanelOrientation
): StudioPanelPlacement[] {
  return [
    ...placements,
    { id: nextStudioId("panel"), planeId, x, y, orientation },
  ];
}

export function removePanel(placements: StudioPanelPlacement[], panelId: string): StudioPanelPlacement[] {
  return placements.filter((p) => p.id !== panelId);
}

export function hitTestPanel(
  placements: StudioPanelPlacement[],
  spec: PanelModuleSpec,
  metersPerUnit: number,
  point: Point2D
): StudioPanelPlacement | null {
  const mpu = requireValidScale(metersPerUnit);
  for (let i = placements.length - 1; i >= 0; i -= 1) {
    const p = placements[i];
    const { w, h } = panelFootprintUnits(spec, p.orientation, mpu);
    if (point.x >= p.x && point.x <= p.x + w && point.y >= p.y && point.y <= p.y + h) return p;
  }
  return null;
}
