/**
 * Site complexity score — real, pure scoring of site-survey factors into a
 * numeric score, complexity tier, and an installation-cost multiplier that
 * the BOQ generator can apply to labor/civil-work lines.
 */

import { clamp, isNonNegativeNumber, isPositiveNumber, QuotationEngineError, round2 } from "./QuotationModels.ts";
import { isRoofType, type RoofType } from "./StructurePricingRules.ts";

export const SHADING_LEVELS = ["none", "partial", "heavy"] as const;
export type ShadingLevel = (typeof SHADING_LEVELS)[number];

const SHADING_LEVEL_SET = new Set<string>(SHADING_LEVELS);

export function isShadingLevel(value: string): value is ShadingLevel {
  return SHADING_LEVEL_SET.has(value);
}

export const ROOF_ACCESS_DIFFICULTIES = ["easy", "moderate", "difficult"] as const;
export type RoofAccessDifficulty = (typeof ROOF_ACCESS_DIFFICULTIES)[number];

const ROOF_ACCESS_DIFFICULTY_SET = new Set<string>(ROOF_ACCESS_DIFFICULTIES);

export function isRoofAccessDifficulty(value: string): value is RoofAccessDifficulty {
  return ROOF_ACCESS_DIFFICULTY_SET.has(value);
}

export const COMPLEXITY_TIERS = ["simple", "moderate", "complex", "very_complex"] as const;
export type ComplexityTier = (typeof COMPLEXITY_TIERS)[number];

export interface SiteComplexityInput {
  roofType: RoofType;
  shadingLevel: ShadingLevel;
  roofAccessDifficulty: RoofAccessDifficulty;
  meterToRoofDistanceMeters: number;
  roofFaceCount: number;
  heightMeters: number;
}

export interface SiteComplexityResult {
  score: number;
  tier: ComplexityTier;
  /** Multiplier ≥ 1.0 to apply to installation/civil-work cost lines. */
  installCostMultiplier: number;
  breakdown: {
    roofType: number;
    shading: number;
    access: number;
    distance: number;
    faceCount: number;
    height: number;
  };
}

const ROOF_TYPE_POINTS: Record<RoofType, number> = {
  flat_concrete: 0,
  sloped_tin: 8,
  sloped_tile: 12,
  ground_mount: 4,
};

const SHADING_POINTS: Record<ShadingLevel, number> = {
  none: 0,
  partial: 10,
  heavy: 20,
};

const ACCESS_POINTS: Record<RoofAccessDifficulty, number> = {
  easy: 0,
  moderate: 10,
  difficult: 20,
};

/** 1 point per 5 meters of meter-to-roof cable run, capped at 15 points. */
function distancePoints(meters: number): number {
  return clamp(Math.floor(meters / 5), 0, 15);
}

/** 3 points per roof face beyond the first, capped at 15 points. */
function faceCountPoints(faceCount: number): number {
  return clamp((faceCount - 1) * 3, 0, 15);
}

/** 2 points per meter of height beyond 6m (ground floor eave), capped at 20 points. */
function heightPoints(heightMeters: number): number {
  return clamp((heightMeters - 6) * 2, 0, 20);
}

export function computeSiteComplexity(input: SiteComplexityInput): SiteComplexityResult {
  if (!isRoofType(input.roofType)) throw new QuotationEngineError("site_complexity", "Invalid roofType.");
  if (!isShadingLevel(input.shadingLevel)) throw new QuotationEngineError("site_complexity", "Invalid shadingLevel.");
  if (!isRoofAccessDifficulty(input.roofAccessDifficulty)) {
    throw new QuotationEngineError("site_complexity", "Invalid roofAccessDifficulty.");
  }
  if (!isNonNegativeNumber(input.meterToRoofDistanceMeters)) {
    throw new QuotationEngineError("site_complexity", "meterToRoofDistanceMeters must be a non-negative number.");
  }
  if (!isPositiveNumber(input.roofFaceCount)) {
    throw new QuotationEngineError("site_complexity", "roofFaceCount must be a positive number.");
  }
  if (!isNonNegativeNumber(input.heightMeters)) {
    throw new QuotationEngineError("site_complexity", "heightMeters must be a non-negative number.");
  }

  const breakdown = {
    roofType: ROOF_TYPE_POINTS[input.roofType],
    shading: SHADING_POINTS[input.shadingLevel],
    access: ACCESS_POINTS[input.roofAccessDifficulty],
    distance: distancePoints(input.meterToRoofDistanceMeters),
    faceCount: faceCountPoints(input.roofFaceCount),
    height: heightPoints(input.heightMeters),
  };

  const rawScore =
    breakdown.roofType + breakdown.shading + breakdown.access + breakdown.distance + breakdown.faceCount + breakdown.height;
  const score = clamp(rawScore, 0, 100);

  const tier = resolveComplexityTier(score);
  const installCostMultiplier = round2(1 + score / 200); // up to +50% at score 100

  return { score, tier, installCostMultiplier, breakdown };
}

export function resolveComplexityTier(score: number): ComplexityTier {
  if (score < 20) return "simple";
  if (score < 45) return "moderate";
  if (score < 70) return "complex";
  return "very_complex";
}
