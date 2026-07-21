/**
 * Deterministic panel packing solver.
 * Maximizes installed DC capacity (wattage × count for a fixed module),
 * not panel count across different modules.
 *
 * Orientation policies: portrait_only | landscape_only | auto.
 * mixed is declared but throws MIXED_NOT_IMPLEMENTED.
 */

import type { Point2D } from "../roof/RoofModels.ts";
import { insetPolygonTowardCentroid, polygonArea, polygonBounds } from "../roof/RoofPolygon.ts";
import { metersToUnits, requireValidMetersPerUnit } from "../roof/RoofMeasurement.ts";
import { ROOF_EPSILON, round4, isFinitePoint } from "../roof/RoofModels.ts";
import {
  PANEL_ORIENTATION_POLICIES,
  PanelLayoutError,
  type PanelLayoutConstraints,
  type PanelModuleSpec,
  type PanelOrientation,
  type PanelOrientationPolicy,
  type PlacedPanel,
  type UnusedRegion,
} from "./PanelLayoutModels.ts";
import { panelFootprintUnits, spacingUnits } from "./PanelGeometry.ts";
import {
  panelIntersectsAabbObstacles,
  panelOutsideUsablePolygon,
  expandPolygonBoundsAsAabb,
  type Aabb,
} from "./PanelCollision.ts";
import { createPlacedPanel, resetPanelIdSequence } from "./PanelPlacement.ts";
import { effectiveEdgeInsetM } from "./PanelConstraints.ts";
import type { RoofSetbackConfig } from "../roof/RoofModels.ts";

export interface PackingContext {
  planeId: string;
  boundary: Point2D[];
  metersPerUnit: number;
  module: PanelModuleSpec;
  constraints: PanelLayoutConstraints;
  setbacks: RoofSetbackConfig;
  obstaclePolygons: Point2D[][];
  walkwayPolygons: Point2D[][];
  hasParapet: boolean;
}

export interface PackingAttempt {
  orientation: PanelOrientation;
  panels: PlacedPanel[];
  usablePolygon: Point2D[];
  usableAreaM2: number;
  unusedRegions: UnusedRegion[];
}

function buildExclusionAabbs(
  polygons: Point2D[][],
  clearanceUnits: number
): Aabb[] {
  const out: Aabb[] = [];
  for (const poly of polygons) {
    const aabb = expandPolygonBoundsAsAabb(poly, clearanceUnits);
    if (aabb && aabb.w > 0 && aabb.h > 0) out.push(aabb);
  }
  return out;
}

function packGrid(
  ctx: PackingContext,
  orientation: PanelOrientation,
  usable: Point2D[]
): { panels: PlacedPanel[]; unusedRegions: UnusedRegion[] } {
  const mpu = ctx.metersPerUnit;
  const fp = panelFootprintUnits(ctx.module, orientation, mpu);
  const gapU = spacingUnits(ctx.constraints.spacing.gapM, mpu);
  const rowGapU = spacingUnits(ctx.constraints.spacing.rowSpacingM, mpu);
  const structureClearU = metersToUnits(
    Math.max(ctx.constraints.spacing.structureClearanceM, ctx.setbacks.obstacleClearanceM),
    mpu
  );

  const exclusions = [
    ...buildExclusionAabbs(ctx.obstaclePolygons, structureClearU),
    ...buildExclusionAabbs(ctx.walkwayPolygons, 0),
  ];

  const bounds = polygonBounds(usable);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { panels: [], unusedRegions: [] };
  }

  const stepX = fp.widthUnits + gapU;
  const stepY = fp.heightUnits + rowGapU;
  const panels: PlacedPanel[] = [];
  let row = 0;

  for (let y = bounds.minY; y + fp.heightUnits <= bounds.maxY + ROOF_EPSILON; y += stepY) {
    let col = 0;
    for (let x = bounds.minX; x + fp.widthUnits <= bounds.maxX + ROOF_EPSILON; x += stepX) {
      if (panelOutsideUsablePolygon(usable, x, y, fp.widthUnits, fp.heightUnits)) {
        col += 1;
        continue;
      }
      if (panelIntersectsAabbObstacles(exclusions, x, y, fp.widthUnits, fp.heightUnits)) {
        col += 1;
        continue;
      }
      // Exact panel-panel: grid steps guarantee no overlap when step >= size+gap
      panels.push(
        createPlacedPanel({
          planeId: ctx.planeId,
          x,
          y,
          orientation,
          row,
          column: col,
          module: ctx.module,
          metersPerUnit: mpu,
        })
      );
      col += 1;
    }
    row += 1;
  }

  const unusedRegions = computeUnusedRegions(bounds, fp, gapU, rowGapU, panels, mpu);
  return { panels, unusedRegions };
}

