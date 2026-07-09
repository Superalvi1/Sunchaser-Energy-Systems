import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSolarDesignPipeline } from "../../server/solar/pipeline/SolarDesignPipeline.ts";
import { DESIGN_INCOMPLETE_MESSAGE } from "./solarDesignStudio.ts";
import {
  assertPipelineStudioOutputSafe,
  buildPipelineStudioViewModel,
} from "./solarPipelineClient.ts";
import { isProposalStudioEnabled } from "./studioFeatureFlags.ts";

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

const FORBIDDEN_STUDIO_SIZING =
  /layoutPanels\s*\(|import\s*\{[^}]*\blayoutPanels\b|panelCountForSystem\s*\(|import\s*\{[^}]*\bpanelCountForSystem\b|resolveStudioSystemSizeKw\s*\(|export\s*(function|const)?\s*resolveStudioSystemSizeKw/;

function readStudioIntegrationSources(): string {
  return [
    join(__dirname, "solarPipelineClient.ts"),
    join(__dirname, "solarProposalStudioClient.ts"),
    join(__dirname, "../components/quoteAuthoring/SolarProposalStudio.tsx"),
  ]
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
}

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check(
  "pipeline success renders production and BOQ",
  (() => {
    const vm = buildPipelineStudioViewModel(baseStudio);
    return (
      vm.pipelineSuccess &&
      vm.designComplete &&
      vm.annualProductionKwh > 0 &&
      vm.monthlyProduction.length === 12 &&
      vm.boqSections.length === 7 &&
      vm.boqPreviewLines.length > 0 &&
      vm.grandTotal > 0 &&
      vm.panelCells.length > 0
    );
  })()
);

check(
  "auto target system size resolved by pipeline not UI",
  (() => {
    const vm = buildPipelineStudioViewModel({ ...baseStudio, targetSystemKw: "auto" });
    return vm.pipelineSuccess && vm.designComplete && vm.systemSizeKw > 0 && vm.panelCount > 0;
  })()
);

check(
  "invalid roof obstacle shows validation error",
  (() => {
    const vm = buildPipelineStudioViewModel({
      ...baseStudio,
      obstacles: [{ id: "bad", x: Number.NaN, y: 10, w: 20, h: 20 }],
    });
    return (
      !vm.pipelineSuccess &&
      !vm.designComplete &&
      vm.pipelineStage === "validation" &&
      vm.pipelineCode === "INVALID_CANVAS_GEOMETRY" &&
      vm.fixGuidance.length > 0
    );
  })()
);

check(
  "pipeline failure does not show priced proposal",
  (() => {
    const vm = buildPipelineStudioViewModel({
      ...baseStudio,
      obstacles: [{ id: "bad", x: Number.NaN, y: 10, w: 20, h: 20 }],
    });
    return vm.grandTotal === 0 && vm.boqPreviewLines.length === 0;
  })()
);

check(
  "pipeline view model matches pipeline grand total",
  (() => {
    const vm = buildPipelineStudioViewModel(baseStudio);
    const pipeline = runSolarDesignPipeline({
      systemSizeKw: 5,
      tier: "budget",
      systemType: "on-grid",
      structureType: "standard",
      panelWattage: 580,
      roofBoundary: rectangle,
      roofWidthMeters: 12,
      canvasWidth: 800,
      canvasHeight: 500,
    });
    return (
      pipeline.success &&
      vm.grandTotal === pipeline.result.draft.pricing.grandTotal &&
      vm.panelCount === pipeline.result.draft.panelCount
    );
  })()
);

check(
  "no raw PII in pipeline studio JSON output",
  (() => {
    const malicious = {
      ...baseStudio,
      customerName: "Fatima Shah",
      phone: "03001234567",
    } as typeof baseStudio & { customerName: string; phone: string };
    const vm = buildPipelineStudioViewModel(malicious);
    const blob = JSON.stringify(vm);
    return (
      !blob.includes("Fatima") &&
      !blob.includes("03001234567") &&
      !blob.includes('"input"') &&
      assertPipelineStudioOutputSafe(vm.inputSummary)
    );
  })()
);

check(
  "incomplete roof returns zero total",
  (() => {
    const vm = buildPipelineStudioViewModel({ ...baseStudio, roofBoundary: [] });
    return !vm.designComplete && vm.grandTotal === 0 && vm.validationMessage === DESIGN_INCOMPLETE_MESSAGE;
  })()
);

check(
  "panelWattage 0 rejected with validation message",
  (() => {
    const vm = buildPipelineStudioViewModel({ ...baseStudio, panelWattage: 0 });
    return !vm.designComplete && vm.grandTotal === 0 && (vm.validationMessage?.includes("panelWattage") ?? false);
  })()
);

check(
  "Proposal Studio integration does not import layoutPanels",
  (() => !FORBIDDEN_STUDIO_SIZING.test(readStudioIntegrationSources()))()
);

check(
  "solarPipelineClient has no fetch or localStorage",
  (() => {
    const source = readFileSync(join(__dirname, "solarPipelineClient.ts"), "utf8");
    return !/fetch\s*\(|localStorage|sessionStorage|apiFetch|authorizedFetch/i.test(source);
  })()
);

check(
  "SolarProposalStudio component uses pipeline client without API/save/AI",
  (() => {
    const source = readFileSync(join(__dirname, "../components/quoteAuthoring/SolarProposalStudio.tsx"), "utf8");
    const forbidden = /apiFetch|authorizedFetch|handleSaveQuote|create-quote|generatePdf|\/api\/|localStorage|openai|anthropic/i;
    return !forbidden.test(source) && source.includes("buildPipelineStudioViewModel");
  })()
);

check(
  "feature flag hides Proposal Studio when false",
  (() => {
    const prev = process.env.VITE_ENABLE_PROPOSAL_STUDIO;
    process.env.VITE_ENABLE_PROPOSAL_STUDIO = "false";
    const enabled = isProposalStudioEnabled();
    if (prev === undefined) delete process.env.VITE_ENABLE_PROPOSAL_STUDIO;
    else process.env.VITE_ENABLE_PROPOSAL_STUDIO = prev;
    return enabled === false;
  })()
);

console.log(`\nsolarPipelineClient tests: ${pass} passed`);
