import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateSolarProposal } from "./SolarProposalEngine.ts";
import { assertBoqSectionOrder } from "./BoqGenerator.ts";
import { BOQ_SECTION_LABELS, EQUIPMENT_TIERS, STRUCTURE_TYPES, SUPPORTED_SYSTEM_SIZES_KW, SYSTEM_TYPES } from "./SolarProposalModels.ts";
import { panelCountForSystem } from "./SolarDesignRules.ts";
import { CABLE_ROLL_PRICE } from "./SolarProductCatalog.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
}

function fingerprint(grandTotal: number, panelCount: number, cableRolls: number, sectionTotals: number[]): string {
  const payload = [grandTotal, panelCount, cableRolls, ...sectionTotals].join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  for (const tier of EQUIPMENT_TIERS) {
    for (const systemType of SYSTEM_TYPES) {
      for (const structureType of STRUCTURE_TYPES) {
        const label = `${sizeKw}kW/${tier}/${systemType}/${structureType}`;
        const { draft, template } = generateSolarProposal({
          systemSizeKw: sizeKw,
          tier,
          systemType,
          structureType,
        });

        check(`${label} has 7 BOQ sections`, draft.sections.length === 7);
        check(`${label} section order valid`, assertBoqSectionOrder(draft.sections));
        check(`${label} panel count matches rule`, draft.panelCount === panelCountForSystem(sizeKw));
        check(`${label} grand total positive`, draft.pricing.grandTotal > 0);
        check(`${label} cable rolls >= 1`, draft.cableRolls >= 1);
        check(`${label} cable roll pricing 20k`, draft.sections[1].lines[0].unitPrice === CABLE_ROLL_PRICE);
        check(`${label} template cover size`, template.cover.systemSizeLabel === `${sizeKw} kW`);
        check(`${label} all section labels present`, draft.sections.every((s) => s.label === BOQ_SECTION_LABELS[s.id]));

        if (systemType === "on-grid") {
          check(`${label} on-grid has no battery line`, !draft.sections[0].lines.some((l) => l.name.toLowerCase().includes("battery")));
        } else {
          check(`${label} hybrid/off-grid has battery`, draft.sections[0].lines.some((l) => l.name.toLowerCase().includes("battery")));
        }

        if (structureType === "elevated_hbeam") {
          check(`${label} elevated structure line`, draft.sections[5].lines[0].name.toLowerCase().includes("elevated"));
        } else {
          check(`${label} standard structure line`, draft.sections[5].lines[0].name.toLowerCase().includes("standard"));
        }

        const sectionTotals = draft.sections.map((s) => s.subtotal);
        const sumSections = sectionTotals.reduce((a, b) => a + b, 0);
        check(`${label} section subtotals sum to grand total`, Math.abs(sumSections - draft.pricing.grandTotal) < 0.02);

        const fp = fingerprint(draft.pricing.grandTotal, draft.panelCount, draft.cableRolls, sectionTotals);
        const fp2 = fingerprint(draft.pricing.grandTotal, draft.panelCount, draft.cableRolls, sectionTotals);
        check(`${label} fingerprint stable`, fp === fp2);
      }
    }
  }
}

for (const sizeKw of SUPPORTED_SYSTEM_SIZES_KW) {
  check(`size ${sizeKw} elevated >= standard`, (() => {
    const std = generateSolarProposal({ systemSizeKw: sizeKw, tier: "budget", systemType: "on-grid", structureType: "standard" });
    const elev = generateSolarProposal({ systemSizeKw: sizeKw, tier: "budget", systemType: "on-grid", structureType: "elevated_hbeam" });
    return elev.draft.pricing.grandTotal > std.draft.pricing.grandTotal;
  })());
}

for (const score of [0, 3, 7, 10]) {
  check(`complexity score ${score} monotonic rolls`, (() => {
    const low = generateSolarProposal({
      systemSizeKw: 10,
      tier: "budget",
      systemType: "off-grid",
      structureType: "elevated_hbeam",
      siteComplexityScore: 0,
    });
    const high = generateSolarProposal({
      systemSizeKw: 10,
      tier: "budget",
      systemType: "off-grid",
      structureType: "elevated_hbeam",
      siteComplexityScore: score,
    });
    return high.draft.cableRolls >= low.draft.cableRolls;
  })());
}

check("matrix elevated structure strictly costs more than standard at 5kW", (() => {
  const std = generateSolarProposal({ systemSizeKw: 5, tier: "budget", systemType: "on-grid", structureType: "standard" });
  const elev = generateSolarProposal({ systemSizeKw: 5, tier: "budget", systemType: "on-grid", structureType: "elevated_hbeam" });
  return elev.draft.pricing.grandTotal > std.draft.pricing.grandTotal;
})());

check("matrix complexity score 10 yields more cable rolls than score 0 at 10kW off-grid", (() => {
  const low = generateSolarProposal({
    systemSizeKw: 10,
    tier: "budget",
    systemType: "off-grid",
    structureType: "elevated_hbeam",
    siteComplexityScore: 0,
  });
  const high = generateSolarProposal({
    systemSizeKw: 10,
    tier: "budget",
    systemType: "off-grid",
    structureType: "elevated_hbeam",
    siteComplexityScore: 10,
  });
  return high.draft.cableRolls >= low.draft.cableRolls && high.draft.inputSummary.siteComplexityScore === 10;
})());

check("matrix draft has inputSummary not raw input", (() => {
  const { draft } = generateSolarProposal({
    systemSizeKw: 3,
    tier: "budget",
    systemType: "on-grid",
    structureType: "standard",
  });
  return "inputSummary" in draft && !("input" in draft);
})());

console.log(`\nSolar Proposal matrix tests: ${pass} passed.`);
