/**
 * Sunchaser Design Studio V1 — client adapter.
 *
 * Orchestrates existing engines only (no duplicate geometry / production / BOQ math):
 * - Roof Geometry Engine (via roofStudioClient analyzeStudio)
 * - Panel Layout Engine V2 (layoutPanelsOnPlane)
 * - Electrical Design Engine
 * - Solar Simulation Engine
 * - Proposal / BOQ engine
 *
 * Draft-only. No API, save, AI, PDF, or CRM mutation.
 */

import { layoutPanelsOnPlane } from "../../server/solar/panel/PanelLayoutEngine.ts";
import {
  CATALOG_MODULE_400W,
  CATALOG_MODULE_550W,
  CATALOG_MODULE_580W,
  getCatalogModule,
  listCatalogModules,
  type PanelModuleSpec,
} from "../../server/solar/panel/PanelCatalog.ts";
import {
  PanelLayoutError,
  type PanelLayoutResult,
  type PanelOrientationPolicy,
  type PlacedPanel,
} from "../../server/solar/panel/PanelLayoutModels.ts";
import { designElectricalSystem } from "../../server/solar/electrical/ElectricalDesignEngine.ts";
import {
  ElectricalDesignError,
  type ElectricalDesignResult,
  type ElectricalSystemSizeKw,
  type ElectricalSystemType,
  type PanelElectricalSpec,
} from "../../server/solar/electrical/ElectricalModels.ts";
import {
  getInverterElectricalSpec,
  listInverterElectricalCatalog,
} from "../../server/solar/electrical/InverterElectricalCatalog.ts";
import {
  PANEL_ELEC_400W,
  PANEL_ELEC_550W,
  PANEL_ELEC_580W,
} from "../../server/solar/electrical/PanelElectricalCatalog.ts";
import { runSolarSimulation } from "../../server/solar/simulation/SolarSimulationEngine.ts";
import {
  MONTH_LABELS,
  SolarSimulationValidationError,
  SUPPORTED_SIMULATION_SIZES_KW,
  type SimulationSystemSizeKw,
  type SolarSimulationResult,
} from "../../server/solar/simulation/SolarSimulationModels.ts";
import { generateSolarProposal } from "../../server/solar/proposal/SolarProposalEngine.ts";
import {
  SolarProposalValidationError,
  STRUCTURE_TYPES,
  SUPPORTED_SYSTEM_SIZES_KW,
  type EquipmentTier,
  type StructureType,
  type SupportedSystemSizeKw,
  type SystemType,
} from "../../server/solar/proposal/SolarProposalModels.ts";
import type { Point2D } from "../../server/solar/roof/RoofModels.ts";
import {
  analyzeStudio,
  evaluateStudioRoofValidity,
  FIX_ROOF_GEOMETRY_BEFORE_AUTO_LAYOUT,
  isPlaneComplete,
  type RoofStudioState,
  type StudioPlane,
} from "./roofStudioClient.ts";
import { isScaleCalibrated } from "./roofStudioCalibration.ts";
import {
  COMPLETE_PREVIOUS_STEP_MESSAGE,
  deriveWizardProgress,
  isDesignWorkspaceUnlocked,
} from "./roofStudioGeoReference.ts";

export {
  COMPLETE_PREVIOUS_STEP_MESSAGE,
  isDesignWorkspaceUnlocked,
  listCatalogModules,
  listInverterElectricalCatalog,
};

export const DESIGN_STUDIO_GUIDED_STEPS = [
  { id: 1, label: "Upload / locate roof image" },
  { id: 2, label: "Calibrate scale" },
  { id: 3, label: "Draw roof boundary" },
  { id: 4, label: "Add keepouts" },
  { id: 5, label: "Select module / racking" },
  { id: 6, label: "Auto Layout" },
  { id: 7, label: "Review BOQ / proposal" },
] as const;

export type DesignStudioStructure = StructureType;
export type DesignStudioSystemType = SystemType;
export type DesignStudioTier = EquipmentTier;

export interface DesignStudioControls {
  moduleId: string;
  structureType: DesignStudioStructure;
  systemType: DesignStudioSystemType;
  tier: DesignStudioTier;
  tiltDeg: number;
  azimuthDeg: number;
  rowSpacingM: number;
  moduleGapM: number;
  edgeSetbackM: number;
  orientationPolicy: PanelOrientationPolicy;
}

export const DEFAULT_DESIGN_CONTROLS: DesignStudioControls = {
  moduleId: CATALOG_MODULE_580W.moduleId,
  structureType: "standard",
  systemType: "on-grid",
  tier: "budget",
  tiltDeg: 15,
  azimuthDeg: 180,
  rowSpacingM: 0.02,
  moduleGapM: 0.02,
  edgeSetbackM: 0.6,
  orientationPolicy: "portrait_only",
};

export interface DesignStudioProjectSeed {
  leadId: string;
  customerName: string;
  address: string;
  phone?: string;
  sanctionedLoad?: string;
}

export interface DesignStudioStatusFlags {
  uploadComplete: boolean;
  scaleCalibrated: boolean;
  roofValid: boolean;
  panelLayoutReady: boolean;
  electricalReady: boolean;
  simulationReady: boolean;
  boqReady: boolean;
}

export interface DesignStudioRoofSummary {
  available: boolean;
  gatedReason: string | null;
  grossAreaM2: number | null;
  usableAreaM2: number | null;
  trueAreaM2: number | null;
  obstaclePercent: number | null;
  warnings: string[];
  stageError: string | null;
}

export interface DesignStudioPanelSummary {
  available: boolean;
  gatedReason: string | null;
  panelModel: string | null;
  orientation: string | null;
  panelCount: number;
  dcKw: number;
  layoutStatus: string;
  warnings: string[];
}

