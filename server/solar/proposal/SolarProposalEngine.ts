/**
 * Solar Proposal Studio Phase 1 — orchestration entry point.
 */

import { assertBoqSectionOrder, buildBoq } from "./BoqGenerator.ts";
import { buildPricingSummary } from "./PricingEngine.ts";
import { buildProposalTemplate } from "./ProposalTemplateModel.ts";
import { panelCountForSystem, structureLabel, systemTypeLabel, tierLabel } from "./SolarDesignRules.ts";
import { DEFAULT_PANEL_WATTAGE } from "./SolarDesignRules.ts";
import { resolveEquipmentBundle } from "./SolarProductCatalog.ts";
import type { ProposalDraft, ProposalTemplateDraft, SolarProposalInput } from "./SolarProposalModels.ts";
import {
  EQUIPMENT_TIERS,
  PROPOSAL_ENGINE_TIMESTAMP,
  SolarProposalError,
  STRUCTURE_TYPES,
  SUPPORTED_SYSTEM_SIZES_KW,
  SYSTEM_TYPES,
  validateAndNormalizeSolarProposalInput,
} from "./SolarProposalModels.ts";

export interface SolarProposalResult {
  draft: ProposalDraft;
  template: ProposalTemplateDraft;
}

function buildAssumptions(
  summary: ProposalDraft["inputSummary"],
  panelCount: number,
  panelBrand: string
): string[] {
  return [
    `${summary.systemSizeKw} kW ${systemTypeLabel(summary.systemType)} system, ${tierLabel(summary.tier)} equipment tier.`,
    `${panelCount} x ${summary.panelWattage}W ${panelBrand} panels.`,
    `${structureLabel(summary.structureType)} assumed.`,
    "Cable rolls priced at PKR 20,000 per roll with complexity adjustment.",
    "BOQ aligned to Sunchaser 7-section proposal format.",
  ];
}

export function generateSolarProposal(input: SolarProposalInput): SolarProposalResult {
  const { input: normalized, summary } = validateAndNormalizeSolarProposalInput(input, DEFAULT_PANEL_WATTAGE);
  const bundle = resolveEquipmentBundle(normalized.systemSizeKw, normalized.tier, normalized.systemType);

  const boq = buildBoq(normalized);
  if (!assertBoqSectionOrder(boq.sections)) {
    throw new SolarProposalError("BOQ_ORDER", "BOQ sections are out of expected Sunchaser order.");
  }

  const assumptions = buildAssumptions(summary, boq.panelCount, bundle.panelBrand);
  const pricing = buildPricingSummary(boq.sections, summary.tier, summary.systemType);

  if (!Number.isFinite(pricing.grandTotal) || pricing.grandTotal <= 0) {
    throw new SolarProposalError("INVALID_PRICING", "Proposal pricing produced a non-finite total.");
  }

  const draft: ProposalDraft = {
    generatedAt: PROPOSAL_ENGINE_TIMESTAMP,
    inputSummary: summary,
    panelCount: boq.panelCount,
    systemSizeKw: summary.systemSizeKw,
    cableDistanceM: boq.cableDistanceM,
    cableRolls: boq.cableRolls,
    structureCost: boq.structureCost,
    sections: boq.sections,
    pricing,
    assumptions,
    warnings: boq.warnings,
  };

  const template = buildProposalTemplate(draft);
  return { draft, template };
}

export { SUPPORTED_SYSTEM_SIZES_KW, EQUIPMENT_TIERS, SYSTEM_TYPES, STRUCTURE_TYPES };
