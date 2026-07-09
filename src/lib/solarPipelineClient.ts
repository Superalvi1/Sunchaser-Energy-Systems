/**
 * Frontend adapter — Proposal Studio uses the unified Solar Design Pipeline.
 * Draft-only. No routes, save, PDF, AI, API, or CRM mutation.
 *
 * This module must NOT call layoutPanels, panelCountForSystem, or any local sizing logic.
 * All sizing, layout, BOQ, pricing, and simulation come from runSolarDesignPipeline only.
 */

import { runSolarDesignPipeline } from "../../server/solar/pipeline/SolarDesignPipeline.ts";
import type {
  SolarDesignPipelineInput,
  SolarDesignPipelineOutcome,
} from "../../server/solar/pipeline/SolarPipelineModels.ts";
import type { PanelPlacement } from "../../server/solar/proposal/PanelLayoutEngine.ts";
import type { ProposalDraft, ProposalInputSummary } from "../../server/solar/proposal/SolarProposalModels.ts";
import { polygonArea, type DesignPoint } from "./solarDesignStudio.ts";
import { DESIGN_INCOMPLETE_MESSAGE } from "./solarDesignStudio.ts";
import type { ProposalPreviewPage } from "./solarDesignStudio.ts";
import {
  buildIncompleteStudioPages,
  buildStudioProposalPages,
  flattenBoqSections,
  type StudioBoqPreviewLine,
  type StudioCanvasInput,
  type StudioPanelCell,
  type StudioProposalViewModel,
} from "./solarProposalStudioClient.ts";

export type { StudioCanvasInput, StudioPanelCell, StudioBoqPreviewLine, StudioProposalViewModel };
export { flattenBoqSections, buildIncompleteStudioPages };

const ALLOWED_INPUT_SUMMARY_KEYS = new Set([
  "systemSizeKw",
  "tier",
  "systemType",
  "structureType",
  "panelWattage",
  "siteComplexityScore",
]);

function toPipelineInput(input: StudioCanvasInput): SolarDesignPipelineInput {
  return {
    systemSizeKw: input.targetSystemKw,
    tier: input.packageTier,
    systemType: input.systemType,
    structureType: input.structureType,
    panelWattage: input.panelWattage,
    roofBoundary: input.roofBoundary,
    obstacles: input.obstacles,
    roofWidthMeters: input.roofWidthMeters,
    canvasWidth: input.canvasWidth,
    canvasHeight: input.canvasHeight,
    siteComplexityScore: input.siteComplexityScore ?? 0,
  };
}

function roofAreaM2FromBoundary(boundary: DesignPoint[], roofWidthMeters: number, canvasWidth: number): number {
  if (boundary.length < 3 || roofWidthMeters <= 0 || canvasWidth <= 0) return 0;
  const metersPerPixel = roofWidthMeters / canvasWidth;
  return Math.round(polygonArea(boundary) * metersPerPixel * metersPerPixel * 10) / 10;
}

function mapPanelCellsFromPipeline(placements: PanelPlacement[]): StudioPanelCell[] {
  return placements.map((p) => ({
    id: `panel-${p.row}-${p.col}`,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    row: p.row,
    col: p.col,
  }));
}

function buildFixGuidance(outcome: Extract<SolarDesignPipelineOutcome, { success: false }>): string[] {
  const lines: string[] = [];
  switch (outcome.stage) {
    case "validation":
      lines.push("Fix input validation issues before the pipeline can run.");
      if (outcome.code === "INVALID_CANVAS_GEOMETRY") {
        lines.push("Check roof boundary vertices and obstacle coordinates for invalid numbers.");
      }
      break;
    case "roof":
      lines.push("Correct roof geometry — boundary must be a valid closed polygon without self-intersection.");
      break;
    case "layout":
      lines.push("Enlarge the roof boundary, reduce obstacles, or choose a smaller system size.");
      break;
    case "simulation":
      lines.push("Review simulation inputs (module, inverter, site, or finance overrides).");
      break;
    case "electrical":
    case "boq":
    case "pricing":
    case "proposal":
      lines.push("Engine configuration produced invalid electrical, BOQ, or pricing output.");
      break;
    default:
      lines.push("Resolve the reported pipeline error and try again.");
  }
  lines.push(outcome.message);
  return lines;
}

function emptyViewModel(roofAreaM2: number): StudioProposalViewModel {
  return {
    draftOnly: true,
    pipelineSuccess: false,
    pipelineStage: null,
    pipelineCode: null,
    pipelineMessage: null,
    stagesCompleted: [],
    designComplete: false,
    validationMessage: null,
    roofValidationOk: false,
    fixGuidance: [],
    roofAreaM2,
    usableAreaM2: 0,
    panelCells: [],
    panelCount: 0,
    systemSizeKw: 0,
    monthlyProduction: [],
    annualProductionKwh: 0,
    performanceRatio: 0,
    lossBreakdown: null,
    stringSizing: null,
    cableLossKwh: 0,
    clippingLossKwh: 0,
    cableDistanceM: 0,
    cableRolls: 0,
    structureCost: 0,
    marginPercent: 0,
    grandTotal: 0,
    boqSections: [],
    boqPreviewLines: [],
    proposalPages: buildIncompleteStudioPages(),
    warnings: [],
    assumptions: [],
    engineeringAssumptions: [],
    template: null,
    inputSummary: null,
  };
}

export function assertPipelineStudioOutputSafe(
  summary: ProposalInputSummary | null,
  forbiddenFragments: string[] = []
): boolean {
  if (!summary) return true;
  const keys = Object.keys(summary);
  if (!keys.every((k) => ALLOWED_INPUT_SUMMARY_KEYS.has(k))) return false;
  const blob = JSON.stringify(summary);
  return forbiddenFragments.every((f) => !blob.includes(f));
}