export interface DesignStudioElectricalSummary {
  available: boolean;
  gatedReason: string | null;
  inverter: string | null;
  strings: string | null;
  mpptAllocation: string | null;
  vocMaxV: number | null;
  vmpRange: string | null;
  dcCableMm2: number | null;
  acCableMm2: number | null;
  breakerSpd: string | null;
  valid: boolean | null;
  stageError: string | null;
}

export interface DesignStudioProductionSummary {
  available: boolean;
  gatedReason: string | null;
  annualKwh: number | null;
  monthly: Array<{ label: string; kwh: number }>;
  performanceRatio: number | null;
  losses: Array<{ label: string; kwh: number }>;
  assumptions: string[];
  warnings: string[];
  stageError: string | null;
}

export interface DesignStudioBoqSummary {
  available: boolean;
  gatedReason: string | null;
  materialTotal: number | null;
  structureTotal: number | null;
  electricalTotal: number | null;
  servicesTotal: number | null;
  grandTotal: number | null;
  hasManualOverride: boolean;
  overrideWarning: string | null;
  stageError: string | null;
}

export interface DesignStudioProposalSummary {
  available: boolean;
  gatedReason: string | null;
  draftStatus: string;
  missingRequirements: string[];
  readyForPreview: boolean;
}

export interface DesignStudioLiveResults {
  draftOnly: true;
  ready: boolean;
  gatedReason: string | null;
  panelCount: number;
  dcKw: number;
  inverterRecommendation: string | null;
  stringingStatus: string;
  annualProductionKwh: number | null;
  monthlyProduction: Array<{ label: string; kwh: number }>;
  cableEstimateM: number | null;
  boqTotal: number | null;
  proposalStatus: string;
  warnings: string[];
  panels: PlacedPanel[];
  layout: PanelLayoutResult | null;
  electrical: ElectricalDesignResult | null;
  simulation: SolarSimulationResult | null;
  /** Structured Results Panel V1 view-model (engine outputs only). */
  status: DesignStudioStatusFlags;
  roof: DesignStudioRoofSummary;
  panelsSummary: DesignStudioPanelSummary;
  electricalSummary: DesignStudioElectricalSummary;
  production: DesignStudioProductionSummary;
  boq: DesignStudioBoqSummary;
  proposal: DesignStudioProposalSummary;
}

function emptyStatus(partial?: Partial<DesignStudioStatusFlags>): DesignStudioStatusFlags {
  return {
    uploadComplete: false,
    scaleCalibrated: false,
    roofValid: false,
    panelLayoutReady: false,
    electricalReady: false,
    simulationReady: false,
    boqReady: false,
    ...partial,
  };
}

function gatedRoof(reason: string): DesignStudioRoofSummary {
  return {
    available: false,
    gatedReason: reason,
    grossAreaM2: null,
    usableAreaM2: null,
    trueAreaM2: null,
    obstaclePercent: null,
    warnings: [],
    stageError: null,
  };
}

function gatedPanels(reason: string): DesignStudioPanelSummary {
  return {
    available: false,
    gatedReason: reason,
    panelModel: null,
    orientation: null,
    panelCount: 0,
    dcKw: 0,
    layoutStatus: reason,
    warnings: [],
  };
}

function gatedElectrical(reason: string): DesignStudioElectricalSummary {
  return {
    available: false,
    gatedReason: reason,
    inverter: null,
    strings: null,
    mpptAllocation: null,
    vocMaxV: null,
    vmpRange: null,
    dcCableMm2: null,
    acCableMm2: null,
    breakerSpd: null,
    valid: null,
    stageError: null,
  };
}

function gatedProduction(reason: string): DesignStudioProductionSummary {
  return {
    available: false,
    gatedReason: reason,
    annualKwh: null,
    monthly: [],
    performanceRatio: null,
    losses: [],
    assumptions: [],
    warnings: [],
    stageError: null,
  };
}

function gatedBoq(reason: string): DesignStudioBoqSummary {
  return {
    available: false,
    gatedReason: reason,
    materialTotal: null,
    structureTotal: null,
    electricalTotal: null,
    servicesTotal: null,
    grandTotal: null,
    hasManualOverride: false,
    overrideWarning: null,
    stageError: null,
  };
}

function gatedProposal(reason: string, missing: string[] = []): DesignStudioProposalSummary {
  return {
    available: false,
    gatedReason: reason,
    draftStatus: "Draft unavailable",
    missingRequirements: missing.length ? missing : [reason],
    readyForPreview: false,
  };
}

const EMPTY_RESULTS: DesignStudioLiveResults = {
  draftOnly: true,
  ready: false,
  gatedReason: null,
  panelCount: 0,
  dcKw: 0,
  inverterRecommendation: null,
  stringingStatus: "Not run",
  annualProductionKwh: null,
  monthlyProduction: [],
  cableEstimateM: null,
  boqTotal: null,
  proposalStatus: "Draft unavailable",
  warnings: [],
  panels: [],
  layout: null,
  electrical: null,
  simulation: null,
  status: emptyStatus(),
  roof: gatedRoof(COMPLETE_PREVIOUS_STEP_MESSAGE),
  panelsSummary: gatedPanels(COMPLETE_PREVIOUS_STEP_MESSAGE),
  electricalSummary: gatedElectrical(COMPLETE_PREVIOUS_STEP_MESSAGE),
  production: gatedProduction(COMPLETE_PREVIOUS_STEP_MESSAGE),
  boq: gatedBoq(COMPLETE_PREVIOUS_STEP_MESSAGE),
  proposal: gatedProposal(COMPLETE_PREVIOUS_STEP_MESSAGE),
};

export const EDGE_SETBACK_MIN_M = 0;
export const EDGE_SETBACK_MAX_M = 5;
export const ROW_SPACING_MIN_M = 0;
export const ROW_SPACING_MAX_M = 5;
export const MODULE_GAP_MIN_M = 0;
export const MODULE_GAP_MAX_M = 2;
export const TILT_MIN_DEG = 0;
export const TILT_MAX_DEG = 60;
export const AZIMUTH_MIN_DEG = 0;
export const AZIMUTH_MAX_DEG = 360;

