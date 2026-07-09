/**
 * Structure pricing rules — real, pure cost computation for mounting
 * structures, priced per kW with a roof-type multiplier. No external
 * fabrication/supplier pricing feed.
 */

import { isNonNegativeNumber, isPositiveNumber, QuotationEngineError, round2 } from "./QuotationModels.ts";

export const STRUCTURE_TYPES = ["elevated", "gi", "rcc", "ballast"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

const STRUCTURE_TYPE_SET = new Set<string>(STRUCTURE_TYPES);

export function isStructureType(value: string): value is StructureType {
  return STRUCTURE_TYPE_SET.has(value);
}

export const ROOF_TYPES = ["flat_concrete", "sloped_tin", "sloped_tile", "ground_mount"] as const;
export type RoofType = (typeof ROOF_TYPES)[number];

const ROOF_TYPE_SET = new Set<string>(ROOF_TYPES);

export function isRoofType(value: string): value is RoofType {
  return ROOF_TYPE_SET.has(value);
}

/** Roof-type cost multiplier applied to the base per-kW structure rate. */
export const ROOF_TYPE_MULTIPLIERS: Record<RoofType, number> = {
  flat_concrete: 1.0,
  sloped_tin: 1.15,
  sloped_tile: 1.3,
  ground_mount: 1.5,
};

export interface StructurePricingInput {
  structureType: StructureType;
  systemSizeKw: number;
  /** Base structure rate per kW before roof-type multiplier. */
  ratePerKw: number;
  roofType: RoofType;
}

export interface StructurePricingResult {
  structureType: StructureType;
  systemSizeKw: number;
  roofType: RoofType;
  ratePerKw: number;
  multiplier: number;
  totalCost: number;
}

export function computeStructureCost(input: StructurePricingInput): StructurePricingResult {
  if (!isStructureType(input.structureType)) {
    throw new QuotationEngineError("structure_pricing", "Invalid structure type.");
  }
  if (!isPositiveNumber(input.systemSizeKw)) {
    throw new QuotationEngineError("structure_pricing", "systemSizeKw must be a positive number.");
  }
  if (!isNonNegativeNumber(input.ratePerKw)) {
    throw new QuotationEngineError("structure_pricing", "ratePerKw must be a non-negative number.");
  }
  if (!isRoofType(input.roofType)) {
    throw new QuotationEngineError("structure_pricing", "Invalid roof type.");
  }

  const multiplier = ROOF_TYPE_MULTIPLIERS[input.roofType];
  const totalCost = round2(input.systemSizeKw * input.ratePerKw * multiplier);

  return {
    structureType: input.structureType,
    systemSizeKw: input.systemSizeKw,
    roofType: input.roofType,
    ratePerKw: input.ratePerKw,
    multiplier,
    totalCost,
  };
}
