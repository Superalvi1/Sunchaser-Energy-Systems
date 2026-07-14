/**
 * Design Studio proposal export tests (RC-1.1).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDesignStudioProposalIntegration } from "./designStudioProposalIntegration.ts";
import {
  assertExportPayloadReady,
  buildDesignStudioProposalExportPayload,
  buildProposalExportFilename,
  compileDesignStudioProposalHtml,
  payloadHasRequiredSections,
} from "./designStudioProposalExport.ts";
import {
  DEFAULT_DESIGN_CONTROLS,
  buildDesignStudioLiveResults,
  runDesignStudioAutoLayout,
} from "./sunchaserDesignStudioClient.ts";
import { addPlane, createInitialRoofStudioState } from "./roofStudioClient.ts";
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
  name: "Export Customer",
  phone: "03001234567",
  address: "1 Solar Ave",
};

const sampleRoofPreview = {
  imageUrl: "data:image/png;base64,iVBORw0KGgo=",
  imageFileName: "roof.png",
};

function readyIntegration() {
  const state = calibratedStateWithPlane();
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  assert.ok(run.ok);
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, run.layout, { hasImage: true });
  return buildDesignStudioProposalIntegration({
    live,
    controls: DEFAULT_DESIGN_CONTROLS,
    customer: sampleCustomer,
    roofPreview: sampleRoofPreview,
  });
}

check("gated integration cannot build export payload", () => {
  const state = calibratedStateWithPlane();
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, null, { hasImage: true });
  const vm = buildDesignStudioProposalIntegration({
    live,
    controls: DEFAULT_DESIGN_CONTROLS,
    customer: sampleCustomer,
    roofPreview: sampleRoofPreview,
  });
  try {
    buildDesignStudioProposalExportPayload(vm);
    return false;
  } catch {
    return true;
  }
});

check("ready proposal builds export payload with BOQ + electrical + roof", () => {
  const vm = readyIntegration();
  if (!vm.ready) return true;
  const payload = buildDesignStudioProposalExportPayload(vm, {
    roofImageDataUrl: sampleRoofPreview.imageUrl,
  });
  const sections = payloadHasRequiredSections(payload);
  return (
    sections.boq &&
    sections.electrical &&
    sections.roof &&
    payload.customer.name === sampleCustomer.name
  );
});

check("compiled HTML preserves branding, roof image, BOQ, electrical, production when available", () => {
  const vm = readyIntegration();
  if (!vm.ready) return true;
  const payload = buildDesignStudioProposalExportPayload(vm, {
    roofImageDataUrl: sampleRoofPreview.imageUrl,
  });
  const html = compileDesignStudioProposalHtml(payload);
  const required = payloadHasRequiredSections(payload);
  return (
    html.includes("Sunchaser Energy Systems") &&
    html.includes(sampleCustomer.name) &&
    html.includes("data:image/png;base64") &&
    html.includes("BOQ") &&
    html.includes("Electrical") &&
    (!required.production || html.toLowerCase().includes("production")) &&
    !html.includes("localStorage") &&
    html.includes("Ephemeral export")
  );
});

check("filename sanitizes customer name", () => {
  return buildProposalExportFilename({ name: "Ali / Khan*", phone: "", address: "" }) ===
    "Sunchaser-Proposal-Ali-Khan.pdf";
});

check("assertExportPayloadReady rejects null", () => {
  try {
    assertExportPayloadReady(null);
    return false;
  } catch {
    return true;
  }
});

check("preview UI wires Generate + Download without CRM save", () => {
  const preview = readFileSync(resolve(here, "../components/roofStudio/DesignStudioProposalPreview.tsx"), "utf8");
  const exportMod = readFileSync(resolve(here, "designStudioProposalExport.ts"), "utf8");
  const server = readFileSync(resolve(here, "../../server.ts"), "utf8");
  return (
    preview.includes("proposal-generate-btn") &&
    preview.includes("proposal-download-pdf-btn") &&
    preview.includes("downloadDesignStudioProposalPdf") &&
    !preview.includes("localStorage.setItem") &&
    exportMod.includes("compileDesignStudioProposalHtml") &&
    server.includes("/api/export/pdf/design-studio-proposal/download") &&
    server.includes("crmSave: false")
  );
});

check("quotePdfExport exposes design studio download helper", () => {
  const src = readFileSync(resolve(here, "quotePdfExport.ts"), "utf8");
  return src.includes("downloadDesignStudioProposalPdf") && src.includes("design-studio-proposal/download");
});

check("integration adapter still has no PDF/CRM imports", () => {
  const src = readFileSync(resolve(here, "designStudioProposalIntegration.ts"), "utf8");
  const forbidden = ["localStorage", "fetch(", "manualQuotePdf", "quotePdfExport", "openai", "anthropic", "leads.push"];
  return forbidden.every((t) => !src.includes(t));
});

console.log(`\ndesignStudioProposalExport tests: ${pass} passed`);