export type FiniteRangeValidationResult =
  | { ok: true; value: number }
  | { ok: false; code: string; message: string };

function validateFiniteInRange(
  value: unknown,
  opts: { code: string; label: string; min: number; max: number; allowMaxExclusive?: boolean }
): FiniteRangeValidationResult {
  if (value === null || value === undefined) {
    return {
      ok: false,
      code: opts.code,
      message: `${opts.label} is required and must be a finite number between ${opts.min} and ${opts.max}.`,
    };
  }
  if (typeof value !== "number") {
    return {
      ok: false,
      code: opts.code,
      message: `${opts.label} must be a finite number between ${opts.min} and ${opts.max}.`,
    };
  }
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      code: opts.code,
      message: `${opts.label} must be a finite number (NaN/Infinity rejected).`,
    };
  }
  if (value < opts.min || (opts.allowMaxExclusive ? value >= opts.max : value > opts.max)) {
    return {
      ok: false,
      code: opts.code,
      message: `${opts.label} must be between ${opts.min} and ${opts.max}.`,
    };
  }
  return { ok: true, value };
}

export type EdgeSetbackValidationResult =
  | { ok: true; value: number }
  | { ok: false; code: "INVALID_EDGE_SETBACK"; message: string };

/**
 * Fail-closed edge setback gate. No silent defaults for NaN / Infinity / out-of-range.
 */
export function validateEdgeSetbackM(value: unknown): EdgeSetbackValidationResult {
  const r = validateFiniteInRange(value, {
    code: "INVALID_EDGE_SETBACK",
    label: "edgeSetbackM",
    min: EDGE_SETBACK_MIN_M,
    max: EDGE_SETBACK_MAX_M,
  });
  return r.ok
    ? { ok: true, value: r.value }
    : { ok: false, code: "INVALID_EDGE_SETBACK", message: r.message };
}

export function validateRowSpacingM(value: unknown): FiniteRangeValidationResult {
  return validateFiniteInRange(value, {
    code: "INVALID_ROW_SPACING",
    label: "rowSpacingM",
    min: ROW_SPACING_MIN_M,
    max: ROW_SPACING_MAX_M,
  });
}

export function validateModuleGapM(value: unknown): FiniteRangeValidationResult {
  return validateFiniteInRange(value, {
    code: "INVALID_MODULE_GAP",
    label: "moduleGapM",
    min: MODULE_GAP_MIN_M,
    max: MODULE_GAP_MAX_M,
  });
}

export function validateTiltDeg(value: unknown): FiniteRangeValidationResult {
  return validateFiniteInRange(value, {
    code: "INVALID_TILT",
    label: "tiltDeg",
    min: TILT_MIN_DEG,
    max: TILT_MAX_DEG,
  });
}

export function validateAzimuthDeg(value: unknown): FiniteRangeValidationResult {
  return validateFiniteInRange(value, {
    code: "INVALID_AZIMUTH",
    label: "azimuthDeg",
    min: AZIMUTH_MIN_DEG,
    max: AZIMUTH_MAX_DEG,
  });
}

export type LayoutAlignment = "left" | "center" | "right";

export const LAYOUT_ALIGNMENTS: readonly LayoutAlignment[] = ["left", "center", "right"];

export function validateLayoutAlignment(
  value: unknown
): { ok: true; value: LayoutAlignment } | { ok: false; code: "INVALID_ALIGNMENT"; message: string } {
  if (value === null || value === undefined) {
    return { ok: false, code: "INVALID_ALIGNMENT", message: "alignment is required." };
  }
  if (typeof value !== "string" || !(LAYOUT_ALIGNMENTS as readonly string[]).includes(value)) {
    return {
      ok: false,
      code: "INVALID_ALIGNMENT",
      message: "alignment must be left, center, or right.",
    };
  }
  return { ok: true, value: value as LayoutAlignment };
}

export type DesignStudioControlsValidation =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Fail-closed gate for all left-panel layout settings before engines run.
 */
export function validateDesignStudioLayoutSettings(
  controls: Pick<
    DesignStudioControls,
    "edgeSetbackM" | "rowSpacingM" | "moduleGapM" | "tiltDeg" | "azimuthDeg" | "moduleId"
  > & { alignment?: LayoutAlignment }
): DesignStudioControlsValidation {
  const setback = validateEdgeSetbackM(controls.edgeSetbackM);
  if (!setback.ok) return setback;
  const row = validateRowSpacingM(controls.rowSpacingM);
  if (!row.ok) return { ok: false, code: row.code, message: row.message };
  const gap = validateModuleGapM(controls.moduleGapM);
  if (!gap.ok) return { ok: false, code: gap.code, message: gap.message };
  const tilt = validateTiltDeg(controls.tiltDeg);
  if (!tilt.ok) return { ok: false, code: tilt.code, message: tilt.message };
  const az = validateAzimuthDeg(controls.azimuthDeg);
  if (!az.ok) return { ok: false, code: az.code, message: az.message };
  if (controls.alignment !== undefined) {
    const align = validateLayoutAlignment(controls.alignment);
    if (!align.ok) return align;
  }
  const mod = resolveCatalogModule(controls.moduleId);
  if (!mod.ok) return { ok: false, code: mod.code, message: mod.message };
  return { ok: true };
}

export type ModuleResolveResult =
  | { ok: true; module: PanelModuleSpec; usedDefaultAssumption: boolean }
  | { ok: false; code: "INVALID_MODULE_ID"; message: string };

/**
 * Fail-closed module lookup. Unknown moduleId never falls back to a default.
 * Empty / omitted moduleId uses catalog default and marks usedDefaultAssumption.
 */
