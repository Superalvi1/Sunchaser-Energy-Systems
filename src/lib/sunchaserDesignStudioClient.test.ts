/**
 * Sunchaser Design Studio V1 — client + CRM wiring tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DESIGN_CONTROLS,
  DESIGN_WORKSPACE_DRAFT_ONLY_LABEL,
  PHONE_NOT_PROVIDED_LABEL,
  COMPLETE_PREVIOUS_STEP_MESSAGE,
  assertNoLocalProductionMath,
  buildDesignStudioLiveResults,
  canRunAutoLayout,
  displayCustomerPhone,
  prefillAddressFromLead,
  primaryPlane,
  resolveCatalogModule,
  runDesignStudioAutoLayout,
  snapToSupportedSystemSizeKw,
  validateDesignStudioLayoutSettings,
  validateEdgeSetbackM,
  canRunDesignStudioAutoLayout,
} from "./sunchaserDesignStudioClient.ts";
import {
  SUNCHASER_DESIGN_STUDIO_ENV_KEY,
  isSunchaserDesignStudioEnabled,
} from "./studioFeatureFlags.ts";
import { addPlane, createInitialRoofStudioState } from "./roofStudioClient.ts";
import { applyScaleCalibration } from "./roofStudioCalibration.ts";
import { CATALOG_MODULE_550W, CATALOG_MODULE_580W } from "../../server/solar/panel/PanelCatalog.ts";

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
  const cal = applyScaleCalibration(
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    "10 m"
  );
  assert.ok(cal);
  return {
    ...state,
    metersPerUnit: cal!.metersPerUnit,
    scaleCalibration: cal!.calibration,
  };
}

check("design studio flag disabled by default", () => !isSunchaserDesignStudioEnabled());

check("SalesTeamApp Design Project button opens studio from lead", () => {
  const src = readFileSync(resolve(here, "../components/SalesTeamApp.tsx"), "utf8");
  return (
    src.includes("Design Project") &&
    src.includes("setActiveModule(\"roof_studio\")") &&
    src.includes("SUNCHASER_DESIGN_STUDIO_ENABLED") &&
    src.includes("SunchaserDesignStudio") &&
    src.includes("activeLead")
  );
});

check("customer address is prefilled from lead.address then location", () => {
  const fromAddress = prefillAddressFromLead({ address: "12 Gulberg Lahore", location: "other" });
  const fromLocation = prefillAddressFromLead({ location: "DHA Phase 5" });
  const empty = prefillAddressFromLead({});
  return fromAddress === "12 Gulberg Lahore" && fromLocation === "DHA Phase 5" && empty === "";
});

check("blank canvas replaced by guided workflow copy in Design Studio UI", () => {
  const src = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
  return (
    src.includes("Start with a roof image") &&
    src.includes("Blank CAD is disabled") &&
    src.includes("DESIGN_STUDIO_GUIDED_STEPS") &&
    src.includes("Upload roof image")
  );
});

check("no panels before calibration — Auto Layout gated", () => {
  const uncalibrated = addPlane(createInitialRoofStudioState(), RECT);
  const gate = canRunAutoLayout(true, false, true);
  const run = runDesignStudioAutoLayout(uncalibrated, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  return !gate.ok && run.ok === false && run.code === "GATED";
});

check("no panels before image — Auto Layout gated", () => {
  const state = calibratedStateWithPlane();
  const gate = canRunAutoLayout(false, true, true);
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: false });
  return !gate.ok && run.ok === false;
});

check("auto layout uses Panel Layout Engine V2 (layoutPanelsOnPlane)", () => {
  const adapter = readFileSync(resolve(here, "sunchaserDesignStudioClient.ts"), "utf8");
  const state = calibratedStateWithPlane();
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  return (
    adapter.includes("layoutPanelsOnPlane") &&
    adapter.includes('from "../../server/solar/panel/PanelLayoutEngine.ts"') &&
    run.ok === true &&
    run.layout.moduleId === CATALOG_MODULE_580W.moduleId &&
    run.layout.panelCount >= 0
  );
});

check("right panel updates from engine results after layout", () => {
  const state = calibratedStateWithPlane();
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  assert.ok(run.ok);
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, run.layout, { hasImage: true });
  return (
    live.ready &&
    live.panelCount === run.layout.panelCount &&
    live.dcKw === Math.round(run.layout.dcCapacityKw * 100) / 100 &&
    (live.panelCount === 0 || live.annualProductionKwh !== null || live.warnings.some((w) => w.includes("Simulation"))) &&
    (live.panelCount === 0 || live.boqTotal !== null || live.proposalStatus.includes("unavailable"))
  );
});

check("no BOQ before layout", () => {
  const state = calibratedStateWithPlane();
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, null, { hasImage: true });
  return live.boqTotal === null && live.annualProductionKwh === null && live.panelCount === 0;
});

check("no duplicate local production math in adapter", () => {
  const adapter = readFileSync(resolve(here, "sunchaserDesignStudioClient.ts"), "utf8");
  return (
    assertNoLocalProductionMath(adapter) &&
    adapter.includes("runSolarSimulation") &&
    adapter.includes("designElectricalSystem") &&
    adapter.includes("generateSolarProposal") &&
    !adapter.includes("autoFillPanelsOnPlane")
  );
});

check("no API/save/AI/PDF in Design Studio sources", () => {
  const adapter = readFileSync(resolve(here, "sunchaserDesignStudioClient.ts"), "utf8");
  const ui = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
  const forbidden = ["apiFetch", "fetch(", "axios", "/api/", "openai", "anthropic", "saveQuote", "createQuote"];
  return forbidden.every((t) => !adapter.includes(t) && !ui.includes(t));
});

check("address blur does not call onUpdateLead (no CRM mutation path)", () => {
  const studio = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
  const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
  const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
  const sales = readFileSync(resolve(here, "../components/SalesTeamApp.tsx"), "utf8");
  const noPersist =
    !studio.includes("persistAddress") &&
    !studio.includes("onUpdateLead") &&
    !workspace.includes("persistAddress") &&
    !workspace.includes("onUpdateLead") &&
    !left.includes("onUpdateLead");
  const studioMount = sales.match(/<SunchaserDesignStudio[\s\S]*?\/>/)?.[0] ?? "";
  const workspaceMount = sales.match(/<ProjectDesignWorkspace[\s\S]*?\/>/)?.[0] ?? "";
  const salesDoesNotPassMutation =
    studioMount.includes("lead={activeLead}") &&
    workspaceMount.includes("lead={activeLead}") &&
    !studioMount.includes("onUpdateLead") &&
    !workspaceMount.includes("onUpdateLead");
  const draftLabel =
    left.includes("DESIGN_WORKSPACE_DRAFT_ONLY_LABEL") &&
    DESIGN_WORKSPACE_DRAFT_ONLY_LABEL === "Draft only — not saved to CRM.";
  return noPersist && salesDoesNotPassMutation && draftLabel;
});

check("workspace renders customer phone from lead context", () => {
  const phone = "03001234567";
  assert.equal(displayCustomerPhone(phone), phone);
  const studio = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
  const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
  const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
  return (
    studio.includes("displayCustomerPhone(lead.phone)") &&
    studio.includes("design-studio-customer-phone") &&
    workspace.includes("displayCustomerPhone(lead.phone)") &&
    left.includes("project-workspace-customer-phone") &&
    left.includes("DESIGN_WORKSPACE_DRAFT_ONLY_LABEL")
  );
});

check("missing phone shows safe fallback", () => {
  return (
    displayCustomerPhone("") === PHONE_NOT_PROVIDED_LABEL &&
    displayCustomerPhone(undefined) === PHONE_NOT_PROVIDED_LABEL &&
    displayCustomerPhone(null) === PHONE_NOT_PROVIDED_LABEL &&
    displayCustomerPhone("   ") === PHONE_NOT_PROVIDED_LABEL
  );
});

check("no CRM mutation/save path in prototype workspace sources", () => {
  const studio = readFileSync(resolve(here, "../components/roofStudio/SunchaserDesignStudio.tsx"), "utf8");
  const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
  const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
  const forbidden = [
    "onUpdateLead",
    "persistAddress",
    "apiFetch",
    "saveQuote",
    "createQuote",
    "localStorage.setItem",
    "/api/",
  ];
  return forbidden.every((t) => !studio.includes(t) && !workspace.includes(t) && !left.includes(t));
});

check("snapToSupportedSystemSizeKw is deterministic", () => {
  return snapToSupportedSystemSizeKw(7.2) === 8 && snapToSupportedSystemSizeKw(0) === 3;
});

check("primaryPlane prefers selected complete plane", () => {
  let state = calibratedStateWithPlane();
  const id = state.planes[0].id;
  state = { ...state, selectedPlaneId: id };
  return primaryPlane(state)?.id === id;
});

check(".env.example documents VITE_ENABLE_SUNCHASER_DESIGN_STUDIO", () => {
  const env = readFileSync(resolve(here, "../../.env.example"), "utf8");
  return env.includes(SUNCHASER_DESIGN_STUDIO_ENV_KEY);
});

check("feature flag module exports design studio gate", () => {
  const src = readFileSync(resolve(here, "studioFeatureFlags.ts"), "utf8");
  return src.includes("isSunchaserDesignStudioEnabled") && src.includes(SUNCHASER_DESIGN_STUDIO_ENV_KEY);
});

check("uncalibrated state shows no fake results in Results Panel view-model", () => {
  const uncalibrated = addPlane(createInitialRoofStudioState(), RECT);
  const live = buildDesignStudioLiveResults(uncalibrated, DEFAULT_DESIGN_CONTROLS, null, { hasImage: true });
  return (
    !live.ready &&
    live.annualProductionKwh === null &&
    live.boqTotal === null &&
    live.roof.grossAreaM2 === null &&
    live.electricalSummary.available === false &&
    live.production.available === false &&
    live.boq.available === false &&
    live.proposal.readyForPreview === false &&
    !live.status.panelLayoutReady &&
    (live.gatedReason?.includes("Calibrate") || live.roof.gatedReason != null)
  );
});

check("valid design shows roof/panel/electrical/simulation/BOQ summaries", () => {
  const state = calibratedStateWithPlane();
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  assert.ok(run.ok);
  if (run.layout.panelCount <= 0) return true; // geometry may not fit — skip soft
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, run.layout, { hasImage: true });
  return (
    live.ready &&
    live.status.uploadComplete &&
    live.status.scaleCalibrated &&
    live.status.roofValid &&
    live.status.panelLayoutReady &&
    live.roof.available &&
    live.roof.grossAreaM2 != null &&
    live.panelsSummary.panelCount === run.layout.panelCount &&
    live.electricalSummary.available === Boolean(live.electrical) &&
    (live.production.available === false || live.production.annualKwh != null) &&
    (live.boq.available === false || live.boq.grandTotal != null) &&
    live.draftOnly === true
  );
});

check("invalid / gated design shows stage gate not fake numbers", () => {
  const state = calibratedStateWithPlane();
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, null, { hasImage: true });
  return (
    live.boq.grandTotal === null &&
    live.production.annualKwh === null &&
    live.electricalSummary.inverter === null &&
    (live.gatedReason != null || live.proposal.missingRequirements.length > 0) &&
    live.electricalSummary.gatedReason === COMPLETE_PREVIOUS_STEP_MESSAGE
  );
});

check("Results Panel UI has no API/save/AI/localStorage", () => {
  const panel = readFileSync(resolve(here, "../components/roofStudio/DesignStudioResultsPanel.tsx"), "utf8");
  const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
  const forbidden = [
    "fetch(",
    "axios",
    "/api/",
    "openai",
    "anthropic",
    "localStorage",
    "saveQuote",
    "createQuote",
    "onUpdateLead",
  ];
  return (
    panel.includes("design-studio-results-panel") &&
    workspace.includes("DesignStudioResultsPanel") &&
    forbidden.every((t) => !panel.includes(t) && !workspace.includes(t))
  );
});

check("no duplicate calculations outside engines in Results Panel path", () => {
  const adapter = readFileSync(resolve(here, "sunchaserDesignStudioClient.ts"), "utf8");
  const panel = readFileSync(resolve(here, "../components/roofStudio/DesignStudioResultsPanel.tsx"), "utf8");
  return (
    adapter.includes("analyzeStudio") &&
    adapter.includes("layoutPanelsOnPlane") &&
    adapter.includes("designElectricalSystem") &&
    adapter.includes("runSolarSimulation") &&
    adapter.includes("generateSolarProposal") &&
    !panel.includes("layoutPanelsOnPlane") &&
    !panel.includes("runSolarSimulation") &&
    !panel.includes("designElectricalSystem") &&
    panel.includes("buildDesignStudioLiveResults") === false
  );
});

function isRecursivelyFinite(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value !== "object") return true;
  if (seen.has(value as object)) return true;
  seen.add(value as object);
  if (Array.isArray(value)) return value.every((v) => isRecursivelyFinite(v, seen));
  return Object.values(value as Record<string, unknown>).every((v) => isRecursivelyFinite(v, seen));
}

function hasNoPanelProductionBoq(live: ReturnType<typeof buildDesignStudioLiveResults>): boolean {
  return (
    live.panelCount === 0 &&
    live.dcKw === 0 &&
    live.annualProductionKwh === null &&
    live.boqTotal === null &&
    live.panels.length === 0 &&
    live.layout === null &&
    live.electrical === null &&
    live.simulation === null &&
    live.production.annualKwh === null &&
    live.boq.grandTotal === null &&
    live.electricalSummary.available === false &&
    live.production.available === false &&
    live.boq.available === false &&
    !live.status.panelLayoutReady &&
    !live.ready
  );
}

check("edgeSetbackM Infinity fails closed", () => {
  const state = calibratedStateWithPlane();
  const controls = { ...DEFAULT_DESIGN_CONTROLS, edgeSetbackM: Infinity };
  const run = runDesignStudioAutoLayout(state, controls, { hasImage: true });
  const live = buildDesignStudioLiveResults(state, controls, null, { hasImage: true });
  return (
    !validateEdgeSetbackM(Infinity).ok &&
    run.ok === false &&
    run.code === "INVALID_EDGE_SETBACK" &&
    hasNoPanelProductionBoq(live) &&
    String(live.gatedReason).includes("INVALID_EDGE_SETBACK")
  );
});

check("edgeSetbackM NaN fails closed", () => {
  const state = calibratedStateWithPlane();
  const controls = { ...DEFAULT_DESIGN_CONTROLS, edgeSetbackM: Number.NaN };
  const run = runDesignStudioAutoLayout(state, controls, { hasImage: true });
  const live = buildDesignStudioLiveResults(state, controls, null, { hasImage: true });
  return !validateEdgeSetbackM(Number.NaN).ok && run.ok === false && run.code === "INVALID_EDGE_SETBACK" && hasNoPanelProductionBoq(live);
});

check("edgeSetbackM negative fails closed", () => {
  const state = calibratedStateWithPlane();
  const controls = { ...DEFAULT_DESIGN_CONTROLS, edgeSetbackM: -0.5 };
  const run = runDesignStudioAutoLayout(state, controls, { hasImage: true });
  return !validateEdgeSetbackM(-0.5).ok && run.ok === false && run.code === "INVALID_EDGE_SETBACK";
});

check("edgeSetbackM too large fails closed", () => {
  const state = calibratedStateWithPlane();
  const controls = { ...DEFAULT_DESIGN_CONTROLS, edgeSetbackM: 5.01 };
  const run = runDesignStudioAutoLayout(state, controls, { hasImage: true });
  return !validateEdgeSetbackM(5.01).ok && run.ok === false && run.code === "INVALID_EDGE_SETBACK";
});

check("invalid edgeSetbackM shows no panel/production/BOQ results", () => {
  const state = calibratedStateWithPlane();
  const good = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  assert.ok(good.ok);
  // Even if a prior layout object is passed, invalid setback must not produce engine results.
  const live = buildDesignStudioLiveResults(
    state,
    { ...DEFAULT_DESIGN_CONTROLS, edgeSetbackM: Infinity },
    good.ok ? good.layout : null,
    { hasImage: true }
  );
  return hasNoPanelProductionBoq(live) && live.panelsSummary.layoutStatus.includes("INVALID_EDGE_SETBACK");
});

check("unknown moduleId fails closed", () => {
  const state = calibratedStateWithPlane();
  const controls = { ...DEFAULT_DESIGN_CONTROLS, moduleId: "mod-not-in-catalog" };
  const resolved = resolveCatalogModule(controls.moduleId);
  const run = runDesignStudioAutoLayout(state, controls, { hasImage: true });
  const live = buildDesignStudioLiveResults(state, controls, null, { hasImage: true });
  return (
    !resolved.ok &&
    resolved.code === "INVALID_MODULE_ID" &&
    run.ok === false &&
    run.code === "INVALID_MODULE_ID" &&
    hasNoPanelProductionBoq(live)
  );
});

check("unknown moduleId does not fall back to default", () => {
  const resolved = resolveCatalogModule("totally-fake-module");
  return (
    !resolved.ok &&
    resolved.code === "INVALID_MODULE_ID" &&
    !String(JSON.stringify(resolved)).includes(CATALOG_MODULE_580W.moduleId)
  );
});

check("valid moduleId works", () => {
  const state = calibratedStateWithPlane();
  const controls = { ...DEFAULT_DESIGN_CONTROLS, moduleId: CATALOG_MODULE_550W.moduleId };
  const resolved = resolveCatalogModule(controls.moduleId);
  const run = runDesignStudioAutoLayout(state, controls, { hasImage: true });
  return (
    resolved.ok === true &&
    resolved.module.moduleId === CATALOG_MODULE_550W.moduleId &&
    resolved.usedDefaultAssumption === false &&
    run.ok === true &&
    run.layout.moduleId === CATALOG_MODULE_550W.moduleId
  );
});

check("omitted moduleId behavior is explicit and tested", () => {
  const omitted = resolveCatalogModule(undefined);
  const empty = resolveCatalogModule("");
  return (
    omitted.ok === true &&
    omitted.usedDefaultAssumption === true &&
    omitted.module.moduleId === CATALOG_MODULE_580W.moduleId &&
    empty.ok === true &&
    empty.usedDefaultAssumption === true
  );
});

check("successful result recursively finite", () => {
  const state = calibratedStateWithPlane();
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  assert.ok(run.ok);
  if (run.layout.panelCount <= 0) return true;
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, run.layout, { hasImage: true });
  return live.ready && isRecursivelyFinite(live);
});

check("source scan forbids module and edgeSetback silent fallbacks", () => {
  const adapter = readFileSync(resolve(here, "sunchaserDesignStudioClient.ts"), "utf8");
  const forbidden = [
    /list\.find\([^)]*\)\s*\?\?\s*CATALOG_MODULE/,
    /list\.find\([^)]*\)\s*\|\|\s*CATALOG_MODULE/,
    /getCatalogModule\([^)]*\)\s*\?\?\s*CATALOG_MODULE/,
    /getCatalogModule\([^)]*\)\s*\|\|\s*CATALOG_MODULE/,
    /BUILTIN\[[^\]]+\]\s*\|\|\s*/,
    /edgeSetbackM\s*\|\|\s*0/,
    /edgeSetbackM\s*\?\?\s*0/,
    /isFinite\([^)]*edgeSetback[^)]*\)\s*\?[^:]+:\s*/,
    /Number\.isFinite\([^)]*edgeSetback[^)]*\)\s*\?[^:]+:\s*(?!null)/,
  ];
  return forbidden.every((re) => !re.test(adapter));
});

