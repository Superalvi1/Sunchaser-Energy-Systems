/**
 * Aggregates section subtotals into proposal pricing summary.
 */

import { applyMargin } from "./MarginEngine.ts";
import type { BoqSection, EquipmentTier, ProposalPricingSummary, SystemType } from "./SolarProposalModels.ts";
import { round2 } from "./SolarProposalModels.ts";

export function sumSectionCost(sections: BoqSection[]): number {
  return round2(sections.reduce((s, sec) => s + sec.lines.reduce((ls, l) => ls + l.unitCost * l.quantity, 0), 0));
}

export function sumSectionPrice(sections: BoqSection[]): number {
  return round2(sections.reduce((s, sec) => s + sec.subtotal, 0));
}

export function buildPricingSummary(
  sections: BoqSection[],
  tier: EquipmentTier,
  systemType: SystemType
): ProposalPricingSummary {
  const subtotalCost = sumSectionCost(sections);
  const subtotalPrice = sumSectionPrice(sections);
  const margin = applyMargin(subtotalCost, subtotalPrice, tier, systemType);
  return {
    subtotalCost,
    subtotalPrice,
    marginPercent: margin.marginPercent,
    marginAmount: margin.marginAmount,
    grandTotal: margin.grandTotal,
  };
}
