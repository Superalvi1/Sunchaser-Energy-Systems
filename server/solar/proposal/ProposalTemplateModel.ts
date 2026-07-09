/**
 * Proposal template metadata for UI/PDF rendering (no PDF generation here).
 */

import {
  panelCountForSystem,
  structureLabel,
  systemTypeLabel,
  tierLabel,
} from "./SolarDesignRules.ts";
import type { ProposalDraft } from "./SolarProposalModels.ts";
import { BOQ_SECTION_LABELS } from "./SolarProposalModels.ts";

export interface ProposalCoverBlock {
  title: string;
  subtitle: string;
  systemSizeLabel: string;
  systemTypeLabel: string;
  tierLabel: string;
  structureLabel: string;
  panelCount: number;
  grandTotal: number;
}

export interface ProposalSectionSummary {
  id: string;
  label: string;
  lineCount: number;
  subtotal: number;
}

export interface ProposalTemplateDraft {
  cover: ProposalCoverBlock;
  sectionSummaries: ProposalSectionSummary[];
  terms: string[];
  assumptions: string[];
  warnings: string[];
}

const STANDARD_TERMS = [
  "Prices are valid for 15 days from proposal date.",
  "Payment terms: 70% advance, 30% on commissioning unless otherwise agreed.",
  "Net metering approvals are subject to DISCO timelines.",
  "Roof structural suitability must be confirmed during site survey.",
  "Warranty per manufacturer terms for imported equipment.",
];

export function buildProposalTemplate(draft: ProposalDraft): ProposalTemplateDraft {
  const { inputSummary, pricing, panelCount, assumptions, warnings, sections } = draft;

  return {
    cover: {
      title: "Sunchaser Solar Proposal",
      subtitle: `${inputSummary.systemSizeKw} kW ${systemTypeLabel(inputSummary.systemType)} System`,
      systemSizeLabel: `${inputSummary.systemSizeKw} kW`,
      systemTypeLabel: systemTypeLabel(inputSummary.systemType),
      tierLabel: tierLabel(inputSummary.tier),
      structureLabel: structureLabel(inputSummary.structureType),
      panelCount: panelCount ?? panelCountForSystem(inputSummary.systemSizeKw, inputSummary.panelWattage),
      grandTotal: pricing.grandTotal,
    },
    sectionSummaries: sections.map((s) => ({
      id: s.id,
      label: BOQ_SECTION_LABELS[s.id],
      lineCount: s.lines.length,
      subtotal: s.subtotal,
    })),
    terms: STANDARD_TERMS,
    assumptions,
    warnings,
  };
}