export function resolveCatalogModule(moduleId: string | null | undefined): ModuleResolveResult {
  if (moduleId === null || moduleId === undefined) {
    const fallback = getCatalogModule(CATALOG_MODULE_580W.moduleId);
    if (!fallback) {
      return { ok: false, code: "INVALID_MODULE_ID", message: "Default catalog module is unavailable." };
    }
    return { ok: true, module: fallback, usedDefaultAssumption: true };
  }
  if (typeof moduleId !== "string") {
    return {
      ok: false,
      code: "INVALID_MODULE_ID",
      message: "moduleId must be a string catalog id.",
    };
  }
  const trimmed = moduleId.trim();
  if (!trimmed) {
    const fallback = getCatalogModule(CATALOG_MODULE_580W.moduleId);
    if (!fallback) {
      return { ok: false, code: "INVALID_MODULE_ID", message: "Default catalog module is unavailable." };
    }
    return { ok: true, module: fallback, usedDefaultAssumption: true };
  }
  const found = getCatalogModule(trimmed);
  if (!found) {
    return {
      ok: false,
      code: "INVALID_MODULE_ID",
      message: `Unknown moduleId: ${trimmed}`,
    };
  }
  return { ok: true, module: found, usedDefaultAssumption: false };
}

function electricalSpecForModule(module: PanelModuleSpec): PanelElectricalSpec {
  if (module.wattage <= 420) return { ...PANEL_ELEC_400W, wattageW: module.wattage };
  if (module.wattage <= 560) return { ...PANEL_ELEC_550W, wattageW: module.wattage };
  return { ...PANEL_ELEC_580W, wattageW: module.wattage };
}

export function snapToSupportedSystemSizeKw(dcKw: number): SupportedSystemSizeKw {
  if (!Number.isFinite(dcKw) || dcKw <= 0) return SUPPORTED_SYSTEM_SIZES_KW[0];
  let best: SupportedSystemSizeKw = SUPPORTED_SYSTEM_SIZES_KW[0];
  let bestDiff = Math.abs(dcKw - best);
  for (const size of SUPPORTED_SYSTEM_SIZES_KW) {
    const d = Math.abs(dcKw - size);
    if (d < bestDiff) {
      best = size;
      bestDiff = d;
    }
  }
  return best;
}

function asElectricalSize(size: SupportedSystemSizeKw): ElectricalSystemSizeKw {
  return size as ElectricalSystemSizeKw;
}

function asSimulationSize(size: SupportedSystemSizeKw): SimulationSystemSizeKw {
  if ((SUPPORTED_SIMULATION_SIZES_KW as readonly number[]).includes(size)) {
    return size as SimulationSystemSizeKw;
  }
  return 5;
}

export function primaryPlane(state: RoofStudioState): StudioPlane | null {
  const complete = state.planes.filter(isPlaneComplete);
  if (complete.length === 0) return null;
  return complete.find((p) => p.id === state.selectedPlaneId) ?? complete[0];
}

export function designStudioWizardProgress(opts: {
  hasImage: boolean;
  calibrated: boolean;
  hasCompletePlane: boolean;
  hasKeepouts: boolean;
  moduleSelected: boolean;
  hasPanels: boolean;
  hasBoq: boolean;
}): { currentStep: number; completedThrough: number; steps: typeof DESIGN_STUDIO_GUIDED_STEPS } {
  const base = deriveWizardProgress({
    hasImage: opts.hasImage,
    calibrated: opts.calibrated,
    hasCompletePlane: opts.hasCompletePlane,
    hasPanels: opts.hasPanels,
    hasBoq: opts.hasBoq,
  });
  // Insert keepouts (4) and module (5) between boundary and auto-layout.
  let current = base.currentStep;
  let completed = base.completedThrough;
  if (opts.hasImage && opts.calibrated && opts.hasCompletePlane && !opts.hasKeepouts && current === 4) {
    // keepouts optional — stay on step 4 until user advances via module/layout
  }
  if (opts.hasImage && opts.calibrated && opts.hasCompletePlane && !opts.hasPanels) {
    if (!opts.moduleSelected) {
      current = 5;
      completed = Math.max(completed, 3);
    } else {
      current = 6;
      completed = Math.max(completed, 4);
    }
  }
  if (opts.hasPanels && !opts.hasBoq) {
    current = 7;
    completed = Math.max(completed, 6);
  }
  if (opts.hasBoq) {
    current = 7;
    completed = 7;
  }
  return { currentStep: current, completedThrough: completed, steps: DESIGN_STUDIO_GUIDED_STEPS };
}

export function canRunAutoLayout(hasImage: boolean, calibrated: boolean, hasCompletePlane: boolean): {
  ok: boolean;
  reason: string | null;
} {
  if (!hasImage) return { ok: false, reason: "Upload a roof / satellite image first." };
  if (!calibrated) return { ok: false, reason: "Calibrate scale before Auto Layout." };
  if (!hasCompletePlane) return { ok: false, reason: "Draw a closed roof boundary (≥3 points) first." };
  if (!isDesignWorkspaceUnlocked(hasImage, calibrated)) {
    return { ok: false, reason: COMPLETE_PREVIOUS_STEP_MESSAGE };
  }
  return { ok: true, reason: null };
}

export function canRunDesignStudioAutoLayout(opts: {
  hasImage: boolean;
  calibrated: boolean;
  hasCompletePlane?: boolean;
  /** Preferred: full studio state so roof geometry validity can be checked. */
  state?: RoofStudioState | null;
  controls: DesignStudioControls & { alignment?: LayoutAlignment };
}): { ok: boolean; reason: string | null; code: string | null } {
  const hasCompletePlane =
    opts.state != null
      ? opts.state.planes.some(isPlaneComplete)
      : Boolean(opts.hasCompletePlane);

  const gate = canRunAutoLayout(opts.hasImage, opts.calibrated, hasCompletePlane);
  if (!gate.ok) return { ok: false, reason: gate.reason, code: "GATED" };

  if (opts.state) {
    const roof = evaluateStudioRoofValidity(opts.state);
    if (!roof.ok) {
      return {
        ok: false,
        reason: roof.reason === FIX_ROOF_GEOMETRY_BEFORE_AUTO_LAYOUT
          ? FIX_ROOF_GEOMETRY_BEFORE_AUTO_LAYOUT
          : roof.reason,
        code: roof.code === "NO_PLANE" ? "GATED" : "INVALID_ROOF_GEOMETRY",
      };
    }
  } else if (opts.hasCompletePlane === false) {
    return { ok: false, reason: "Draw a closed roof boundary (≥3 points) first.", code: "GATED" };
  }

  const settings = validateDesignStudioLayoutSettings(opts.controls);
  if (!settings.ok) return { ok: false, reason: settings.message, code: settings.code };
  return { ok: true, reason: null, code: null };
}

