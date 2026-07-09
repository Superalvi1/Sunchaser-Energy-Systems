/**
 * Margin rules — real, pure cost/margin computation and a safe view that
 * strips cost/margin fields for viewers who should not see them. Mirrors the
 * existing canViewProjectProfit visibility convention (src/lib/projectFinance.ts)
 * without importing it, so this module stays decoupled from any specific actor type.
 */

import { isNonNegativeNumber, num, QuotationEngineError, round2 } from "./QuotationModels.ts";

export interface MarginInput {
  totalCost: number;
  totalPrice: number;
}

export interface MarginResult {
  totalCost: number;
  totalPrice: number;
  grossProfit: number;
  marginPercent: number;
}

export function computeMargin(input: MarginInput): MarginResult {
  if (!isNonNegativeNumber(input.totalCost)) {
    throw new QuotationEngineError("margin_rules", "totalCost must be a non-negative number.");
  }
  if (!isNonNegativeNumber(input.totalPrice)) {
    throw new QuotationEngineError("margin_rules", "totalPrice must be a non-negative number.");
  }
  const grossProfit = round2(input.totalPrice - input.totalCost);
  const marginPercent = input.totalPrice > 0 ? round2((grossProfit / input.totalPrice) * 100) : 0;
  return {
    totalCost: input.totalCost,
    totalPrice: input.totalPrice,
    grossProfit,
    marginPercent,
  };
}

/** Given a desired margin percent and a known cost, computes the sell price required to hit it. */
export function computeSellPriceForMargin(cost: number, targetMarginPercent: number): number {
  if (!isNonNegativeNumber(cost)) {
    throw new QuotationEngineError("margin_rules", "cost must be a non-negative number.");
  }
  if (targetMarginPercent < 0 || targetMarginPercent >= 100) {
    throw new QuotationEngineError("margin_rules", "targetMarginPercent must be in [0, 100).");
  }
  return round2(cost / (1 - targetMarginPercent / 100));
}

/** Default gate: only the Super Admin "allauddin" account sees cost/margin — mirrors canViewProjectProfit. */
export function defaultCanViewMargin(role: string, username: string): boolean {
  return role === "Super Admin" && String(username || "").trim().toLowerCase() === "allauddin";
}

export type MarginVisibilityPredicate = (role: string, username: string) => boolean;

export interface MarginSafeView {
  totalPrice: number;
  totalCost?: number;
  grossProfit?: number;
  marginPercent?: number;
}

/** Strips cost/margin fields unless the predicate grants visibility. */
export function toMarginSafeView(
  margin: MarginResult,
  role: string,
  username: string,
  canView: MarginVisibilityPredicate = defaultCanViewMargin
): MarginSafeView {
  if (canView(role, username)) {
    return {
      totalPrice: margin.totalPrice,
      totalCost: margin.totalCost,
      grossProfit: margin.grossProfit,
      marginPercent: margin.marginPercent,
    };
  }
  return { totalPrice: margin.totalPrice };
}

/** Aggregates cost/price pairs (e.g. BOQ lines) into one MarginResult. */
export function aggregateMargin(lines: Array<{ cost: number; price: number }>): MarginResult {
  const totalCost = round2(lines.reduce((sum, l) => sum + num(l.cost), 0));
  const totalPrice = round2(lines.reduce((sum, l) => sum + num(l.price), 0));
  return computeMargin({ totalCost, totalPrice });
}
