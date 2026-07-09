import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertStudioProposalDraftSafe,
  buildStudioProposalViewModel,
  flattenBoqSections,
  snapToSupportedSystemSizeKw,
} from "./solarProposalStudioClient.ts";
import { generateSolarProposal } from "../../server/solar/proposal/SolarProposalEngine.ts";
import { DESIGN_INCOMPLETE_MESSAGE } from "./solarDesignStudio.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const rectangle = [
  { x: 50, y: 50 },
  { x: 750, y: 50 },
  { x: 750, y: 450 },
  { x: 50, y: 450 },
];

const baseStudio = {
  roofBoundary: rectangle,
  obstacles: [] as { id: string; x: number; y: number; w: number; h: number }[],
  structureType: "standard" as const,
  systemType: "on-grid" as const,
  packageTier: "budget" as const,
  targetSystemKw: 5 as const,
  roofWidthMeters: 12,
  roofDepthMeters: 8,
  panelWattage: 580,
  canvasWidth: 800,
  canvasHeight: 500,
};

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("snapToSupportedSystemSizeKw picks nearest supported size", snapToSupportedSystemSizeKw(7) === 6 || snapToSupportedSystemSizeKw(7) === 8);

check(
  "studio view model uses engine grand total and 7 BOQ sections",
  (() => {
    const vm = buildStudioProposalViewModel(baseStudio);
    const engine = generateSolarProposal({
      systemSizeKw: 5,
      tier: "budget",
      systemType: "on-grid",
      structureType: "standard",
      panelWattage: 580,
      roofBoundary: rectangle,
      roofWidthMeters: 12,
      canvasWidth: 800,
    });
    return (
      vm.draftOnly === true &&
      vm.designComplete &&
      vm.grandTotal === engine.draft.pricing.grandTotal &&
      vm.boqSections.length === 7 &&
      vm.panelCount === engine.draft.panelCount
    );
  })()
);

check(
  "incomplete roof returns zero total and incomplete message",
  (() => {
    const vm = buildStudioProposalViewModel({ ...baseStudio, roofBoundary: [] });
    return !vm.designComplete && vm.grandTotal === 0 && vm.boqPreviewLines.length === 0;
  })()
);

check(
  "panelWattage 0 rejected via engine validation message",
  (() => {
    const vm = buildStudioProposalViewModel({ ...baseStudio, panelWattage: 0 });
    return !vm.designComplete && vm.grandTotal === 0 && (vm.validationMessage?.includes("panelWattage") ?? false);
  })()
);

check(
  "arbitrary PII not present in studio JSON output",
  (() => {
    const malicious = {
      ...baseStudio,
      customerName: "Fatima Shah",
      phone: "03001234567",
    } as typeof baseStudio & { customerName: string; phone: string };
    const vm = buildStudioProposalViewModel(malicious);
    const blob = JSON.stringify(vm);
    return (
      !blob.includes("Fatima") &&
      !blob.includes("03001234567") &&
      !blob.includes('"input"') &&
      (vm.inputSummary === null || assertStudioProposalDraftSafe({ generatedAt: "", inputSummary: vm.inputSummary, panelCount: 0, systemSizeKw: 0, cableDistanceM: 0, cableRolls: 0, structureCost: 0, sections: [], pricing: { subtotalCost: 0, subtotalPrice: 0, marginPercent: 0, marginAmount: 0, grandTotal: 0 }, assumptions: [], warnings: [] }))
    );
  })()
);

check(
  "flattenBoqSections skips zero-priced allowance lines",
  (() => {
    const vm = buildStudioProposalViewModel(baseStudio);
    return vm.boqPreviewLines.every((l) => l.indicativeRate > 0 && l.lineTotal > 0);
  })()
);

check(
  "empty boundary validation message matches design incomplete copy",
  (() => {
    const vm = buildStudioProposalViewModel({ ...baseStudio, roofBoundary: [{ x: 1, y: 1 }] });
    return vm.validationMessage === DESIGN_INCOMPLETE_MESSAGE;
  })()
);

check(
  "SolarProposalStudio component does not call save or API routes",
  (() => {
    const source = readFileSync(join(__dirname, "../components/quoteAuthoring/SolarProposalStudio.tsx"), "utf8");
    const forbidden = /apiFetch|authorizedFetch|handleSaveQuote|create-quote|generatePdf|\/api\//i;
    return !forbidden.test(source) && source.includes("buildStudioProposalViewModel");
  })()
);

console.log(`\nsolarProposalStudioClient tests: ${pass} passed`);