function computeUnusedRegions(
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number },
  fp: { widthUnits: number; heightUnits: number },
  gapU: number,
  rowGapU: number,
  panels: PlacedPanel[],
  metersPerUnit: number
): UnusedRegion[] {
  const regions: UnusedRegion[] = [];
  const stepX = fp.widthUnits + gapU;
  const stepY = fp.heightUnits + rowGapU;
  const occupied = new Set(panels.map((p) => `${p.row}:${p.column}`));

  let row = 0;
  for (let y = bounds.minY; y + fp.heightUnits <= bounds.maxY + ROOF_EPSILON; y += stepY) {
    let col = 0;
    for (let x = bounds.minX; x + fp.widthUnits <= bounds.maxX + ROOF_EPSILON; x += stepX) {
      const key = `${row}:${col}`;
      if (!occupied.has(key)) {
        const areaM2 = round4(fp.widthUnits * fp.heightUnits * metersPerUnit * metersPerUnit);
        regions.push({
          regionId: `unused-r${row}-c${col}`,
          x,
          y,
          widthUnits: fp.widthUnits,
          heightUnits: fp.heightUnits,
          areaM2,
        });
      }
      col += 1;
    }
    // Right remnant strip in this row band
    const usedWidth = Math.floor((bounds.width + gapU) / stepX) * stepX - gapU;
    const remW = bounds.maxX - (bounds.minX + Math.max(0, usedWidth));
    if (remW > ROOF_EPSILON) {
      regions.push({
        regionId: `unused-rem-r${row}`,
        x: bounds.minX + Math.max(0, usedWidth + gapU),
        y,
        widthUnits: remW,
        heightUnits: fp.heightUnits,
        areaM2: round4(remW * fp.heightUnits * metersPerUnit * metersPerUnit),
      });
    }
    row += 1;
  }

  const usedHeight = Math.floor((bounds.height + rowGapU) / stepY) * stepY - rowGapU;
  const remH = bounds.maxY - (bounds.minY + Math.max(0, usedHeight));
  if (remH > ROOF_EPSILON) {
    regions.push({
      regionId: "unused-bottom",
      x: bounds.minX,
      y: bounds.minY + Math.max(0, usedHeight + rowGapU),
      widthUnits: bounds.width,
      heightUnits: remH,
      areaM2: round4(bounds.width * remH * metersPerUnit * metersPerUnit),
    });
  }

  return regions;
}

function buildUsablePolygon(ctx: PackingContext): Point2D[] {
  const mpu = requireValidMetersPerUnit(ctx.metersPerUnit);
  const insetM = effectiveEdgeInsetM(ctx.setbacks, ctx.constraints.spacing, ctx.hasParapet);
  const insetU = metersToUnits(insetM, mpu);
  const inset = insetPolygonTowardCentroid(ctx.boundary, insetU);
  if (inset.length < 3 || polygonArea(inset) < ROOF_EPSILON) {
    throw new PanelLayoutError("NO_USABLE_AREA", "Usable polygon after setbacks has zero area.");
  }
  for (let i = 0; i < inset.length; i += 1) {
    if (!isFinitePoint(inset[i])) {
      throw new PanelLayoutError(
        "NON_FINITE",
        `Usable polygon vertex[${i}] is non-finite after setback inset.`
      );
    }
  }
  return inset;
}

function attemptOrientation(ctx: PackingContext, orientation: PanelOrientation): PackingAttempt {
  const usable = buildUsablePolygon(ctx);
  const usableAreaM2 = round4(polygonArea(usable) * ctx.metersPerUnit * ctx.metersPerUnit);
  const { panels, unusedRegions } = packGrid(ctx, orientation, usable);
  return { orientation, panels, usablePolygon: usable, usableAreaM2, unusedRegions };
}

function dcWatts(panels: PlacedPanel[]): number {
  return panels.reduce((s, p) => s + p.wattage, 0);
}

/**
 * Pack panels for one orientation policy.
 * Auto picks the orientation with higher DC watts (ties → portrait).
 */
export function solvePanelPacking(
  ctx: PackingContext,
  policy: PanelOrientationPolicy
): PackingAttempt {
  resetPanelIdSequence();

  if (typeof policy !== "string" || !(PANEL_ORIENTATION_POLICIES as readonly string[]).includes(policy)) {
    throw new PanelLayoutError(
      "INVALID_ORIENTATION_POLICY",
      `orientationPolicy must be one of: ${PANEL_ORIENTATION_POLICIES.join(", ")}.`
    );
  }

  if (policy === "mixed") {
    throw new PanelLayoutError(
      "MIXED_NOT_IMPLEMENTED",
      "Mixed orientation packing is a future interface only in Phase 3B V2."
    );
  }

  if (policy === "portrait_only") {
    return attemptOrientation(ctx, "portrait");
  }
  if (policy === "landscape_only") {
    return attemptOrientation(ctx, "landscape");
  }
  if (policy === "auto") {
    const portrait = attemptOrientation(ctx, "portrait");
    const landscape = attemptOrientation(ctx, "landscape");
    if (dcWatts(landscape.panels) > dcWatts(portrait.panels)) return landscape;
    return portrait;
  }

  throw new PanelLayoutError(
    "INVALID_ORIENTATION_POLICY",
    `orientationPolicy must be one of: ${PANEL_ORIENTATION_POLICIES.join(", ")}.`
  );
}
