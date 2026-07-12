/**
 * Phase 3C — Electrical Design Engine models.
 * Deterministic electrical design from placed panels.
 * No UI, AI, DB, routes, API, save, or PDF.
 */

export const ELECTRICAL_ENGINE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const ELECTRICAL_SYSTEM_TYPES = ["on-grid", "hybrid", "off-grid"] as const;
export type ElectricalSystemType = (typeof ELECTRICAL_SYSTEM_TYPES)[number];

export const ELECTRICAL_SYSTEM_SIZES_KW = [3, 5, 6, 8, 10, 15] as const;
export type ElectricalSystemSizeKw = (typeof ELECTRICAL_SYSTEM_SIZES_KW)[number];

export type ElectricalErrorCode =
  | "INVALID_PANEL_SPEC"
  | "INVALID_INVERTER_SPEC"
  | "INVALID_TEMPERATURE"
  | "INVALID_CABLE_LENGTH"
  | "INVALID_CABLE_SIZE"
  | "INVALID_SYSTEM_TYPE"
  | "INVALID_PLACED_PANELS"
  | "INVALID_PANEL_ID"
  | "DUPLICATE_PANEL_ID"
  | "INVALID_EARTHING_CONDUCTOR"
  | "INVALID_NUMBER"
  | "STRINGING_IMPOSSIBLE"
  | "NON_FINITE_OUTPUT";

export class ElectricalDesignError extends Error {
  readonly code: ElectricalErrorCode;
  constructor(code: ElectricalErrorCode, message: string) {
    super(message);
    this.name = "ElectricalDesignError";
    this.code = code;
  }
}

export interface ElectricalAssumption {
  id: string;
  label: string;
  value: string | number | boolean;
  unit?: string;
  source: "input" | "default" | "catalog";
}

/** Placed panel reference from Panel Layout Engine V2 (minimal electrical needs). */
export interface PlacedPanelRef {
  panelId: string;
  planeId?: string;
  wattage: number;
}

export interface PanelElectricalSpec {
  moduleId: string;
  name: string;
  wattageW: number;
  vocStcV: number;
  vmpStcV: number;
  iscStcA: number;
  impStcA: number;
  tempCoeffVocPctPerC: number;
  tempCoeffVmpPctPerC: number;
  tempCoeffIscPctPerC: number;
}

export interface InverterMpptChannel {
  mpptId: string;
  minV: number;
  maxV: number;
  maxCurrentA: number;
  maxStrings?: number;
}

export interface InverterElectricalSpec {
  inverterId: string;
  name: string;
  systemType: ElectricalSystemType;
  acRatingKw: number;
  maxDcVoltageV: number;
  maxDcCurrentA: number;
  efficiencyPct: number;
  acNominalVoltageV: number;
  acPhases: 1 | 3;
  mppts: InverterMpptChannel[];
}

export interface SiteTemperatureAssumptions {
  designTempMinC: number;
  designTempMaxC: number;
  ambientDesignC?: number;
}

export interface CableRouteInput {
  dcLengthM: number;
  acLengthM: number;
  /** Optional forced conductor sizes; otherwise recommended. */
  dcCableMm2?: number;
  acCableMm2?: number;
  routeFactor?: number;
}

export interface ProtectionPreferences {
  preferDcFuse?: boolean;
  preferDcBreaker?: boolean;
  requireLightningArrestor?: boolean;
  earthingConductorMm2?: number;
}

export interface ElectricalDesignInput {
  placedPanels: PlacedPanelRef[];
  panelSpec: PanelElectricalSpec;
  inverterSpec: InverterElectricalSpec;
  systemType: ElectricalSystemType;
  temperatures: SiteTemperatureAssumptions;
  cableRoute: CableRouteInput;
  protection?: ProtectionPreferences;
  /** Allow unequal string lengths across MPPTs when true (default true). */
  allowUnequalStrings?: boolean;
  /** Max voltage drop % target for cable sizing (default 2). */
  maxVoltageDropPct?: number;
}

export interface StringGroup {
  stringId: string;
  mpptId: string;
  modulesPerString: number;
  panelIds: string[];
  vocAtTminV: number;
  vmpAtTmaxV: number;
  iscA: number;
  impA: number;
  valid: boolean;
  issues: string[];
}

export interface StringingResult {
  valid: boolean;
  modulesPerString: number;
  stringCount: number;
  minModulesPerString: number;
  maxModulesPerString: number;
  vocModuleAtTminV: number;
  vmpModuleAtTmaxV: number;
  stringVocAtTminV: number;
  stringVmpAtTmaxV: number;
  dcCurrentPerStringA: number;
  totalDcCurrentA: number;
  strings: StringGroup[];
  issues: string[];
}

export interface MpptAllocation {
  mpptId: string;
  stringIds: string[];
  stringCount: number;
  totalCurrentA: number;
  withinCurrentLimit: boolean;
  withinVoltageWindow: boolean;
  issues: string[];
}

export interface CableSizingResult {
  dcCableMm2: number;
  acCableMm2: number;
  dcRecommended: boolean;
  acRecommended: boolean;
  copperResistivityOhmMm2M: number;
  routeFactor: number;
  assumptions: string[];
}

export interface VoltageDropResult {
  dcVoltageDropV: number;
  dcVoltageDropPct: number;
  acVoltageDropV: number;
  acVoltageDropPct: number;
  dcCableLossPct: number;
  acCableLossPct: number;
}

export interface ProtectionDevices {
  dcIsolator: { ratingA: number; label: string };
  dcBreakerOrFuse: { type: "breaker" | "fuse"; ratingA: number; label: string };
  dcSpd: { type: string; label: string };
  acBreaker: { ratingA: number; poles: number; label: string };
  acSpd: { type: string; label: string };
  batteryFuseDisconnect: { required: boolean; ratingA: number | null; label: string } | null;
}

export interface EarthingLightningResult {
  earthingConductorMm2: number;
  earthingLabel: string;
  lightningArrestorRecommended: boolean;
  lightningLabel: string;
  notes: string[];
}

export interface ElectricalBoqLine {
  id: string;
  category: string;
  description: string;
  qty: number;
  unit: string;
  notes?: string;
}

export interface ElectricalDesignResult {
  generatedAt: string;
  systemType: ElectricalSystemType;
  panelCount: number;
  dcCapacityKw: number;
  stringing: StringingResult;
  mpptAllocations: MpptAllocation[];
  inverterCompatible: boolean;
  cable: CableSizingResult;
  voltageDrop: VoltageDropResult;
  protection: ProtectionDevices;
  earthingLightning: EarthingLightningResult;
  boq: ElectricalBoqLine[];
  assumptions: ElectricalAssumption[];
  warnings: string[];
  valid: boolean;
}

export function round4(n: number): number {
  if (!Number.isFinite(n)) {
    throw new ElectricalDesignError("NON_FINITE_OUTPUT", `Cannot round non-finite value: ${String(n)}`);
  }
  return Math.round(n * 10000) / 10000;
}

export function round2(n: number): number {
  if (!Number.isFinite(n)) {
    throw new ElectricalDesignError("NON_FINITE_OUTPUT", `Cannot round non-finite value: ${String(n)}`);
  }
  return Math.round(n * 100) / 100;
}