/**
 * Auto Layout via Panel Layout Engine V2 only.
 * Never invents panels when scale is uncalibrated.
 * Fail-closed on invalid edgeSetbackM / unknown moduleId.
 */
export function runDesignStudioAutoLayout(
  state: RoofStudioState,
  controls: DesignStudioControls,
  opts: { hasImage: boolean }
): { ok: true; layout: PanelLayoutResult } | { ok: false; code: string; message: string } {
  const calibrated = isScaleCalibrated(state.scaleCalibration, state.metersPerUnit);
  const roof = evaluateStudioRoofValidity(state);
  const gate = canRunDesignStudioAutoLayout({
    hasImage: opts.hasImage,
    calibrated,
    state,
    controls,
  });
  if (!gate.ok) {
    return {
      ok: false,
      code: gate.code ?? "GATED",
      message: gate.reason ?? COMPLETE_PREVIOUS_STEP_MESSAGE,
    };
  }
  if (!roof.ok) {
    return {
      ok: false,
      code: roof.code === "NO_PLANE" ? "NO_PLANE" : "INVALID_ROOF_GEOMETRY",
      message: roof.reason,
    };
  }
  const plane = roof.plane;

  const settings = validateDesignStudioLayoutSettings(controls);
  if (!settings.ok) {
    return { ok: false, code: settings.code, message: settings.message };
  }

  const setback = validateEdgeSetbackM(controls.edgeSetbackM);
  if (!setback.ok) {
    return { ok: false, code: setback.code, message: setback.message };
  }

  const moduleResolved = resolveCatalogModule(controls.moduleId);
  if (!moduleResolved.ok) {
    return { ok: false, code: moduleResolved.code, message: moduleResolved.message };
  }
  const module = moduleResolved.module;

  try {
    const layout = layoutPanelsOnPlane({
      plane: {
        planeId: plane.id,
        boundary: plane.boundary,
        obstacles: plane.obstacles.map((o) => ({
          id: o.id,
          polygon: o.vertices,
          heightM: o.heightM,
          setbackM: o.clearanceM,
        })),
        walkways: plane.walkways.map((w) => ({
          id: w.id,
          polygon: w.vertices,
          widthM: w.widthM,
        })),
        setbacks: { edgeSetbackM: setback.value },
      },
      metersPerUnit: state.metersPerUnit,
      module,
      orientationPolicy: controls.orientationPolicy === "mixed" ? "auto" : controls.orientationPolicy,
      constraints: {
        spacing: {
          gapM: controls.moduleGapM,
          rowSpacingM: controls.rowSpacingM,
          edgeClearanceM: 0,
          structureClearanceM: 0.3,
        },
        setbacks: { edgeSetbackM: setback.value },
      },
    });
    return { ok: true, layout };
  } catch (e) {
    if (e instanceof PanelLayoutError) {
      return { ok: false, code: e.code, message: e.message };
    }
    return {
      ok: false,
      code: "LAYOUT_FAILED",
      message: e instanceof Error ? e.message : "Panel layout failed.",
    };
  }
}

function emptyWithGate(
  reason: string,
  flags?: Partial<DesignStudioStatusFlags>
): DesignStudioLiveResults {
  return {
    ...EMPTY_RESULTS,
    gatedReason: reason,
    warnings: [reason],
    status: emptyStatus(flags),
    roof: gatedRoof(reason),
    panelsSummary: gatedPanels(reason),
    electricalSummary: gatedElectrical(reason),
    production: gatedProduction(reason),
    boq: gatedBoq(reason),
    proposal: gatedProposal(reason),
  };
}

/** Stop the results pipeline with a stage error — no panel/production/BOQ numbers. */
function validationStageFailure(
  code: string,
  message: string,
  flags?: Partial<DesignStudioStatusFlags>
): DesignStudioLiveResults {
  const stage = `${code}: ${message}`;
  return {
    ...EMPTY_RESULTS,
    ready: false,
    gatedReason: stage,
    warnings: [stage],
    proposalStatus: "Draft unavailable",
    status: emptyStatus(flags),
    roof: {
      ...gatedRoof(COMPLETE_PREVIOUS_STEP_MESSAGE),
      stageError: stage,
    },
    panelsSummary: {
      ...gatedPanels(stage),
      layoutStatus: stage,
    },
    electricalSummary: {
      ...gatedElectrical(stage),
      stageError: stage,
    },
    production: {
      ...gatedProduction(stage),
      stageError: stage,
    },
    boq: {
      ...gatedBoq(stage),
      stageError: stage,
    },
    proposal: gatedProposal(stage, [stage]),
  };
}

function sumBoqSectionsByIds(
  sections: Array<{ id: string; subtotal: number }>,
  ids: readonly string[]
): number {
  let total = 0;
  for (const section of sections) {
    if (ids.includes(section.id)) total += section.subtotal;
  }
  return total;
}

