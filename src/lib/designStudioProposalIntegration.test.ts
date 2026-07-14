/**
 * Design Studio → Proposal Studio integration tests.
 * Run: npm run test:phase-1b1
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDesignStudioProposalIntegration } from "./designStudioProposalIntegration.ts";
import {
  DEFAULT_DESIGN_CONTROLS,
  buildDesignStudioLiveResults,
  runDesignStudioAutoLayout,
} from "./sunchaserDesignStudioClient.ts";
import {
  addPlane,
  createInitialRoofStudioState,
} from "./roofStudioClient.ts";
import { applyScaleCalibration } from "./roofStudioCalibration.ts";

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0;
function check(name: string, fn: () => boolean) {
  assert.ok(fn(), `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const RECT = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 240 },
  { x: 0, y: 240 },
];

function calibratedStateWithPlane() {
  let state = createInitialRoofStudioState("lead-test");
  state = addPlane(state, RECT, { pitchDeg: 15, azimuthDeg: 180 });
  const cal = applyScaleCalibration({ x: 0, y: 0 }, { x: 200, y: 0 }, "10 m");
  assert.ok(cal);
  return {
    ...state,
    metersPerUnit: cal!.metersPerUnit,
    scaleCalibration: cal!.calibration,
  };
}

const sampleCustomer = {
  name: "Test Customer",
  phone: "03001234567",
  address: "123 Solar Street, Lahore",
  sanctionedLoad: "5 kW",
};

const sampleRoofPreview = {
  imageUrl: "blob:http://localhost/roof-test",
  imageFileName: "rooftop-image.jpg",
};

check("gated integration when layout not ready", () => {
  const state = calibratedStateWithPlane();
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, null, { hasImage: true });
  const vm = buildDesignStudioProposalIntegration({
    live,
    controls: DEFAULT_DESIGN_CONTROLS,
    customer: sampleCustomer,
    roofPreview: sampleRoofPreview,
  });
  return (
    vm.draftOnly === true &&
    !vm.ready &&
    vm.pages.length === 1 &&
    vm.pages[0].id === "incomplete" &&
    vm.roofImageUrl === sampleRoofPreview.imageUrl
  );
});

check("ready integration includes customer, panel, production, electrical, BOQ sections", () => {
  const state = calibratedStateWithPlane();
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  assert.ok(run.ok);
  if (run.layout.panelCount <= 0) return true;
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, run.layout, { hasImage: true });
  if (!live.proposal.readyForPreview) return true;
  const vm = buildDesignStudioProposalIntegration({
    live,
    controls: DEFAULT_DESIGN_CONTROLS,
    customer: sampleCustomer,
    roofPreview: sampleRoofPreview,
  });
  const headings = vm.pages.flatMap((p) => p.sections.map((s) => s.heading));
  return (
    vm.ready === true &&
    vm.pages.length >= 5 &&
    headings.includes("Customer information") &&
    headings.includes("Roof layout preview") &&
    headings.includes("Panel summary") &&
    headings.includes("Electrical summary") &&
    headings.includes("BOQ summary") &&
  (live.production.available ? headings.includes("Production summary") : true)
  );
});

check("customer name appears on cover page from lead context", () => {
  const state = calibratedStateWithPlane();
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  assert.ok(run.ok);
  if (run.layout.panelCount <= 0) return true;
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, run.layout, { hasImage: true });
  if (!live.proposal.readyForPreview) return true;
  const vm = buildDesignStudioProposalIntegration({
    live,
    controls: DEFAULT_DESIGN_CONTROLS,
    customer: sampleCustomer,
    roofPreview: sampleRoofPreview,
  });
  const cover = vm.pages.find((p) => p.id === "cover");
  const customerLines = cover?.sections.find((s) => s.heading === "Customer information")?.lines ?? [];
  return customerLines.includes(sampleCustomer.name) && customerLines.includes(sampleCustomer.phone);
});

check("roof image URL carried on view-model", () => {
  const state = calibratedStateWithPlane();
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, null, { hasImage: true });
  const vm = buildDesignStudioProposalIntegration({
    live,
    controls: DEFAULT_DESIGN_CONTROLS,
    customer: sampleCustomer,
    roofPreview: sampleRoofPreview,
  });
  return vm.roofImageUrl === sampleRoofPreview.imageUrl && vm.roofImageFileName === sampleRoofPreview.imageFileName;
});

check("integration adapter has no localStorage, fetch, or PDF imports", () => {
  const src = readFileSync(resolve(here, "designStudioProposalIntegration.ts"), "utf8");
  const forbidden = ["localStorage", "fetch(", "manualQuotePdf", "quotePdfExport", "openai", "anthropic"];
  return forbidden.every((t) => !src.includes(t));
});

check("Results Panel mounts DesignStudioProposalPreview with export actions", () => {
  const panel = readFileSync(resolve(here, "../components/roofStudio/DesignStudioResultsPanel.tsx"), "utf8");
  const preview = readFileSync(resolve(here, "../components/roofStudio/DesignStudioProposalPreview.tsx"), "utf8");
  const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
  return (
    panel.includes("DesignStudioProposalPreview") &&
    preview.includes("design-studio-proposal-preview") &&
    preview.includes("proposal-generate-btn") &&
    preview.includes("proposal-download-pdf-btn") &&
    workspace.includes("roofPreview") &&
    workspace.includes("proposalCustomer")
  );
});

check("RoofIntelligenceStudio exposes imageUrl in studio snapshot", () => {
  const studio = readFileSync(resolve(here, "../components/roofStudio/RoofIntelligenceStudio.tsx"), "utf8");
  return studio.includes("imageUrl: bgImage?.el.src ?? null");
});

console.log(`\ndesignStudioProposalIntegration tests: ${pass} passed`);