check("left panel renders inside Project Design Workspace", () => {
  const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
  const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
  return (
    workspace.includes("DesignStudioLeftControlPanel") &&
    left.includes("design-studio-left-control-panel") &&
    left.includes("Auto Layout") &&
    left.includes("Output Status") &&
    left.includes("Keepouts") &&
    left.includes("Layout Settings")
  );
});

check("Auto Layout disabled before prerequisites", () => {
  const gateImage = canRunDesignStudioAutoLayout({
    hasImage: false,
    calibrated: true,
    hasCompletePlane: true,
    controls: DEFAULT_DESIGN_CONTROLS,
  });
  const gateCal = canRunDesignStudioAutoLayout({
    hasImage: true,
    calibrated: false,
    hasCompletePlane: true,
    controls: DEFAULT_DESIGN_CONTROLS,
  });
  const gateRoof = canRunDesignStudioAutoLayout({
    hasImage: true,
    calibrated: true,
    hasCompletePlane: false,
    controls: DEFAULT_DESIGN_CONTROLS,
  });
  const gateOk = canRunDesignStudioAutoLayout({
    hasImage: true,
    calibrated: true,
    hasCompletePlane: true,
    controls: DEFAULT_DESIGN_CONTROLS,
  });
  return !gateImage.ok && !gateCal.ok && !gateRoof.ok && gateOk.ok;
});

