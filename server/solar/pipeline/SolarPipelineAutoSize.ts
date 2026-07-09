/**
 * Pipeline auto-size resolution — largest supported system that fits roof layout.
 * Runs inside server/solar/pipeline only; Proposal Studio must not duplicate this logic.
 */

import { layoutPanels } from "../proposal/PanelLayoutEngine.ts";
import { panelCountForSystem } from "../proposal/SolarDesignRules.ts";
import type { RoofObstacle, RoofPoint, SupportedSystemSizeKw } from "../proposal/SolarProposalModels.ts";
import { SUPPORTED_SYSTEM_SIZES_KW } from "../proposal/SolarProposalModels.ts";
import { SolarPipelineStageError } from "./SolarPipelineModels.ts";
import type { SolarDesignPipelineInput } from "./SolarPipelineModels.ts";

const PROBE_MAX_KW = 15 as SupportedSystemSizeKw;

function sizesDescending(): SupportedSystemSizeKw[] {
  return [...SUPPORTED_SYSTEM_SIZES_KW].sort((a, b) => b - a) as SupportedSystemSizeKw[];
}

function panelCountForSystemSafe(sizeKw: SupportedSystemSizeKw, panelWattage: number): number {
  if (!Number.isFinite(panelWattage) || panelWattage <= 0) return Number.POSITIVE_INFINITY;
  return panelCountForSystem(sizeKw, panelWattage);
}

export interface PipelineAutoSizeContext {
  roofBoundary: RoofPoint[];
  obstacles: RoofObstacle[];
  roofWidthMeters?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

/**
 * Resolve explicit or auto system size using layout probe inside the pipeline.
 * @throws SolarPipelineStageError at layout stage when no size fits.
 */
export function resolvePipelineSystemSizeKw(
  input: SolarDesignPipelineInput,
  panelWattage: number,
  ctx: PipelineAutoSizeContext
): SupportedSystemSizeKw {
  const maxLayout = layoutPanels({
    systemSizeKw: PROBE_MAX_KW,
    panelWattage,
    roofBoundary: ctx.roofBoundary,
    obstacles: ctx.obstacles,
    roofWidthMeters: ctx.roofWidthMeters,
    canvasWidth: ctx.canvasWidth,
    canvasHeight: ctx.canvasHeight,
  });

  if (maxLayout.placedPanels.length === 0) {
    throw new SolarPipelineStageError(
      "layout",
      "AUTO_SIZE_IMPOSSIBLE",
      "No panels could be placed on the provided roof layout."
    );
  }

  if (input.systemSizeKw !== "auto") {
    const needed = panelCountForSystemSafe(input.systemSizeKw, panelWattage);
    if (needed > maxLayout.placedPanels.length) {
      throw new SolarPipelineStageError(
        "layout",
        "LAYOUT_IMPOSSIBLE",
        "Roof layout cannot support the selected system size."
      );
    }
    return input.systemSizeKw;
  }

  for (const size of sizesDescending()) {
    const needed = panelCountForSystemSafe(size, panelWattage);
    if (needed <= maxLayout.placedPanels.length) return size;
  }

  return 3;
}
