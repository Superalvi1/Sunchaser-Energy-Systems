/**
 * Panel layout report — utilization, unused regions, DC capacity summary.
 */

import { round4 } from "../roof/RoofModels.ts";
import {
  PanelLayoutError,
  type PanelLayoutResult,
  type PanelOrientation,
  type PanelOrientationPolicy,
  type PlacedPanel,
  type UnusedRegion,
} from "./PanelLayoutModels.ts";
import { PANEL_LAYOUT_TIMESTAMP } from "./PanelLayoutModels.ts";
import { coveredAreaM2, dcCapacityKw } from "./PanelPlacement.ts";

export function buildPanelLayoutReport(opts: {
  planeId: string;
  moduleId: string;
  orientationPolicy: PanelOrientationPolicy;
  orientationUsed: PanelOrientation | "none";
  panels: PlacedPanel[];
  usableAreaM2: number;
  unusedRegions: UnusedRegion[];
  metersPerUnit: number;
  warnings?: string[];
  generatedAt?: string;
}): PanelLayoutResult {
  const covered = coveredAreaM2(opts.panels, opts.metersPerUnit);
  const utilizationPct =
    opts.usableAreaM2 > 0 ? round4((covered / opts.usableAreaM2) * 100) : 0;

  return {
    generatedAt: opts.generatedAt ?? PANEL_LAYOUT_TIMESTAMP,
    planeId: opts.planeId,
    moduleId: opts.moduleId,
    orientationPolicy: opts.orientationPolicy,
    orientationUsed: opts.orientationUsed,
    panels: opts.panels.map((p) => ({ ...p })),
    panelCount: opts.panels.length,
    dcCapacityKw: dcCapacityKw(opts.panels),
    usableAreaM2: round4(opts.usableAreaM2),
    coveredAreaM2: covered,
    utilizationPct,
    unusedRegions: opts.unusedRegions.map((r) => ({ ...r })),
    warnings: [...(opts.warnings ?? [])],
  };
}

/** Recursively assert every number in a successful layout result is finite. */
export function assertFiniteLayoutResult(value: unknown, path = "result"): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PanelLayoutError(
        "NON_FINITE",
        `${path} must be finite (got ${String(value)}).`
      );
    }
    return;
  }
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertFiniteLayoutResult(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertFiniteLayoutResult(child, `${path}.${key}`);
    }
  }
}