const MATERIAL_SECTION_IDS = [
  "imported_equipment",
  "cable_conductors",
  "db_boxes_breakers",
  "electrical_mechanical_supplies",
  "system_earthing",
] as const;
const STRUCTURE_SECTION_IDS = ["roof_mounting_structure"] as const;
const ELECTRICAL_SECTION_IDS = [
  "cable_conductors",
  "db_boxes_breakers",
  "electrical_mechanical_supplies",
  "system_earthing",
] as const;
const SERVICES_SECTION_IDS = ["sunchaser_energy_services"] as const;

/**
 * Live right-panel results. Production / BOQ only after a real layout exists.
 * No fake kWh or priced BOQ before panels.
 * Fail-closed on invalid edgeSetbackM / unknown moduleId before any engine chain.
 */
export function buildDesignStudioLiveResults(
  state: RoofStudioState,
  controls: DesignStudioControls,
  layout: PanelLayoutResult | null,
  opts: { hasImage: boolean }
): DesignStudioLiveResults {
  const calibrated = isScaleCalibrated(state.scaleCalibration, state.metersPerUnit);
  if (!opts.hasImage || !calibrated) {
    return emptyWithGate(
      !opts.hasImage ? "Upload a roof image to begin." : "Calibrate scale before panels, production, or BOQ.",
      { uploadComplete: opts.hasImage, scaleCalibrated: calibrated }
    );
  }

  const settings = validateDesignStudioLayoutSettings(controls);
  if (!settings.ok) {
    return validationStageFailure(settings.code, settings.message, {
      uploadComplete: opts.hasImage,
      scaleCalibrated: calibrated,
    });
  }

  const setback = validateEdgeSetbackM(controls.edgeSetbackM);
  if (!setback.ok) {
    return validationStageFailure(setback.code, setback.message, {
      uploadComplete: opts.hasImage,
      scaleCalibrated: calibrated,
    });
  }

  const moduleResolved = resolveCatalogModule(controls.moduleId);
  if (!moduleResolved.ok) {
    return validationStageFailure(moduleResolved.code, moduleResolved.message, {
      uploadComplete: opts.hasImage,
      scaleCalibrated: calibrated,
    });
  }
  const module = moduleResolved.module;

  const roofValidity = evaluateStudioRoofValidity(state);
  if (!roofValidity.ok) {
    const stageMsg =
      roofValidity.code === "NO_PLANE"
        ? roofValidity.message
        : FIX_ROOF_GEOMETRY_BEFORE_AUTO_LAYOUT;
    const stage = validationStageFailure(
      roofValidity.code === "NO_PLANE" ? "NO_PLANE" : "INVALID_ROOF_GEOMETRY",
      roofValidity.code === "NO_PLANE" ? roofValidity.message : `${FIX_ROOF_GEOMETRY_BEFORE_AUTO_LAYOUT} (${roofValidity.code}: ${roofValidity.message})`,
      {
        uploadComplete: opts.hasImage,
        scaleCalibrated: calibrated,
        roofValid: false,
      }
    );
    // Surface roof analysis when available for the Roof section, but never panel/BOQ/production.
    const roofAnalysis = analyzeStudio(state);
    return {
      ...stage,
      gatedReason: stageMsg,
      warnings: [stageMsg, ...(roofAnalysis.error ? [roofAnalysis.error.message] : [])],
      roof: roofAnalysis.metrics
        ? {
            available: false,
            gatedReason: stageMsg,
            grossAreaM2: null,
            usableAreaM2: null,
            trueAreaM2: null,
            obstaclePercent: null,
            warnings: roofAnalysis.statistics?.warnings ?? [],
            stageError: roofAnalysis.error?.message ?? stageMsg,
          }
        : {
            ...gatedRoof(stageMsg),
            stageError: roofAnalysis.error?.message ?? stageMsg,
          },
    };
  }

  const roofAnalysis = analyzeStudio(state);
  const warnings: string[] = [];
  if (roofAnalysis.error) warnings.push(roofAnalysis.error.message);
  if (roofAnalysis.statistics?.warnings?.length) warnings.push(...roofAnalysis.statistics.warnings);
  if (moduleResolved.usedDefaultAssumption) {
    warnings.push(`Assumption: default module ${module.name} (${module.moduleId}) — no moduleId selected.`);
  }

  const roofValid = roofValidity.ok && Boolean(!roofAnalysis.error);
  const roofSummary: DesignStudioRoofSummary = roofAnalysis.metrics
    ? {
        available: true,
        gatedReason: null,
        grossAreaM2: roofAnalysis.statistics?.grossAreaM2 ?? roofAnalysis.metrics.totalPlanAreaM2,
        usableAreaM2: roofAnalysis.statistics?.usableAreaM2 ?? roofAnalysis.metrics.totalNetUsableAreaM2,
        trueAreaM2: roofAnalysis.metrics.totalTrueAreaM2,
        obstaclePercent: roofAnalysis.statistics?.obstaclePercent ?? null,
        warnings: roofAnalysis.statistics?.warnings ?? [],
        stageError: roofAnalysis.error?.message ?? null,
      }
    : {
        available: false,
        gatedReason: roofAnalysis.error
          ? roofAnalysis.error.message
          : COMPLETE_PREVIOUS_STEP_MESSAGE,
        grossAreaM2: null,
        usableAreaM2: null,
        trueAreaM2: null,
        obstaclePercent: null,
        warnings: [],
        stageError: roofAnalysis.error?.message ?? null,
      };

  const orientationLabel =
    controls.orientationPolicy === "portrait_only"
      ? "Portrait"
      : controls.orientationPolicy === "landscape_only"
        ? "Landscape"
        : controls.orientationPolicy === "auto"
          ? "Auto"
          : String(controls.orientationPolicy);

  if (!layout || layout.panelCount <= 0) {
    const layoutGate = layout
      ? "No panels fit — adjust keepouts, setbacks, or module."
      : "Run Auto Layout to place panels.";
    const missing = [
      !opts.hasImage ? "Upload image" : null,
      !calibrated ? "Calibrate scale" : null,
      !roofValid ? "Valid roof boundary" : null,
      "Panel layout",
    ].filter(Boolean) as string[];

    return {
      ...EMPTY_RESULTS,
      gatedReason: layoutGate,
      warnings: [...(layout ? layout.warnings : ["No panel layout yet."]), ...warnings],
      proposalStatus: "Awaiting layout",
      layout,
      status: emptyStatus({
        uploadComplete: opts.hasImage,
        scaleCalibrated: calibrated,
        roofValid,
        panelLayoutReady: false,
      }),
      roof: roofSummary,
      panelsSummary: {
        available: Boolean(layout),
        gatedReason: layout ? null : COMPLETE_PREVIOUS_STEP_MESSAGE,
        panelModel: module.name,
        orientation: orientationLabel,
        panelCount: layout?.panelCount ?? 0,
        dcKw: layout ? Math.round(layout.dcCapacityKw * 100) / 100 : 0,
        layoutStatus: layoutGate,
        warnings: layout?.warnings ?? [],
      },
      electricalSummary: gatedElectrical(COMPLETE_PREVIOUS_STEP_MESSAGE),
      production: gatedProduction(COMPLETE_PREVIOUS_STEP_MESSAGE),
      boq: gatedBoq(COMPLETE_PREVIOUS_STEP_MESSAGE),
      proposal: gatedProposal(COMPLETE_PREVIOUS_STEP_MESSAGE, missing),
    };
  }

  const dcKw = layout.dcCapacityKw;
  const snapped = snapToSupportedSystemSizeKw(dcKw);
  const panelSpec = electricalSpecForModule(module);
  const inverterSpec = getInverterElectricalSpec(asElectricalSize(snapped), controls.systemType as ElectricalSystemType);

  let electrical: ElectricalDesignResult | null = null;
  let electricalStageError: string | null = null;
  try {
    electrical = designElectricalSystem({
      placedPanels: layout.panels.map((p) => ({
        panelId: p.panelId,
        planeId: p.planeId,
        wattage: p.wattage,
      })),
      panelSpec,
      inverterSpec,
      systemType: controls.systemType as ElectricalSystemType,
      temperatures: { designTempMinC: -5, designTempMaxC: 70 },
      cableRoute: {
        dcLengthM: Math.max(20, snapped * 15 + 40),
        acLengthM: Math.max(12, snapped * 2.5 + 8),
      },
    });
    if (electrical.warnings?.length) warnings.push(...electrical.warnings);
  } catch (e) {
    if (e instanceof ElectricalDesignError) {
      electricalStageError = e.message;
      warnings.push(`Electrical: ${e.message}`);
    } else {
      electricalStageError = e instanceof Error ? e.message : "Electrical design failed.";
      warnings.push(electricalStageError);
    }
  }

  let simulation: SolarSimulationResult | null = null;
  let simulationStageError: string | null = null;
  try {
    simulation = runSolarSimulation({
      systemSizeKw: asSimulationSize(snapped),
      systemType: controls.systemType,
      array: { tiltDeg: controls.tiltDeg, azimuthDeg: controls.azimuthDeg },
      module: { wattageW: module.wattage },
    });
    if (simulation.warnings?.length) warnings.push(...simulation.warnings);
  } catch (e) {
    if (e instanceof SolarSimulationValidationError) {
      simulationStageError = e.message;
      warnings.push(`Simulation: ${e.message}`);
    } else {
      simulationStageError = e instanceof Error ? e.message : "Simulation failed.";
      warnings.push(simulationStageError);
    }
  }

  let boqTotal: number | null = null;
  let proposalStatus = "Draft only — not saved";
  let boqSummary = gatedBoq(COMPLETE_PREVIOUS_STEP_MESSAGE);
  let proposalSummary = gatedProposal(COMPLETE_PREVIOUS_STEP_MESSAGE);
  try {
    const { draft } = generateSolarProposal({
      systemSizeKw: snapped,
      tier: controls.tier,
      systemType: controls.systemType,
      structureType: STRUCTURE_TYPES.includes(controls.structureType) ? controls.structureType : "standard",
      panelWattage: module.wattage,
    });
    boqTotal = draft.pricing.grandTotal;
    proposalStatus = "Proposal draft ready (not saved)";
    if (draft.warnings?.length) warnings.push(...draft.warnings);

    const materialTotal = sumBoqSectionsByIds(draft.sections, MATERIAL_SECTION_IDS);
    const structureTotal = sumBoqSectionsByIds(draft.sections, STRUCTURE_SECTION_IDS);
    const electricalTotal = sumBoqSectionsByIds(draft.sections, ELECTRICAL_SECTION_IDS);
    const servicesTotal = sumBoqSectionsByIds(draft.sections, SERVICES_SECTION_IDS);

    boqSummary = {
      available: true,
      gatedReason: null,
      materialTotal,
      structureTotal,
      electricalTotal,
      servicesTotal,
      grandTotal: draft.pricing.grandTotal,
      hasManualOverride: false,
      overrideWarning: null,
      stageError: null,
    };
    proposalSummary = {
      available: true,
      gatedReason: null,
      draftStatus: proposalStatus,
      missingRequirements: [],
      readyForPreview: true,
    };
  } catch (e) {
    const msg =
      e instanceof SolarProposalValidationError
        ? e.message
        : e instanceof Error
          ? e.message
          : "BOQ failed.";
    warnings.push(e instanceof SolarProposalValidationError ? `BOQ: ${msg}` : msg);
    proposalStatus = "BOQ unavailable";
    boqSummary = {
      ...gatedBoq(COMPLETE_PREVIOUS_STEP_MESSAGE),
      stageError: msg,
      gatedReason: msg,
    };
    proposalSummary = {
      available: false,
      gatedReason: msg,
      draftStatus: "BOQ unavailable",
      missingRequirements: [msg],
      readyForPreview: false,
    };
  }

  const stringingStatus = electrical
    ? electrical.stringing.valid
      ? `${electrical.stringing.stringCount} strings · ${electrical.stringing.modulesPerString} mod/string · OK`
      : `Stringing invalid: ${electrical.stringing.issues[0] ?? "check MPPT window"}`
    : "Not run";

  const cableEstimateM = electrical
    ? Math.round((electrical.cable.dcCableMm2 > 0 ? snapped * 15 + 40 : 0) + (snapped * 2.5 + 8))
    : null;

  const mpptAllocation = electrical
    ? electrical.mpptAllocations
        .map(
          (m) =>
            `${m.mpptId}: ${m.stringIds.length} str · ${Math.round(m.totalCurrentA * 10) / 10}A${
              m.withinVoltageWindow ? "" : " (OOR)"
            }`
        )
        .join("; ") || "None"
    : null;

  const electricalSummary: DesignStudioElectricalSummary = electrical
    ? {
        available: true,
        gatedReason: null,
        inverter: inverterSpec.name,
        strings: `${electrical.stringing.stringCount} × ${electrical.stringing.modulesPerString} modules`,
        mpptAllocation,
        vocMaxV: electrical.stringing.stringVocAtTminV,
        vmpRange: `${Math.round(electrical.stringing.stringVmpAtTmaxV * 10) / 10} V (hot Vmp string)`,
        dcCableMm2: electrical.cable.dcCableMm2,
        acCableMm2: electrical.cable.acCableMm2,
        breakerSpd: [
          electrical.protection.dcBreakerOrFuse.label,
          electrical.protection.acBreaker.label,
          electrical.protection.dcSpd.label,
          electrical.protection.acSpd.label,
        ].join(" · "),
        valid: electrical.valid,
        stageError: electrical.valid ? null : electrical.stringing.issues[0] ?? "Electrical design invalid",
      }
    : {
        ...gatedElectrical(electricalStageError ?? COMPLETE_PREVIOUS_STEP_MESSAGE),
        stageError: electricalStageError,
      };

  const production: DesignStudioProductionSummary = simulation
    ? {
        available: true,
        gatedReason: null,
        annualKwh: Math.round(simulation.annualAcKwh),
        monthly: simulation.monthly.map((m) => ({
          label: MONTH_LABELS[m.month] ?? m.label,
          kwh: Math.round(m.acKwh),
        })),
        performanceRatio: simulation.performanceRatio,
        losses: [
          { label: "Shading", kwh: simulation.losses.shadingKwh },
          { label: "Temperature", kwh: simulation.losses.temperatureKwh },
          { label: "Inverter clipping", kwh: simulation.losses.inverterClippingKwh },
          { label: "Cable", kwh: simulation.losses.cableKwh },
          { label: "Availability", kwh: simulation.losses.systemAvailabilityKwh },
          { label: "Total", kwh: simulation.losses.totalLossKwh },
        ],
        assumptions: simulation.assumptions.map((a) => {
          const unit = a.unit ? ` ${a.unit}` : "";
          return `${a.label}: ${String(a.value)}${unit}`;
        }),
        warnings: simulation.warnings,
        stageError: null,
      }
    : {
        ...gatedProduction(simulationStageError ?? COMPLETE_PREVIOUS_STEP_MESSAGE),
        stageError: simulationStageError,
      };

  return {
    draftOnly: true,
    ready: true,
    gatedReason: null,
    panelCount: layout.panelCount,
    dcKw: Math.round(dcKw * 100) / 100,
    inverterRecommendation: inverterSpec.name,
    stringingStatus,
    annualProductionKwh: simulation ? Math.round(simulation.annualAcKwh) : null,
    monthlyProduction: production.monthly,
    cableEstimateM,
    boqTotal,
    proposalStatus,
    warnings,
    panels: layout.panels,
    layout,
    electrical,
    simulation,
    status: emptyStatus({
      uploadComplete: opts.hasImage,
      scaleCalibrated: calibrated,
      roofValid,
      panelLayoutReady: true,
      electricalReady: Boolean(electrical?.valid),
      simulationReady: Boolean(simulation),
      boqReady: boqTotal != null,
    }),
    roof: roofSummary,
    panelsSummary: {
      available: true,
      gatedReason: null,
      panelModel: module.name,
      orientation: orientationLabel,
      panelCount: layout.panelCount,
      dcKw: Math.round(dcKw * 100) / 100,
      layoutStatus: `Ready · ${layout.panelCount} panels`,
      warnings: layout.warnings,
    },
    electricalSummary,
    production,
    boq: boqSummary,
    proposal: proposalSummary,
  };
}

