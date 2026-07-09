/**
 * Solar Design Pipeline — input validation (fail before any engine runs).
 */

import {
  EQUIPMENT_TIERS,
  STRUCTURE_TYPES,
  SUPPORTED_SYSTEM_SIZES_KW,
  SYSTEM_TYPES,
} from "../proposal/SolarProposalModels.ts";
import {
  type SolarDesignPipelineInput,
  SolarPipelineValidationError,
} from "./SolarPipelineModels.ts";
import { validateCanvasGeometry } from "./SolarPipelineCanvasGeometry.ts";

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
  }
  return `${typeof value}(${String(value)})`;
}

function requireFiniteOptional(obj: unknown, key: string, label: string, code: string, min?: number, max?: number): void {
  if (obj == null || typeof obj !== "object" || !Object.prototype.hasOwnProperty.call(obj, key)) return;
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SolarPipelineValidationError(code, `${label} must be a finite number; received ${describe(value)}.`);
  }
  if (min !== undefined && value < min) {
    throw new SolarPipelineValidationError(code, `${label} must be >= ${min}; received ${value}.`);
  }
  if (max !== undefined && value > max) {
    throw new SolarPipelineValidationError(code, `${label} must be <= ${max}; received ${value}.`);
  }
}

export function validateSolarDesignPipelineInput(input: SolarDesignPipelineInput): SolarDesignPipelineInput {
  if (input === null || typeof input !== "object") {
    throw new SolarPipelineValidationError("INVALID_INPUT", `Pipeline input must be an object; received ${describe(input)}.`);
  }

  if (typeof input.systemSizeKw !== "number" || !Number.isFinite(input.systemSizeKw)) {
    throw new SolarPipelineValidationError("INVALID_SIZE", `systemSizeKw must be finite; received ${describe(input.systemSizeKw)}.`);
  }
  if (!(SUPPORTED_SYSTEM_SIZES_KW as readonly number[]).includes(input.systemSizeKw)) {
    throw new SolarPipelineValidationError("UNSUPPORTED_SIZE", `Unsupported system size: ${input.systemSizeKw} kW.`);
  }
  if (!EQUIPMENT_TIERS.includes(input.tier)) {
    throw new SolarPipelineValidationError("INVALID_TIER", `Unsupported tier: ${describe(input.tier)}.`);
  }
  if (!SYSTEM_TYPES.includes(input.systemType)) {
    throw new SolarPipelineValidationError("INVALID_SYSTEM_TYPE", `Unsupported system type: ${describe(input.systemType)}.`);
  }
  if (!STRUCTURE_TYPES.includes(input.structureType)) {
    throw new SolarPipelineValidationError("INVALID_STRUCTURE", `Unsupported structure type: ${describe(input.structureType)}.`);
  }

  requireFiniteOptional(input, "panelWattage", "panelWattage", "INVALID_PANEL_WATTAGE", 1);
  requireFiniteOptional(input, "siteComplexityScore", "siteComplexityScore", "INVALID_COMPLEXITY", 0, 10);
  requireFiniteOptional(input, "roofWidthMeters", "roofWidthMeters", "INVALID_ROOF_WIDTH", 0.1);
  requireFiniteOptional(input, "canvasWidth", "canvasWidth", "INVALID_CANVAS", 1);
  requireFiniteOptional(input, "canvasHeight", "canvasHeight", "INVALID_CANVAS", 1);

  validateCanvasGeometry(input);

  return input;
}
