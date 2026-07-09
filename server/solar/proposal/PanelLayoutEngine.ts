/**
 * Deterministic panel grid layout on roof boundary.
 */

import { DEFAULT_PANEL_GAP_M, DEFAULT_PANEL_HEIGHT_M, DEFAULT_PANEL_WIDTH_M, defaultRoofBoundary, estimateUsableRoofAreaM2, polygonBounds, pointInPolygon, rectOverlapsObstacle } from "./RoofGeometry.ts";
import { panelCountForSystem } from "./SolarDesignRules.ts";
import type { RoofObstacle, RoofPoint, SupportedSystemSizeKw } from "./SolarProposalModels.ts";

export interface PanelPlacement {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelLayoutResult {
  requiredPanels: number;
  placedPanels: PanelPlacement[];
  unplacedPanels: number;
  fitsOnRoof: boolean;
  usableAreaM2: number;
  warnings: string[];
}

export interface PanelLayoutInput {
  systemSizeKw: SupportedSystemSizeKw;
  panelWattage?: number;
  roofBoundary?: RoofPoint[];
  obstacles?: RoofObstacle[];
  roofWidthMeters?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

export function layoutPanels(input: PanelLayoutInput): PanelLayoutResult {
  const canvasWidth = input.canvasWidth ?? 800;
  const canvasHeight = input.canvasHeight ?? 500;
  const boundary = input.roofBoundary?.length ? input.roofBoundary : defaultRoofBoundary(canvasWidth, canvasHeight);
  const obstacles = input.obstacles ?? [];
  const roofWidthMeters = input.roofWidthMeters ?? 12;
  const requiredPanels = panelCountForSystem(input.systemSizeKw, input.panelWattage);
  const bounds = polygonBounds(boundary);
  const warnings: string[] = [];

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return {
      requiredPanels,
      placedPanels: [],
      unplacedPanels: requiredPanels,
      fitsOnRoof: false,
      usableAreaM2: 0,
      warnings: ["Invalid roof boundary."],
    };
  }

  const scale = roofWidthMeters / bounds.width;
  const panelW = DEFAULT_PANEL_WIDTH_M / scale;
  const panelH = DEFAULT_PANEL_HEIGHT_M / scale;
  const gap = DEFAULT_PANEL_GAP_M / scale;
  const cols = Math.max(1, Math.floor((bounds.width + gap) / (panelW + gap)));
  const rows = Math.max(1, Math.floor((bounds.height + gap) / (panelH + gap)));
  const placed: PanelPlacement[] = [];

  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (placed.length >= requiredPanels) break outer;
      const x = bounds.minX + c * (panelW + gap);
      const y = bounds.minY + r * (panelH + gap);
      const corners: RoofPoint[] = [
        { x, y },
        { x: x + panelW, y },
        { x: x + panelW, y: y + panelH },
        { x, y: y + panelH },
      ];
      if (!corners.every((pt) => pointInPolygon(pt, boundary))) continue;
      if (rectOverlapsObstacle(x, y, panelW, panelH, obstacles)) continue;
      placed.push({
        index: placed.length + 1,
        row: r,
        col: c,
        x,
        y,
        width: panelW,
        height: panelH,
      });
    }
  }

  const unplaced = requiredPanels - placed.length;
  if (unplaced > 0) warnings.push(`${unplaced} panel(s) could not fit on drawn roof layout.`);

  const usableAreaM2 = estimateUsableRoofAreaM2(boundary, obstacles, canvasWidth, roofWidthMeters);

  return {
    requiredPanels,
    placedPanels: placed,
    unplacedPanels: unplaced,
    fitsOnRoof: unplaced === 0,
    usableAreaM2,
    warnings,
  };
}
