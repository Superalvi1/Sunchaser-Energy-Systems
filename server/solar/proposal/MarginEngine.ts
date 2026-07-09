/**
 * Margin rules for proposal pricing.
 */

import type { EquipmentTier, SystemType } from "./SolarProposalModels.ts";
import { round2 } from "./SolarProposalModels.ts";

export interface MarginResult {
  marginPercent: number;
  marginAmount: number;
  grandTotal: number;
}

export function targetMarginPercent(
  tier: EquipmentTier,
  systemType: SystemType,
  subtotalCost: number
): number {
  let base = tier === "premium" ? 14 : 11;
  if (systemType === "off-grid") base += 2;
  if (systemType === "hybrid") base += 1;
  if (subtotalCost > 2_500_000) base -= 1;
  if (subtotalCost > 4_000_000) base -= 1;
  return Math.max(8, Math.min(18, base));
}

export function applyMargin(subtotalCost: number, subtotalPrice: number, tier: EquipmentTier, systemType: SystemType): MarginResult {
  const target = targetMarginPercent(tier, systemType, subtotalCost);
  const implied = subtotalCost > 0 ? ((subtotalPrice - subtotalCost) / subtotalCost) * 100 : target;
  const marginPercent = round2(Math.max(target, implied));
  const marginAmount = round2(subtotalPrice - subtotalCost);
  const grandTotal = round2(subtotalPrice);
  return { marginPercent, marginAmount, grandTotal };
}
