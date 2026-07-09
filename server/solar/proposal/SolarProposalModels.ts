/**
 * Solar Proposal Studio — shared types and constants.
 * Pure TypeScript. No routes, UI, AI, or PDF generation.
 */

export const PROPOSAL_ENGINE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const SUPPORTED_SYSTEM_SIZES_KW = [3, 5, 6, 8, 10, 15] as const;
export type SupportedSystemSizeKw = (typeof SUPPORTED_SYSTEM_SIZES_KW)[number];

export const EQUIPMENT_TIERS = ["budget", "premium"] as const;
export type EquipmentTier = (typeof EQUIPMENT_TIERS)[number];

export const SYSTEM_TYPES = ["on-grid", "hybrid", "off-grid"] as const;
export type SystemType = (typeof SYSTEM_TYPES)[number];

export const STRUCTURE_TYPES = ["standard", "elevated_hbeam"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

export const BOQ_SECTION_IDS = [
  "imported_equipment",
  "cable_conductors",
  "db_boxes_breakers",
  "electrical_mechanical_supplies",
  "system_earthing",
  "roof_mounting_structure",
  "sunchaser_energy_services",
] as const;

export type BoqSectionId = (typeof BOQ_SECTION_IDS)[number];

export const BOQ_SECTION_LABELS: Record<BoqSectionId, string> = {
  imported_equipment: "Imported Equipment",
  cable_conductors: "Cable & Conductors",
  db_boxes_breakers: "DB boxes and Breakers",
  electrical_mechanical_supplies: "Electrical & Mechanical Supplies",
  system_earthing: "System Earthing Works",
  roof_mounting_structure: "Roof Mounting Structure",
  sunchaser_energy_services: "Sunchaser Energy Services",
};

export interface RoofPoint {
  x: number;
  y: number;
}

export interface RoofObstacle {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SolarProposalInput {
  systemSizeKw: SupportedSystemSizeKw;
  tier: EquipmentTier;
  systemType: SystemType;
  structureType: StructureType;
  panelWattage?: number;
  roofBoundary?: RoofPoint[];
  obstacles?: RoofObstacle[];
  roofWidthMeters?: number;
  canvasWidth?: number;
  siteComplexityScore?: number;
  netMeteringRequired?: boolean;
}

export interface BoqLineItem {
  id: string;
  sectionId: BoqSectionId;
  srNo: string;
  name: string;
  description: string;
  brand: string;
  unit: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  lineTotal: number;
}

export interface BoqSection {
  id: BoqSectionId;
  label: string;
  lines: BoqLineItem[];
  subtotal: number;
}

export interface ProposalPricingSummary {
  subtotalCost: number;
  subtotalPrice: number;
  marginPercent: number;
  marginAmount: number;
  grandTotal: number;
}

/** Sanitized proposal input echoed in output — no PII or unknown keys. */
export interface ProposalInputSummary {
  systemSizeKw: SupportedSystemSizeKw;
  tier: EquipmentTier;
  systemType: SystemType;
  structureType: StructureType;
  panelWattage: number;
  siteComplexityScore: number;
}

export interface ProposalDraft {
  generatedAt: string;
  inputSummary: ProposalInputSummary;
  panelCount: number;
  systemSizeKw: number;
  cableDistanceM: number;
  cableRolls: number;
  structureCost: number;
  sections: BoqSection[];
  pricing: ProposalPricingSummary;
  assumptions: string[];
  warnings: string[];
}

export class SolarProposalError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SolarProposalError";
  }
}

export class SolarProposalValidationError extends SolarProposalError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "SolarProposalValidationError";
  }
}

export function isSupportedSystemSizeKw(value: number): value is SupportedSystemSizeKw {
  return Number.isFinite(value) && value > 0 && (SUPPORTED_SYSTEM_SIZES_KW as readonly number[]).includes(value);
}

export function clampSiteComplexityScore(score: number): number {
  return Math.max(0, Math.min(10, score));
}

function assertPositiveFinite(field: string, value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new SolarProposalValidationError(
      "INVALID_NUMERIC",
      `Invalid ${field}: must be a finite number greater than 0`
    );
  }
  return n;
}

function resolveSiteComplexityScore(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new SolarProposalValidationError(
      "INVALID_COMPLEXITY",
      "Invalid siteComplexityScore: must be a finite number"
    );
  }
  return clampSiteComplexityScore(n);
}

function resolvePanelWattage(value: unknown, defaultWattage: number): number {
  if (value === undefined || value === null) return defaultWattage;
  return assertPositiveFinite("panelWattage", value);
}

export interface NormalizedSolarProposalInput {
  input: SolarProposalInput;
  summary: ProposalInputSummary;
}

export function validateAndNormalizeSolarProposalInput(
  raw: SolarProposalInput,
  defaultPanelWattage: number
): NormalizedSolarProposalInput {
  if (!isSupportedSystemSizeKw(raw.systemSizeKw)) {
    throw new SolarProposalValidationError("INVALID_SIZE", `Unsupported system size: ${raw.systemSizeKw} kW`);
  }
  if (!EQUIPMENT_TIERS.includes(raw.tier)) {
    throw new SolarProposalValidationError("INVALID_TIER", `Unsupported tier: ${raw.tier}`);
  }
  if (!SYSTEM_TYPES.includes(raw.systemType)) {
    throw new SolarProposalValidationError("INVALID_SYSTEM_TYPE", `Unsupported system type: ${raw.systemType}`);
  }
  if (!STRUCTURE_TYPES.includes(raw.structureType)) {
    throw new SolarProposalValidationError("INVALID_STRUCTURE", `Unsupported structure type: ${raw.structureType}`);
  }

  const panelWattage = resolvePanelWattage(raw.panelWattage, defaultPanelWattage);
  const siteComplexityScore = resolveSiteComplexityScore(raw.siteComplexityScore);

  const roofWidthMeters =
    raw.roofWidthMeters !== undefined && raw.roofWidthMeters !== null
      ? assertPositiveFinite("roofWidthMeters", raw.roofWidthMeters)
      : undefined;
  const canvasWidth =
    raw.canvasWidth !== undefined && raw.canvasWidth !== null
      ? assertPositiveFinite("canvasWidth", raw.canvasWidth)
      : undefined;

  const input: SolarProposalInput = {
    systemSizeKw: raw.systemSizeKw,
    tier: raw.tier,
    systemType: raw.systemType,
    structureType: raw.structureType,
    panelWattage,
    siteComplexityScore,
    netMeteringRequired: raw.netMeteringRequired,
    roofBoundary: raw.roofBoundary,
    obstacles: raw.obstacles,
    roofWidthMeters,
    canvasWidth,
  };

  const summary: ProposalInputSummary = {
    systemSizeKw: raw.systemSizeKw,
    tier: raw.tier,
    systemType: raw.systemType,
    structureType: raw.structureType,
    panelWattage,
    siteComplexityScore,
  };

  return { input, summary };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
