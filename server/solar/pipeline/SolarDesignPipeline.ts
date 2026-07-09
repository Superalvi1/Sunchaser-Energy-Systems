/**
 * Solar Design Pipeline — unified draft-only orchestrator.
 * Chains existing deterministic engines in strict order without duplicating calculations.
 */

import { analyzeRoofSite } from "../roof/RoofGeometryEngine.ts";
import { RoofGeometryError } from "../roof/RoofModels.ts";
import type { ObstacleDef, RoofPlaneInput } from "../roof/RoofModels.ts";
import { assertBoqSectionOrder, buildBoq } from "../proposal/BoqGenerator.ts";
import { calculateCables } from "../proposal/CableCalculator.ts";
import { calculateProtection } from "../proposal/ProtectionCalculator.ts";
import { layoutPanels } from "../proposal/PanelLayoutEngine.ts";
import { buildPricingSummary } from "../proposal/PricingEngine.ts";
import { buildProposalTemplate } from "../proposal/ProposalTemplateModel.ts";
import { calculateStructure } from "../proposal/StructureCalculator.ts";
import { DEFAULT_PANEL_WATTAGE, structureLabel, systemTypeLabel, tierLabel } from "../proposal/SolarDesignRules.ts";
import { resolveEquipmentBundle } from "../proposal/SolarProductCatalog.ts";
import {
  SolarProposalError,
  validateAndNormalizeSolarProposalInput,
  type RoofObstacle,
  type RoofPoint,
  type SolarProposalInput,
} from "../proposal/SolarProposalModels.ts";
import { runSolarSimulation } from "../simulation/SolarSimulationEngine.ts";
import { SolarSimulationValidationError } from "../simulation/SolarSimulationModels.ts";
import type {
  ElectricalSizingResult,
  SolarDesignPipelineDraft,
  SolarDesignPipelineInput,
  SolarDesignPipelineOutcome,
  SolarDesignPipelineResult,
  SolarPipelineStage,
} from "./SolarPipelineModels.ts";
import { PIPELINE_ENGINE_TIMESTAMP } from "./SolarPipelineModels.ts";
import { assertPipelineResultFinite, pipelineFailure, pipelineSuccess } from "./SolarPipelineResult.ts";
import {
  layoutStageWarnings,
  layoutValidationMessages,
  mergePipelineWarnings,
  roofStageWarnings,
  simulationStageWarnings,
} from "./SolarPipelineWarnings.ts";
import { resolvePipelineSystemSizeKw } from "./SolarPipelineAutoSize.ts";
import { validateSolarDesignPipelineInput } from "./SolarPipelineValidation.ts";
import { SolarPipelineStageError, SolarPipelineValidationError } from "./SolarPipelineModels.ts";
import type { SupportedSystemSizeKw } from "../proposal/SolarProposalModels.ts";

function primaryRoofPlane(planes: RoofPlaneInput[]): RoofPlaneInput {
  if (planes.length === 1) return planes[0];
  let best = planes[0];
  let bestArea = 0;
  for (const p of planes) {
    const xs = p.boundary.map((v) => v.x);
    const ys = p.boundary.map((v) => v.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) {
      bestArea = area;
      best = p;
    }
  }
  return best;
}

function obstacleDefToCanvasObstacle(o: ObstacleDef, index: number): RoofObstacle {
  const xs = o.polygon.map((p) => p.x);
  const ys = o.polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    id: o.id || `obs_${index}`,
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX,
    h: Math.max(...ys) - minY,
  };
}

function roofPlaneToCanvas(plane: RoofPlaneInput): { boundary: RoofPoint[]; obstacles: RoofObstacle[] } {
  return {
    boundary: plane.boundary.map((p) => ({ x: p.x, y: p.y })),
    obstacles: (plane.obstacles ?? []).map(obstacleDefToCanvasObstacle),
  };
}

