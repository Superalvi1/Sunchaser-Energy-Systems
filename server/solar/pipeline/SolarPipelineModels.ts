/**
 * Solar Design Pipeline — shared types and stage identifiers.
 * Draft-only. Pure TypeScript. No routes, UI, AI, DB, or persistence.
 */

import type { RoofSiteInput, RoofSiteMetrics } from "../roof/RoofModels.ts";
import type { PanelLayoutResult } from "../proposal/PanelLayoutEngine.ts";
import type {
  BoqSection,
  EquipmentTier,
  ProposalInputSummary,
  ProposalPricingSummary,
  ProposalTemplateDraft,
  RoofObstacle,
  RoofPoint,
  StructureType,
  SupportedSystemSizeKw,
  SystemType,
} from "../proposal/SolarProposalModels.ts";
import type { CableCalculation } from "../proposal/CableCalculator.ts";
import type { ProtectionCalculation } from "../proposal/ProtectionCalculator.ts";
import type { StructureCalculation } from "../proposal/StructureCalculator.ts";
import type {
  SimulationAssumption,
  SolarSimulationInput,
  SolarSimulationResult,
  StringSizingResult,
} from "../simulation/SolarSimulationModels.ts";

export const PIPELINE_ENGINE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const PIPELINE_STAGES = [
  "validation",
  "roof",
  "layout",
  "simulation",
  "electrical",
  "boq",
  "pricing",
  "proposal",
] as const;

export type SolarPipelineStage = (typeof PIPELINE_STAGES)[number];

export class SolarPipelineValidationError extends Error {
  readonly code: string;
  readonly stage: SolarPipelineStage = "validation";
  constructor(code: string, message: string) {
    super(message);
    this.name = "SolarPipelineValidationError";
    this.code = code;
  }
}

export class SolarPipelineStageError extends Error {
  readonly stage: SolarPipelineStage;
  readonly code: string;
  constructor(stage: SolarPipelineStage, code: string, message: string) {
    super(message);
    this.name = "SolarPipelineStageError";
    this.stage = stage;
    this.code = code;
  }
}

export interface SolarDesignPipelineInput {
  systemSizeKw: SupportedSystemSizeKw;
  tier: EquipmentTier;
  systemType: SystemType;
  structureType: StructureType;
  panelWattage?: number;
  siteComplexityScore?: number;
  netMeteringRequired?: boolean;
  roofSite?: RoofSiteInput;
  roofBoundary?: RoofPoint[];
  obstacles?: RoofObstacle[];
  roofWidthMeters?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  /** Optional explicit circle obstacles (center + radius) on canvas. */
  circleObstacles?: Array<{ id: string; cx: number; cy: number; radius: number }>;
  simulation?: Omit<Partial<SolarSimulationInput>, "systemSizeKw" | "systemType">;
}

export interface ElectricalSizingResult {
  protection: ProtectionCalculation;
  cables: CableCalculation;
  stringSizing: StringSizingResult;
  breakerSelection: string;
  spdSelection: string;
}

export interface SolarDesignPipelineDraft {
  generatedAt: string;
  inputSummary: ProposalInputSummary;
  panelCount: number;
  systemSizeKw: SupportedSystemSizeKw;
  cableDistanceM: number;
  cableRolls: number;
  structureCost: number;
  sections: BoqSection[];
  pricing: ProposalPricingSummary;
  assumptions: string[];
  warnings: string[];
}

export interface SolarDesignPipelineResult {
  draftOnly: true;
  draft: SolarDesignPipelineDraft;
  roof: RoofSiteMetrics | null;
  panelLayout: PanelLayoutResult;
  simulation: SolarSimulationResult;
  electrical: ElectricalSizingResult;
  structureEstimate: StructureCalculation;
  template: ProposalTemplateDraft;
  engineeringAssumptions: SimulationAssumption[];
  warnings: string[];
  validationMessages: string[];
  stagesCompleted: SolarPipelineStage[];
}

export interface SolarDesignPipelineFailure {
  success: false;
  stage: SolarPipelineStage;
  code: string;
  message: string;
  warnings: string[];
  validationMessages: string[];
  stagesCompleted: SolarPipelineStage[];
}

export interface SolarDesignPipelineSuccess {
  success: true;
  result: SolarDesignPipelineResult;
}

export type SolarDesignPipelineOutcome = SolarDesignPipelineSuccess | SolarDesignPipelineFailure;

export function isPipelineSuccess(outcome: SolarDesignPipelineOutcome): outcome is SolarDesignPipelineSuccess {
  return outcome.success;
}
