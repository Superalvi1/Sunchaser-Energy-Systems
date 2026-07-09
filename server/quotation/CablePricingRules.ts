/**
 * Cable pricing rules — real, pure cost computation for cable runs
 * (DC, AC, earth wire). No external supplier pricing feed.
 */

import { isNonNegativeNumber, isPositiveNumber, QuotationEngineError, round2 } from "./QuotationModels.ts";

export const CABLE_RUN_TYPES = ["dc_cable", "ac_cable", "earth_wire"] as const;
export type CableRunType = (typeof CABLE_RUN_TYPES)[number];

const CABLE_RUN_TYPE_SET = new Set<string>(CABLE_RUN_TYPES);

export function isCableRunType(value: string): value is CableRunType {
  return CABLE_RUN_TYPE_SET.has(value);
}

export interface CableRunInput {
  type: CableRunType;
  lengthMeters: number;
  pricePerMeter: number;
  /** Extra % of length bought to cover routing loss/joins. Default 10%. */
  wastagePercent?: number;
  /** Fixed one-off accessory allowance (glands, lugs, ties). Default 0. */
  accessoryAllowance?: number;
}

export interface CableRunResult {
  type: CableRunType;
  billedLengthMeters: number;
  pricePerMeter: number;
  wastagePercent: number;
  accessoryAllowance: number;
  totalCost: number;
}

export const DEFAULT_CABLE_WASTAGE_PERCENT = 10;

export function computeCableRunCost(input: CableRunInput): CableRunResult {
  if (!isCableRunType(input.type)) {
    throw new QuotationEngineError("cable_pricing", "Invalid cable run type.");
  }
  if (!isPositiveNumber(input.lengthMeters)) {
    throw new QuotationEngineError("cable_pricing", "lengthMeters must be a positive number.");
  }
  if (!isNonNegativeNumber(input.pricePerMeter)) {
    throw new QuotationEngineError("cable_pricing", "pricePerMeter must be a non-negative number.");
  }
  const wastagePercent = input.wastagePercent ?? DEFAULT_CABLE_WASTAGE_PERCENT;
  if (!isNonNegativeNumber(wastagePercent)) {
    throw new QuotationEngineError("cable_pricing", "wastagePercent must be a non-negative number.");
  }
  const accessoryAllowance = input.accessoryAllowance ?? 0;
  if (!isNonNegativeNumber(accessoryAllowance)) {
    throw new QuotationEngineError("cable_pricing", "accessoryAllowance must be a non-negative number.");
  }

  const billedLengthMeters = round2(input.lengthMeters * (1 + wastagePercent / 100));
  const totalCost = round2(billedLengthMeters * input.pricePerMeter + accessoryAllowance);

  return {
    type: input.type,
    billedLengthMeters,
    pricePerMeter: input.pricePerMeter,
    wastagePercent,
    accessoryAllowance,
    totalCost,
  };
}

/** Sums multiple cable runs (e.g. DC + AC + earth) into one total. */
export function sumCableRunCosts(runs: CableRunResult[]): number {
  return round2(runs.reduce((sum, r) => sum + r.totalCost, 0));
}
