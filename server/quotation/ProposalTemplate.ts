/**
 * Proposal template sections — pure data model for the customer-facing
 * proposal outline. Mirrors the section ids already used by the existing PDF
 * compiler's `includedPages` (server.ts): cover, profile, qr, ceo, structure,
 * boq, terms1, terms2, signoff, bank, final. No rendering happens here.
 */

import { isNonEmptyString, QuotationEngineError } from "./QuotationModels.ts";
import type { BoqResult } from "./BoqGenerator.ts";

export const PROPOSAL_SECTION_IDS = [
  "cover",
  "profile",
  "qr",
  "ceo",
  "structure",
  "boq",
  "terms1",
  "terms2",
  "signoff",
  "bank",
  "final",
] as const;

export type ProposalSectionId = (typeof PROPOSAL_SECTION_IDS)[number];

const PROPOSAL_SECTION_ID_SET = new Set<string>(PROPOSAL_SECTION_IDS);

export function isProposalSectionId(value: string): value is ProposalSectionId {
  return PROPOSAL_SECTION_ID_SET.has(value);
}

export interface ProposalSectionDefinition {
  id: ProposalSectionId;
  title: string;
  /** True when the section is always included regardless of caller preferences. */
  required: boolean;
}

const PROPOSAL_SECTION_DEFINITIONS: Record<ProposalSectionId, ProposalSectionDefinition> = {
  cover: { id: "cover", title: "Cover Page", required: true },
  profile: { id: "profile", title: "Company Profile", required: false },
  qr: { id: "qr", title: "QR / Social Links", required: false },
  ceo: { id: "ceo", title: "CEO Message", required: false },
  structure: { id: "structure", title: "System & Structure Overview", required: true },
  boq: { id: "boq", title: "Bill of Quantities", required: true },
  terms1: { id: "terms1", title: "Terms & Conditions (1)", required: false },
  terms2: { id: "terms2", title: "Terms & Conditions (2)", required: false },
  signoff: { id: "signoff", title: "Sign-off", required: true },
  bank: { id: "bank", title: "Bank Details", required: false },
  final: { id: "final", title: "Closing Page", required: false },
};

/** The default full section order — matches the existing PDF compiler default. */
export const DEFAULT_PROPOSAL_SECTIONS: readonly ProposalSectionId[] = PROPOSAL_SECTION_IDS;

export function getProposalSectionDefinition(id: ProposalSectionId): ProposalSectionDefinition {
  return PROPOSAL_SECTION_DEFINITIONS[id];
}

export function listProposalSectionDefinitions(): ProposalSectionDefinition[] {
  return PROPOSAL_SECTION_IDS.map((id) => PROPOSAL_SECTION_DEFINITIONS[id]);
}

export function requiredProposalSectionIds(): ProposalSectionId[] {
  return PROPOSAL_SECTION_IDS.filter((id) => PROPOSAL_SECTION_DEFINITIONS[id].required);
}

export interface ProposalOutlineInput {
  customerName: string;
  includedSectionIds?: string[];
  boq: BoqResult;
}

export interface ProposalOutlineSection extends ProposalSectionDefinition {
  order: number;
}

export interface ProposalOutline {
  customerName: string;
  sections: ProposalOutlineSection[];
  boqLineCount: number;
  totalPrice: number;
}

/**
 * Builds the ordered section outline for a proposal. Unknown section ids are
 * rejected; required sections are always included even if omitted from the
 * caller's requested list, preserving the fixed canonical order.
 */
export function buildProposalOutline(input: ProposalOutlineInput): ProposalOutline {
  if (!isNonEmptyString(input.customerName)) {
    throw new QuotationEngineError("proposal_template", "customerName is required.");
  }

  const requested = input.includedSectionIds ?? [...DEFAULT_PROPOSAL_SECTIONS];
  for (const id of requested) {
    if (!isProposalSectionId(id)) {
      throw new QuotationEngineError("proposal_template", `Unknown proposal section id: ${id}`);
    }
  }

  const requestedSet = new Set<string>(requested);
  for (const requiredId of requiredProposalSectionIds()) {
    requestedSet.add(requiredId);
  }

  const sections: ProposalOutlineSection[] = PROPOSAL_SECTION_IDS.filter((id) => requestedSet.has(id)).map(
    (id, index) => ({ ...PROPOSAL_SECTION_DEFINITIONS[id], order: index })
  );

  return {
    customerName: input.customerName.trim(),
    sections,
    boqLineCount: input.boq.lines.length,
    totalPrice: input.boq.totalPrice,
  };
}