function buildProposalInputFromPipeline(
  input: SolarDesignPipelineInput,
  resolvedSystemSizeKw: SupportedSystemSizeKw
): SolarProposalInput {
  const { input: normalized } = validateAndNormalizeSolarProposalInput(
    {
      systemSizeKw: resolvedSystemSizeKw,
      tier: input.tier,
      systemType: input.systemType,
      structureType: input.structureType,
      panelWattage: input.panelWattage,
      roofBoundary: input.roofBoundary,
      obstacles: input.obstacles,
      roofWidthMeters: input.roofWidthMeters,
      canvasWidth: input.canvasWidth,
      canvasHeight: input.canvasHeight,
      siteComplexityScore: input.siteComplexityScore,
      netMeteringRequired: input.netMeteringRequired,
    },
    DEFAULT_PANEL_WATTAGE
  );
  return normalized;
}

function buildElectricalSizing(
  input: SolarDesignPipelineInput,
  proposalInput: SolarProposalInput,
  simulationStringSizing: ElectricalSizingResult["stringSizing"]
): ElectricalSizingResult {
  const protection = calculateProtection(input.systemSizeKw, input.systemType, input.tier);
  const cables = calculateCables(
    input.systemSizeKw,
    input.systemType,
    input.structureType,
    proposalInput.siteComplexityScore ?? 0
  );
  const mcb = protection.lines.find((l) => l.id === "mcb_set");
  const dcSpd = protection.lines.find((l) => l.id === "dc_spd");
  const acSpd = protection.lines.find((l) => l.id === "ac_spd");
  return {
    protection,
    cables,
    stringSizing: simulationStringSizing,
    breakerSelection: mcb ? `${mcb.quantity} x ${mcb.name}` : "MCB set per system size",
    spdSelection: `${dcSpd?.name ?? "DC SPD"} + ${acSpd?.name ?? "AC SPD"}`,
  };
}

function buildPipelineAssumptions(
  summary: SolarDesignPipelineDraft["inputSummary"],
  panelCount: number,
  panelBrand: string
): string[] {
  return [
    `${summary.systemSizeKw} kW ${systemTypeLabel(summary.systemType)} system, ${tierLabel(summary.tier)} equipment tier.`,
    `${panelCount} x ${summary.panelWattage}W ${panelBrand} panels.`,
    `${structureLabel(summary.structureType)} assumed.`,
    "Pipeline uses deterministic engine chain: roof → layout → simulation → electrical → BOQ → pricing → proposal.",
    "Cable rolls priced at PKR 20,000 per roll with complexity adjustment.",
    "BOQ aligned to Sunchaser 7-section proposal format.",
  ];
}

