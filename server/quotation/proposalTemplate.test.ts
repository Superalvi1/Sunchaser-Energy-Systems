import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import type { BoqResult } from "./BoqGenerator.ts";
import {
  buildProposalOutline,
  DEFAULT_PROPOSAL_SECTIONS,
  getProposalSectionDefinition,
  isProposalSectionId,
  listProposalSectionDefinitions,
  PROPOSAL_SECTION_IDS,
  requiredProposalSectionIds,
} from "./ProposalTemplate.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function fakeBoq(): BoqResult {
  return {
    lines: [
      { category: "panel", name: "Panel", description: "d", unit: "piece", quantity: 1, unitCost: 100, unitPrice: 150, totalCost: 100, totalPrice: 150 },
    ],
    totalCost: 100,
    totalPrice: 150,
    margin: { totalCost: 100, totalPrice: 150, grossProfit: 50, marginPercent: 33.33 },
  };
}

check("PROPOSAL_SECTION_IDS has 11 sections", PROPOSAL_SECTION_IDS.length === 11);
check("PROPOSAL_SECTION_IDS starts with cover", PROPOSAL_SECTION_IDS[0] === "cover");
check("PROPOSAL_SECTION_IDS ends with final", PROPOSAL_SECTION_IDS[PROPOSAL_SECTION_IDS.length - 1] === "final");
check("DEFAULT_PROPOSAL_SECTIONS matches the full id list", DEFAULT_PROPOSAL_SECTIONS.join(",") === PROPOSAL_SECTION_IDS.join(","));

check("isProposalSectionId accepts boq", isProposalSectionId("boq"));
check("isProposalSectionId rejects unknown", !isProposalSectionId("appendix"));

check("getProposalSectionDefinition returns the matching title", getProposalSectionDefinition("boq").title === "Bill of Quantities");
check("listProposalSectionDefinitions returns 11 entries", listProposalSectionDefinitions().length === 11);

check("requiredProposalSectionIds includes cover", requiredProposalSectionIds().includes("cover"));
check("requiredProposalSectionIds includes boq", requiredProposalSectionIds().includes("boq"));
check("requiredProposalSectionIds includes structure", requiredProposalSectionIds().includes("structure"));
check("requiredProposalSectionIds includes signoff", requiredProposalSectionIds().includes("signoff"));
check("requiredProposalSectionIds excludes optional sections like bank", !requiredProposalSectionIds().includes("bank"));

check("buildProposalOutline with no includedSectionIds includes all 11 sections", buildProposalOutline({ customerName: "Ali", boq: fakeBoq() }).sections.length === 11);
check("buildProposalOutline preserves the fixed canonical order", (() => {
  const outline = buildProposalOutline({ customerName: "Ali", boq: fakeBoq() });
  return outline.sections.map((s) => s.id).join(",") === PROPOSAL_SECTION_IDS.join(",");
})());
check("buildProposalOutline order field is zero-based and sequential", (() => {
  const outline = buildProposalOutline({ customerName: "Ali", boq: fakeBoq() });
  return outline.sections.every((s, i) => s.order === i);
})());

check("buildProposalOutline honors a restricted section list", (() => {
  const outline = buildProposalOutline({ customerName: "Ali", includedSectionIds: ["cover", "boq", "signoff"], boq: fakeBoq() });
  return outline.sections.map((s) => s.id).join(",") === "cover,structure,boq,signoff";
})());
check("buildProposalOutline always force-includes required sections even if omitted", (() => {
  const outline = buildProposalOutline({ customerName: "Ali", includedSectionIds: ["profile"], boq: fakeBoq() });
  return outline.sections.some((s) => s.id === "boq") && outline.sections.some((s) => s.id === "cover");
})());
check("buildProposalOutline trims customerName", buildProposalOutline({ customerName: "  Ali  ", boq: fakeBoq() }).customerName === "Ali");
check("buildProposalOutline reports boqLineCount from the BOQ", buildProposalOutline({ customerName: "Ali", boq: fakeBoq() }).boqLineCount === 1);
check("buildProposalOutline reports totalPrice from the BOQ", buildProposalOutline({ customerName: "Ali", boq: fakeBoq() }).totalPrice === 150);

check(
  "buildProposalOutline throws for empty customerName",
  (() => {
    try {
      buildProposalOutline({ customerName: "", boq: fakeBoq() });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "proposal_template";
    }
  })()
);
check(
  "buildProposalOutline throws for an unknown section id",
  (() => {
    try {
      buildProposalOutline({ customerName: "Ali", includedSectionIds: ["appendix"], boq: fakeBoq() });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

console.log(`\nProposalTemplate tests: ${pass} passed`);
