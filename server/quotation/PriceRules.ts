/**
 * Price rules — real, pure pricing computation. Quantity-tiered discounts,
 * line totals, and rule evaluation. No external pricing service.
 */

import { isNonNegativeNumber, isPositiveNumber, num, QuotationEngineError, round2 } from "./QuotationModels.ts";

export interface PriceLineInput {
  unitPrice: number;
  quantity: number;
}

export interface PriceLineResult {
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export function computeLineTotal(input: PriceLineInput): PriceLineResult {
  if (!isNonNegativeNumber(input.unitPrice)) {
    throw new QuotationEngineError("price_rules", "unitPrice must be a non-negative number.");
  }
  if (!isPositiveNumber(input.quantity)) {
    throw new QuotationEngineError("price_rules", "quantity must be a positive number.");
  }
  return {
    unitPrice: input.unitPrice,
    quantity: input.quantity,
    lineTotal: round2(input.unitPrice * input.quantity),
  };
}

/** Quantity-tiered discount rule: at or above `minQuantity`, apply `discountPercent` off unitPrice. */
export interface QuantityTierRule {
  minQuantity: number;
  discountPercent: number;
}

export function sortTiersDescending(tiers: QuantityTierRule[]): QuantityTierRule[] {
  return [...tiers].sort((a, b) => b.minQuantity - a.minQuantity);
}

/** Finds the highest-qualifying tier for the given quantity, or null if none apply. */
export function resolveApplicableTier(tiers: QuantityTierRule[], quantity: number): QuantityTierRule | null {
  const sorted = sortTiersDescending(tiers);
  return sorted.find((tier) => quantity >= tier.minQuantity) ?? null;
}

export interface TieredPriceResult {
  baseUnitPrice: number;
  effectiveUnitPrice: number;
  appliedTier: QuantityTierRule | null;
  quantity: number;
  lineTotal: number;
}

export function applyQuantityTierPricing(
  baseUnitPrice: number,
  quantity: number,
  tiers: QuantityTierRule[]
): TieredPriceResult {
  if (!isNonNegativeNumber(baseUnitPrice)) {
    throw new QuotationEngineError("price_rules", "baseUnitPrice must be a non-negative number.");
  }
  if (!isPositiveNumber(quantity)) {
    throw new QuotationEngineError("price_rules", "quantity must be a positive number.");
  }

  const appliedTier = resolveApplicableTier(tiers, quantity);
  const effectiveUnitPrice = appliedTier
    ? round2(baseUnitPrice * (1 - appliedTier.discountPercent / 100))
    : baseUnitPrice;

  return {
    baseUnitPrice,
    effectiveUnitPrice,
    appliedTier,
    quantity,
    lineTotal: round2(effectiveUnitPrice * quantity),
  };
}

/** Sum of an arbitrary list of line totals — pure aggregation helper. */
export function sumLineTotals(lines: Array<{ lineTotal: number }>): number {
  return round2(lines.reduce((sum, line) => sum + num(line.lineTotal), 0));
}