export function runSolarDesignPipeline(input: SolarDesignPipelineInput): SolarDesignPipelineOutcome {
  const stagesCompleted: SolarPipelineStage[] = [];
  let warnings: string[] = [];
  let validationMessages: string[] = [];

  let validated: SolarDesignPipelineInput;
  try {
    validated = validateSolarDesignPipelineInput(input);
  } catch (e) {
    if (e instanceof SolarPipelineValidationError) {
      return pipelineFailure("validation", e.code, e.message, [], warnings, validationMessages);
    }
    const message = e instanceof Error ? e.message : "Pipeline validation failed.";
    return pipelineFailure("validation", "INVALID_CANVAS_GEOMETRY", message, [], warnings, validationMessages);
  }
  stagesCompleted.push("validation");

  let roof = null;
  let roofBoundary = validated.roofBoundary ?? [];
  let obstacles = validated.obstacles ?? [];
  let layoutTiltDeg: number | undefined;
  let layoutAzimuthDeg: number | undefined;

  if (validated.roofSite) {
    try {
      roof = analyzeRoofSite(validated.roofSite);
      stagesCompleted.push("roof");
      warnings = mergePipelineWarnings([warnings, roofStageWarnings(roof)]);

      const primary = primaryRoofPlane(validated.roofSite.planes);
      const canvas = roofPlaneToCanvas(primary);
      roofBoundary = canvas.boundary;
      obstacles = canvas.obstacles;
      layoutTiltDeg = primary.pitchDeg;
      layoutAzimuthDeg = primary.azimuthDeg;
    } catch (e) {
      const code = e instanceof RoofGeometryError ? e.code : "ROOF_ANALYSIS_FAILED";
      const message = e instanceof Error ? e.message : "Roof geometry analysis failed.";
      return pipelineFailure("roof", code, message, stagesCompleted, warnings, validationMessages);
    }
  } else {
    stagesCompleted.push("roof");
    warnings = mergePipelineWarnings([warnings, roofStageWarnings(null)]);
  }

  const bundleProbe = resolveEquipmentBundle(5, validated.tier, validated.systemType);
  const panelWattage = validated.panelWattage ?? bundleProbe.panelWattage;

  let resolvedSystemSizeKw: SupportedSystemSizeKw;
  try {
    resolvedSystemSizeKw = resolvePipelineSystemSizeKw(validated, panelWattage, {
      roofBoundary,
      obstacles,
      roofWidthMeters: validated.roofWidthMeters,
      canvasWidth: validated.canvasWidth,
      canvasHeight: validated.canvasHeight,
    });
  } catch (e) {
    if (e instanceof SolarPipelineStageError) {
      return pipelineFailure(e.stage, e.code, e.message, stagesCompleted, warnings, validationMessages);
    }
    const message = e instanceof Error ? e.message : "System size resolution failed.";
    return pipelineFailure("layout", "AUTO_SIZE_FAILED", message, stagesCompleted, warnings, validationMessages);
  }

  const validatedResolved: SolarDesignPipelineInput = { ...validated, systemSizeKw: resolvedSystemSizeKw };
  const proposalInput = buildProposalInputFromPipeline(validatedResolved, resolvedSystemSizeKw);
  const bundle = resolveEquipmentBundle(resolvedSystemSizeKw, validated.tier, validated.systemType);

  const layout = layoutPanels({
    systemSizeKw: resolvedSystemSizeKw,
    panelWattage,
    roofBoundary,
    obstacles,
    roofWidthMeters: validated.roofWidthMeters,
    canvasWidth: validated.canvasWidth,
    canvasHeight: validated.canvasHeight,
  });
  stagesCompleted.push("layout");
  warnings = mergePipelineWarnings([warnings, layoutStageWarnings(layout)]);
  validationMessages = [...validationMessages, ...layoutValidationMessages(layout)];

  if (!layout.fitsOnRoof || layout.placedPanels.length === 0) {
    return pipelineFailure(
      "layout",
      "LAYOUT_IMPOSSIBLE",
      layout.placedPanels.length === 0
        ? "No panels could be placed on the provided roof layout."
        : `${layout.unplacedPanels} required panel(s) could not fit on roof.`,
      stagesCompleted,
      warnings,
      validationMessages
    );
  }

  const simArray = validated.simulation?.array;
  const arrayInput: NonNullable<typeof validated.simulation>["array"] = {};
  if (simArray?.tiltDeg !== undefined) arrayInput.tiltDeg = simArray.tiltDeg;
  else if (layoutTiltDeg !== undefined) arrayInput.tiltDeg = layoutTiltDeg;
  if (simArray?.azimuthDeg !== undefined) arrayInput.azimuthDeg = simArray.azimuthDeg;
  else if (layoutAzimuthDeg !== undefined) arrayInput.azimuthDeg = layoutAzimuthDeg;
  if (simArray?.shadingLossFraction !== undefined) arrayInput.shadingLossFraction = simArray.shadingLossFraction;
  if (simArray?.albedo !== undefined) arrayInput.albedo = simArray.albedo;

  let simulation;
  try {
    simulation = runSolarSimulation({
      systemSizeKw: resolvedSystemSizeKw,
      systemType: validated.systemType,
      site: validated.simulation?.site,
      ...(Object.keys(arrayInput).length > 0 ? { array: arrayInput } : {}),
      module: validated.simulation?.module,
      inverter: validated.simulation?.inverter,
      cables: validated.simulation?.cables,
      finance: validated.simulation?.finance,
    });
  } catch (e) {
    const code = e instanceof SolarSimulationValidationError ? e.code : "SIMULATION_FAILED";
    const message = e instanceof Error ? e.message : "Solar simulation failed.";
    return pipelineFailure("simulation", code, message, stagesCompleted, warnings, validationMessages);
  }
  stagesCompleted.push("simulation");
  warnings = mergePipelineWarnings([warnings, simulationStageWarnings(simulation)]);

  const electrical = buildElectricalSizing(validatedResolved, proposalInput, simulation.stringSizing);
  stagesCompleted.push("electrical");

  if (!Number.isFinite(electrical.protection.subtotalPrice) || electrical.protection.subtotalPrice < 0) {
    return pipelineFailure(
      "electrical",
      "INVALID_ELECTRICAL",
      "Electrical sizing produced invalid protection pricing.",
      stagesCompleted,
      warnings,
      validationMessages
    );
  }

  let boq;
  try {
    boq = buildBoq(proposalInput, { precomputedLayout: layout });
  } catch (e) {
    const message = e instanceof Error ? e.message : "BOQ generation failed.";
    return pipelineFailure("boq", "BOQ_FAILED", message, stagesCompleted, warnings, validationMessages);
  }
  stagesCompleted.push("boq");
  warnings = mergePipelineWarnings([warnings, boq.warnings]);

  if (!assertBoqSectionOrder(boq.sections)) {
    return pipelineFailure(
      "boq",
      "BOQ_ORDER",
      "BOQ sections are out of expected Sunchaser order.",
      stagesCompleted,
      warnings,
      validationMessages
    );
  }

  const structureEstimate = calculateStructure(boq.panelCount, validatedResolved.structureType);

  let pricing;
  try {
    pricing = buildPricingSummary(boq.sections, validatedResolved.tier, validatedResolved.systemType);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pricing aggregation failed.";
    return pipelineFailure("pricing", "PRICING_FAILED", message, stagesCompleted, warnings, validationMessages);
  }
  stagesCompleted.push("pricing");

  if (!Number.isFinite(pricing.grandTotal) || pricing.grandTotal <= 0) {
    return pipelineFailure(
      "pricing",
      "INVALID_PRICING",
      "Proposal pricing produced a non-finite or non-positive total.",
      stagesCompleted,
      warnings,
      validationMessages
    );
  }

  const { summary } = validateAndNormalizeSolarProposalInput(proposalInput, DEFAULT_PANEL_WATTAGE);
  const assumptions = buildPipelineAssumptions(summary, boq.panelCount, bundle.panelBrand);

  const draft: SolarDesignPipelineDraft = {
    generatedAt: PIPELINE_ENGINE_TIMESTAMP,
    inputSummary: summary,
    panelCount: boq.panelCount,
    systemSizeKw: resolvedSystemSizeKw,
    cableDistanceM: boq.cableDistanceM,
    cableRolls: boq.cableRolls,
    structureCost: boq.structureCost,
    sections: boq.sections,
    pricing,
    assumptions,
    warnings,
  };

  let template;
  try {
    template = buildProposalTemplate(draft);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Proposal template build failed.";
    return pipelineFailure("proposal", "PROPOSAL_FAILED", message, stagesCompleted, warnings, validationMessages);
  }
  stagesCompleted.push("proposal");

  const result: SolarDesignPipelineResult = {
    draftOnly: true,
    draft,
    roof,
    panelLayout: layout,
    simulation,
    electrical,
    structureEstimate,
    template,
    engineeringAssumptions: simulation.assumptions,
    warnings,
    validationMessages,
    stagesCompleted,
  };

  try {
    assertPipelineResultFinite(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pipeline result contains non-finite values.";
    return pipelineFailure("proposal", "NON_FINITE_OUTPUT", message, stagesCompleted, warnings, validationMessages);
  }

  return pipelineSuccess(result);
}

export { SolarProposalError };
