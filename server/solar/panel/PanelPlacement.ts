/**
 * Panel placement helpers — build PlacedPanel records and DC capacity.
 */

import { round4 } from "../roof/RoofModels.ts";
import type { PanelModuleSpec, PanelOrientation, PlacedPanel } from "./PanelLayoutModels.ts";
import { panelFootprintUnits } from "./PanelGeometry.ts";

let panelSeq = 0;

export function resetPanelIdSequence(): void {
  panelSeq = 0;
}

export function nextPanelId(prefix = "panel"): string {
  panelSeq += 1;
  return `${prefix}-${panelSeq}`;
}

export function createPlacedPanel(opts: {
  planeId: string;
  x: number;
  y: number;
  orientation: PanelOrientation;
  row: number;
  column: number;
  module: PanelModuleSpec;
  metersPerUnit: number;
  panelId?: string;
}): PlacedPanel {
  const fp = panelFootprintUnits(opts.module, opts.orientation, opts.metersPerUnit);
  return {
    panelId: opts.panelId ?? nextPanelId(),
    planeId: opts.planeId,
    x: opts.x,
    y: opts.y,
    widthUnits: fp.widthUnits,
    heightUnits: fp.heightUnits,
    orientation: opts.orientation,
    row: opts.row,
    column: opts.column,
    wattage: opts.module.wattage,
  };
}

export function dcCapacityKw(panels: PlacedPanel[]): number {
  const watts = panels.reduce((s, p) => s + p.wattage, 0);
  return round4(watts / 1000);
}

export function coveredAreaM2(panels: PlacedPanel[], metersPerUnit: number): number {
  const mpu2 = metersPerUnit * metersPerUnit;
  let units = 0;
  for (const p of panels) units += p.widthUnits * p.heightUnits;
  return round4(units * mpu2);
}
