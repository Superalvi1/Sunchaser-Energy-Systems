/**
 * Panel geometry — footprint in plan units.
 * Uses roof engine metersPerUnit validation and rect helpers.
 */

import type { Point2D } from "../roof/RoofModels.ts";
import { requireValidMetersPerUnit, metersToUnits } from "../roof/RoofMeasurement.ts";
import { rectFromCenter, polygonBounds } from "../roof/RoofPolygon.ts";
import type { PanelModuleSpec, PanelOrientation } from "./PanelLayoutModels.ts";
import { validatePanelModule } from "./PanelCatalog.ts";

export interface PanelFootprintUnits {
  widthUnits: number;
  heightUnits: number;
}

/** Portrait: short edge horizontal; landscape: long edge horizontal. */
export function panelFootprintUnits(
  module: PanelModuleSpec,
  orientation: PanelOrientation,
  metersPerUnit: number
): PanelFootprintUnits {
  validatePanelModule(module);
  const mpu = requireValidMetersPerUnit(metersPerUnit);
  const shortU = metersToUnits(module.widthM, mpu);
  const longU = metersToUnits(module.heightM, mpu);
  if (orientation === "portrait") {
    return { widthUnits: shortU, heightUnits: longU };
  }
  return { widthUnits: longU, heightUnits: shortU };
}

export function panelPolygonFromTopLeft(
  x: number,
  y: number,
  widthUnits: number,
  heightUnits: number
): Point2D[] {
  return [
    { x, y },
    { x: x + widthUnits, y },
    { x: x + widthUnits, y: y + heightUnits },
    { x, y: y + heightUnits },
  ];
}

export function panelPolygonFromCenter(
  cx: number,
  cy: number,
  widthUnits: number,
  heightUnits: number
): Point2D[] {
  return rectFromCenter(cx, cy, widthUnits, heightUnits);
}

export function panelAreaM2(module: PanelModuleSpec): number {
  validatePanelModule(module);
  return module.widthM * module.heightM;
}

export function spacingUnits(gapM: number, metersPerUnit: number): number {
  return metersToUnits(gapM, requireValidMetersPerUnit(metersPerUnit));
}

export function boundsOfPanels(
  panels: Array<{ x: number; y: number; widthUnits: number; heightUnits: number }>
): ReturnType<typeof polygonBounds> {
  if (panels.length === 0) return null;
  const verts: Point2D[] = [];
  for (const p of panels) {
    verts.push(...panelPolygonFromTopLeft(p.x, p.y, p.widthUnits, p.heightUnits));
  }
  return polygonBounds(verts);
}