function validationMessageForOutcome(
  input: StudioCanvasInput,
  outcome: Extract<SolarDesignPipelineOutcome, { success: false }>
): string {
  if (input.roofBoundary.length < 3 && outcome.stage === "validation") {
    return DESIGN_INCOMPLETE_MESSAGE;
  }
  return outcome.message;
}

export function buildPipelineStudioViewModel(input: StudioCanvasInput): StudioProposalViewModel {
  const roofAreaM2 = roofAreaM2FromBoundary(input.roofBoundary, input.roofWidthMeters, input.canvasWidth);
  const empty = emptyViewModel(roofAreaM2);

  const outcome = runSolarDesignPipeline(toPipelineInput(input));

  if (!outcome.success) {
    const validationMessage = validationMessageForOutcome(input, outcome);
    return {
      ...empty,
      pipelineStage: outcome.stage,
      pipelineCode: outcome.code,
      pipelineMessage: outcome.message,
      stagesCompleted: outcome.stagesCompleted,
      validationMessage,
      roofValidationOk: outcome.stage !== "validation" && outcome.stage !== "roof",
      fixGuidance:
        input.roofBoundary.length < 3 && outcome.stage === "validation"
          ? [DESIGN_INCOMPLETE_MESSAGE]
          : buildFixGuidance(outcome),
      warnings: outcome.warnings,
    };
  }

  const result = outcome.result;
  const draft = result.draft;
  const template = result.template;
  const layout = result.panelLayout;
  const simulation = result.simulation;

  const draftForPages: ProposalDraft = {
    generatedAt: draft.generatedAt,
    inputSummary: draft.inputSummary,
    panelCount: draft.panelCount,
    systemSizeKw: draft.systemSizeKw,
    cableDistanceM: draft.cableDistanceM,
    cableRolls: draft.cableRolls,
    structureCost: draft.structureCost,
    sections: draft.sections,
    pricing: draft.pricing,
    assumptions: draft.assumptions,
    warnings: draft.warnings,
  };

  if (!assertPipelineStudioOutputSafe(draft.inputSummary)) {
    return {
      ...empty,
      pipelineStage: "validation",
      pipelineCode: "UNSAFE_OUTPUT",
      pipelineMessage: "Pipeline output failed studio safety checks.",
      validationMessage: "Pipeline output failed studio safety checks.",
      fixGuidance: ["Remove any non-engineering fields from the studio input."],
    };
  }

  const proposalPages = buildStudioProposalPages(
    draftForPages,
    template,
    input.roofWidthMeters,
    input.roofDepthMeters,
    layout.usableAreaM2,
    roofAreaM2
  );

  const productionPage: ProposalPreviewPage = {
    id: "production",
    title: "Energy Production",
    subtitle: "8760-hour simulation (pipeline)",
    sections: [
      {
        heading: "Annual yield",
        lines: [
          `Annual AC production: ${simulation.annualAcKwh.toLocaleString()} kWh`,
          `Performance ratio: ${(simulation.performanceRatio * 100).toFixed(1)}%`,
          `Specific yield: ${simulation.specificYieldKwhPerKwp.toLocaleString()} kWh/kWp`,
        ],
      },
      {
        heading: "Monthly AC (kWh)",
        lines: simulation.monthly.map((m) => `${m.label}: ${m.acKwh.toLocaleString()}`),
      },
      {
        heading: "Losses (kWh/year)",
        lines: [
          `Shading: ${simulation.losses.shadingKwh.toLocaleString()}`,
          `Temperature: ${simulation.losses.temperatureKwh.toLocaleString()}`,
          `Inverter clipping: ${simulation.losses.inverterClippingKwh.toLocaleString()}`,
          `Cable: ${simulation.losses.cableKwh.toLocaleString()}`,
          `System availability: ${simulation.losses.systemAvailabilityKwh.toLocaleString()}`,
        ],
      },
    ],
  };

  return {
    draftOnly: true,
    pipelineSuccess: true,
    pipelineStage: "proposal",
    pipelineCode: null,
    pipelineMessage: null,
    stagesCompleted: result.stagesCompleted,
    designComplete: true,
    validationMessage: null,
    roofValidationOk: true,
    fixGuidance: [],
    roofAreaM2,
    usableAreaM2: layout.usableAreaM2,
    panelCells: mapPanelCellsFromPipeline(layout.placedPanels),
    panelCount: draft.panelCount,
    systemSizeKw: draft.systemSizeKw,
    monthlyProduction: simulation.monthly,
    annualProductionKwh: simulation.annualAcKwh,
    performanceRatio: simulation.performanceRatio,
    lossBreakdown: simulation.losses,
    stringSizing: simulation.stringSizing,
    cableLossKwh: simulation.cable.annualCableLossKwh,
    clippingLossKwh: simulation.clippingLossKwh,
    cableDistanceM: draft.cableDistanceM,
    cableRolls: draft.cableRolls,
    structureCost: draft.structureCost,
    marginPercent: draft.pricing.marginPercent,
    grandTotal: draft.pricing.grandTotal,
    boqSections: draft.sections,
    boqPreviewLines: flattenBoqSections(draft.sections),
    proposalPages: [...proposalPages.slice(0, 2), productionPage, ...proposalPages.slice(2)],
    warnings: [...result.warnings, ...layout.warnings],
    assumptions: draft.assumptions,
    engineeringAssumptions: result.engineeringAssumptions,
    template,
    inputSummary: draft.inputSummary,
  };
}