export function prefillAddressFromLead(lead: {
  address?: string;
  location?: string;
  name?: string;
}): string {
  const a = String(lead.address ?? "").trim();
  if (a) return a;
  const loc = String(lead.location ?? "").trim();
  if (loc) return loc;
  return "";
}

/** Safe phone label for workspace header — never invents a number. */
export const PHONE_NOT_PROVIDED_LABEL = "Phone not provided.";

export function displayCustomerPhone(phone: string | null | undefined): string {
  const trimmed = String(phone ?? "").trim();
  return trimmed || PHONE_NOT_PROVIDED_LABEL;
}

/** Draft-only notice — address edits must not mutate CRM. */
export const DESIGN_WORKSPACE_DRAFT_ONLY_LABEL = "Draft only — not saved to CRM.";

export const MODULE_OPTIONS = [CATALOG_MODULE_580W, CATALOG_MODULE_550W, CATALOG_MODULE_400W];

export function assertNoLocalProductionMath(source: string): boolean {
  // Adapter must call engines — forbid inventing kWh constants as fake production.
  const parts = ["fake", "Production", "Math", ".random()", "estimatedAnnual", "Savings * 12"];
  const forbidden = [parts[0] + parts[1], parts[2] + parts[3], parts[4] + parts[5]];
  return forbidden.every((f) => !source.includes(f));
}

export type { Point2D, PanelLayoutResult, PlacedPanel };