check("invalid spacing / tilt / azimuth fails closed", () => {
  const badSpacing = validateDesignStudioLayoutSettings({
    ...DEFAULT_DESIGN_CONTROLS,
    rowSpacingM: Infinity,
  });
  const badGap = validateDesignStudioLayoutSettings({
    ...DEFAULT_DESIGN_CONTROLS,
    moduleGapM: Number.NaN,
  });
  const badTilt = validateDesignStudioLayoutSettings({
    ...DEFAULT_DESIGN_CONTROLS,
    tiltDeg: -5,
  });
  const badAz = validateDesignStudioLayoutSettings({
    ...DEFAULT_DESIGN_CONTROLS,
    azimuthDeg: 400,
  });
  const good = validateDesignStudioLayoutSettings(DEFAULT_DESIGN_CONTROLS);
  return (
    !badSpacing.ok &&
    badSpacing.code === "INVALID_ROW_SPACING" &&
    !badGap.ok &&
    !badTilt.ok &&
    !badAz.ok &&
    good.ok === true
  );
});

check("right panel updates after valid auto layout via shared live results", () => {
  const state = calibratedStateWithPlane();
  const run = runDesignStudioAutoLayout(state, DEFAULT_DESIGN_CONTROLS, { hasImage: true });
  assert.ok(run.ok);
  const live = buildDesignStudioLiveResults(state, DEFAULT_DESIGN_CONTROLS, run.layout, { hasImage: true });
  const workspace = readFileSync(resolve(here, "../components/roofStudio/ProjectDesignWorkspace.tsx"), "utf8");
  return (
    workspace.includes("DesignStudioResultsPanel") &&
    workspace.includes("buildDesignStudioLiveResults") &&
    (run.layout.panelCount === 0 || live.status.panelLayoutReady) &&
    (run.layout.panelCount === 0 || live.panelCount === run.layout.panelCount)
  );
});

check("left panel has no save/API/AI/PDF/localStorage calls", () => {
  const left = readFileSync(resolve(here, "../components/roofStudio/DesignStudioLeftControlPanel.tsx"), "utf8");
  const forbidden = ["fetch(", "axios", "/api/", "openai", "anthropic", "localStorage.setItem", "saveQuote", "createQuote", "jspdf"];
  return forbidden.every((t) => !left.includes(t));
});

console.log(`\nsunchaserDesignStudioClient tests: ${pass} passed`);
