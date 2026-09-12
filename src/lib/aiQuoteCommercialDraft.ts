/**
 * Deterministic AI Quote Builder draft — BOQ snapshot only.
 * Apply never writes CRM and never sends messages.
 */

import {
  applyScopeDependencies,
  projectScopeToBoqRows,
  suppressedGenericChargeIds,
  validateProjectScope,
  type ProjectScopeState,
} from "./quoteProjectScope";
import type { BoqRow, Product } from "../types";
import {
  calculateArrayWatts,
  calculateElevatedStructureTotal,
  calculateInstallationTotal,
  calculatePanelTotal,
  calculatePanelUnitPrice,
  DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT,
  DEFAULT_GIRDER_STRUCTURE_AMOUNT,
  DEFAULT_INSTALLATION_RATE_PER_WATT,
  finiteNumber,
  nonNegativeFinite,
  nonNegativeInteger,
  positiveFinite,
  positiveInteger,
  recommendedPanelQuantity,
} from "./quoteCommercialMath";
import type { QuoteDiscountType } from "./quoteDiscount";
import { liftWebsiteSourceFields, normalizeIdentityKey } from "./websiteCatalog/normalize";
import {
  L2_PANEL_POSITIONS,
  L2_STRUCTURE_KIT_RATE,
  L3_PANEL_POSITIONS,
  L3_STRUCTURE_KIT_RATE,
  STRUCTURE_L2_ROW_ID,
  STRUCTURE_L3_ROW_ID,
  recommendStructures,
  structureKitRowFields,
} from "./autoSizer/structureRecommendation";
import { liveCatalogProductId } from "./autoSizer/companyPresets";
import {
  DEFAULT_AC_CABLE_METERS,
  DEFAULT_AC_CABLE_RATE,
  DEFAULT_AC_CABLE_SIZE,
  DEFAULT_DC_CABLE_RATE,
  DEFAULT_DC_CABLE_SIZE,
  DEFAULT_EARTH_WIRE_METERS,
  DEFAULT_EARTH_WIRE_RATE,
  dcCableQuantityMeters,
} from "./autoSizer/presets";

export type QuoteStructureKind = "standard" | "elevated" | "girder" | "custom";
export type QuoteStructureMode = "auto" | "manual";
export type QuoteSystemType = "On-grid" | "Hybrid" | "Off-grid";

export const QUICK_PANEL_WATTAGES = [580, 585, 610, 615, 625, 635, 645] as const;

export const STRUCTURE_CAPACITY_WARNING = "Selected L2/L3 structure does not support all selected panels.";

export interface CommercialQuoteConfig {
  systemSizeKw: number;
  systemType: QuoteSystemType;
  panelBrand: string;
  panelModel: string;
  panelWattage: number;
  panelQuantity: number;
  panelRatePerWatt: number;
  panelCatalogProductId: string;
  panelWebsitePrice?: number;
  inverterBrand: string;
  inverterModel: string;
  inverterCapacity: string;
  inverterQuantity: number;
  inverterUnitPrice: number;
  inverterCatalogProductId: string;
  inverterWebsitePrice?: number;
  batteryEnabled: boolean;
  batteryBrand: string;
  batteryModel: string;
  batteryCapacityKwh: string;
  batteryQuantity: number;
  batteryUnitPrice: number;
  batteryCatalogProductId: string;
  batteryWebsitePrice?: number;
  structureType: QuoteStructureKind;
  structureMode?: QuoteStructureMode;
  manualL3Quantity?: number;
  manualL2Quantity?: number;
  l3RatePerSection?: number;
  l2RatePerSection?: number;
  installationRatePerWatt: number;
  elevatedStructureRatePerWatt: number;
  girderAmount: number;
  customStructureName: string;
  customStructureDescription: string;
  customStructureAmount: number;
  otherCharges?: Partial<CommercialOtherCharges>;
  projectScope?: ProjectScopeState;
}

export interface QuoteOptionalCharge {
  enabled: boolean;
  qty: number;
  rate: number;
  name?: string;
  description?: string;
}

export interface CommercialOtherCharges {
  dcCable: QuoteOptionalCharge;
  acCable: QuoteOptionalCharge;
  earthWire: QuoteOptionalCharge;
  dbBox: QuoteOptionalCharge;
  earthingBore: QuoteOptionalCharge;
  civilWork: QuoteOptionalCharge;
  freight: QuoteOptionalCharge;
  netMetering: QuoteOptionalCharge;
  surveyDesign: QuoteOptionalCharge;
}

export const DEFAULT_DB_BOX_RATE = 32000;
export const DEFAULT_EARTHING_BORE_RATE = 48000;
export const DEFAULT_CIVIL_WORK_RATE = 16000;
export const DEFAULT_FREIGHT_RATE = 10000;
export const DEFAULT_SURVEY_DESIGN_RATE = 5000;

export function defaultNetMeteringRate(systemSizeKw: number): number {
  const size = finiteNumber(systemSizeKw, 0);
  if (size >= 100) return 150000;
  if (size >= 50) return 120000;
  if (size >= 30) return 100000;
  return 90000;
}

export function defaultEarthingBoreQuantity(systemSizeKw: number): number {
  return finiteNumber(systemSizeKw, 0) > 15 ? 3 : 2;
}

export function defaultNetMeteringEnabled(systemType?: QuoteSystemType | string): boolean {
  return String(systemType || "").trim() !== "Off-grid";
}

function charge(partial: QuoteOptionalCharge): QuoteOptionalCharge {
  return {
    enabled: partial.enabled !== false,
    qty: finiteNumber(partial.qty, 0),
    rate: finiteNumber(partial.rate, 0),
    name: partial.name,
    description: partial.description,
  };
}

export function defaultOtherCharges(
  systemSizeKw: number,
  systemType?: QuoteSystemType | string
): CommercialOtherCharges {
  const size = finiteNumber(systemSizeKw, 10);
  return {
    dcCable: charge({
      enabled: true,
      qty: dcCableQuantityMeters(size),
      rate: DEFAULT_DC_CABLE_RATE,
      name: `DC Solar Cable ${DEFAULT_DC_CABLE_SIZE}`,
      description: `Double Insulated Tin Coated DC Solar Cable ${DEFAULT_DC_CABLE_SIZE}`,
    }),
    acCable: charge({
      enabled: true,
      qty: DEFAULT_AC_CABLE_METERS,
      rate: DEFAULT_AC_CABLE_RATE,
      name: `AC Connecting Cable ${DEFAULT_AC_CABLE_SIZE}`,
      description: "AC copper flexible connection cable job",
    }),
    earthWire: charge({
      enabled: true,
      qty: DEFAULT_EARTH_WIRE_METERS,
      rate: DEFAULT_EARTH_WIRE_RATE,
      name: "Earthing Bare Copper Wire",
      description: "Bare copper conductor for system grounding",
    }),
    dbBox: charge({
      enabled: true,
      qty: 1,
      rate: DEFAULT_DB_BOX_RATE,
      name: "AC/DC Distribution DB Box Equipped",
      description: "Miniature Circuit Breakers, SPDs, GADA/Chint switches",
    }),
    earthingBore: charge({
      enabled: true,
      qty: defaultEarthingBoreQuantity(size),
      rate: DEFAULT_EARTHING_BORE_RATE,
      name: "Chemical Earthing Bores",
      description: "Copper rods with chemical enhancement compound filling",
    }),
    civilWork: charge({
      enabled: true,
      qty: 1,
      rate: DEFAULT_CIVIL_WORK_RATE,
      name: "Structure Pillars Foundations civil work",
      description: "Concrete pillar foundation blocks for load stability",
    }),
    freight: charge({
      enabled: true,
      qty: 1,
      rate: DEFAULT_FREIGHT_RATE,
      name: "Transportation, Logistics Freight & Manual Lifting",
      description: "Equipment loading, delivery to site and manual roof shifting logistics",
    }),
    netMetering: charge({
      enabled: defaultNetMeteringEnabled(systemType),
      qty: 1,
      rate: defaultNetMeteringRate(size),
      name: "LESCO Net Metering Licensing Process",
      description: "Document processing, demand notice payments & green meter commission",
    }),
    surveyDesign: charge({
      enabled: true,
      qty: 1,
      rate: DEFAULT_SURVEY_DESIGN_RATE,
      name: "Survey, Designing, Testing & Project Management Suite",
      description: "Engineering site audit, CAD layouts, electrical simulations",
    }),
  };
}

export function mergeOtherCharges(
  systemSizeKw: number,
  overrides?: Partial<CommercialOtherCharges> | null,
  systemType?: QuoteSystemType | string
): CommercialOtherCharges {
  const defaults = defaultOtherCharges(systemSizeKw, systemType);
  if (!overrides) return defaults;
  const keys = Object.keys(defaults) as Array<keyof CommercialOtherCharges>;
  const next = { ...defaults };
  for (const key of keys) {
    const patch = overrides[key];
    if (!patch) continue;
    next[key] = {
      ...defaults[key],
      ...patch,
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : defaults[key].enabled,
      qty: finiteNumber(patch.qty, defaults[key].qty),
      rate: finiteNumber(patch.rate, defaults[key].rate),
    };
  }
  return next;
}

export function optionalChargeTotal(line: QuoteOptionalCharge | undefined): number {
  if (!line?.enabled) return 0;
  return finiteNumber(line.qty, 0) * finiteNumber(line.rate, 0);
}

export function otherChargesSubtotal(charges: CommercialOtherCharges): number {
  return (
    optionalChargeTotal(charges.dcCable) +
    optionalChargeTotal(charges.acCable) +
    optionalChargeTotal(charges.earthWire) +
    optionalChargeTotal(charges.dbBox) +
    optionalChargeTotal(charges.earthingBore) +
    optionalChargeTotal(charges.civilWork) +
    optionalChargeTotal(charges.freight) +
    optionalChargeTotal(charges.netMetering) +
    optionalChargeTotal(charges.surveyDesign)
  );
}

export type AiQuoteDiscountMode = "none" | "fixed" | "percentage";

export interface AiQuoteFinancialDraft {
  discountMode: AiQuoteDiscountMode;
  discountValue: number;
  taxEnabled: boolean;
  taxRate: number;
  societyCharges: number;
}

export function copyParentFinancialDraft(parent?: {
  discountType?: string;
  discountValue?: number;
  taxEnabled?: boolean;
  taxRate?: number;
  societyCharges?: number;
} | null): AiQuoteFinancialDraft {
  const type = String(parent?.discountType || "").toLowerCase();
  const value = Math.max(0, finiteNumber(parent?.discountValue, 0));
  let discountMode: AiQuoteDiscountMode = "none";
  if (type === "percentage") discountMode = "percentage";
  else if (type === "fixed" && value > 0) discountMode = "fixed";
  return {
    discountMode,
    discountValue: discountMode === "none" ? 0 : value,
    taxEnabled: Boolean(parent?.taxEnabled),
    taxRate: finiteNumber(parent?.taxRate, 17),
    societyCharges: Math.max(0, finiteNumber(parent?.societyCharges, 0)),
  };
}

export function commitFinancialDraft(draft: AiQuoteFinancialDraft): {
  discountType: QuoteDiscountType;
  discountValue: number;
  taxEnabled: boolean;
  taxRate: number;
  societyCharges: number;
} {
  if (draft.discountMode === "none") {
    return {
      discountType: "fixed",
      discountValue: 0,
      taxEnabled: Boolean(draft.taxEnabled),
      taxRate: finiteNumber(draft.taxRate, 17),
      societyCharges: Math.max(0, finiteNumber(draft.societyCharges, 0)),
    };
  }
  const raw = finiteNumber(draft.discountValue, 0);
  const discountValue =
    draft.discountMode === "percentage" ? Math.min(100, Math.max(0, raw)) : Math.max(0, raw);
  return {
    discountType: draft.discountMode,
    discountValue,
    taxEnabled: Boolean(draft.taxEnabled),
    taxRate: finiteNumber(draft.taxRate, 17),
    societyCharges: Math.max(0, finiteNumber(draft.societyCharges, 0)),
  };
}

export function financialDraftDiscountInput(draft: AiQuoteFinancialDraft): {
  discountType: QuoteDiscountType;
  discountValue: number;
} {
  const committed = commitFinancialDraft(draft);
  return { discountType: committed.discountType, discountValue: committed.discountValue };
}

export interface CommercialQuoteDraftApply {
  systemSizekW: number;
  systemType: QuoteSystemType;
  panelBrand: string;
  panelModel: string;
  panelWattage: number;
  panelQuantity: number;
  panelRatePerWatt: number;
  panelCatalogProductId: string;
  inverterBrand: string;
  inverterModel: string;
  inverterCapacity: string;
  inverterQuantity: number;
  inverterUnitPrice: number;
  inverterCatalogProductId: string;
  batteryOption: string;
  batteryCatalogProductId: string;
  batteryQuantity: number;
  batteryUnitPrice: number;
  structureType: QuoteStructureKind;
  installationRatePerWatt: number;
  elevatedStructureRatePerWatt: number;
  boqRows: BoqRow[];
  draftOnly: true;
}

export interface StandardStructureSelection {
  mode: QuoteStructureMode;
  l3: number;
  l2: number;
  capacity: number;
  panelQuantity: number;
  underCapacity: boolean;
}

function item(partial: Omit<BoqRow, "type" | "description" | "brand" | "unit"> & Partial<BoqRow>): BoqRow {
  return {
    type: "item",
    description: "",
    brand: "",
    unit: "Pcs",
    ...partial,
  };
}

function heading(id: string, name: string): BoqRow {
  return { id, type: "heading", name, description: "AI Quote Builder draft section", brand: "", unit: "", qty: 0, rate: 0, total: 0 };
}

function subtotalRow(id: string, name: string, total: number): BoqRow {
  return { id, type: "subtotal", name, description: "", brand: "", unit: "", qty: 0, rate: 0, total };
}

function optionalChargeRow(
  id: string,
  srNo: string,
  line: QuoteOptionalCharge,
  fallback: { name: string; description: string; brand: string; unit: string }
): BoqRow | null {
  if (!line.enabled) return null;
  const qty = finiteNumber(line.qty, 0);
  const rate = finiteNumber(line.rate, 0);
  return item({
    id,
    srNo,
    name: line.name || fallback.name,
    description: line.description || fallback.description,
    brand: fallback.brand,
    unit: fallback.unit,
    qty,
    rate,
    total: qty * rate,
  });
}

function pushIf(rows: BoqRow[], row: BoqRow | null): void {
  if (row) rows.push(row);
}

export function defaultBatteryEnabled(systemType: QuoteSystemType): boolean {
  return systemType !== "On-grid";
}

export function isQuickPanelWattage(value: number): boolean {
  return (QUICK_PANEL_WATTAGES as readonly number[]).includes(value);
}

export function parsePositiveNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numbersMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

function specNumber(product: { specifications?: Record<string, unknown> } | null | undefined, keys: string[]): number | null {
  if (!product) return null;
  const specs = (product.specifications || {}) as Record<string, unknown>;
  for (const key of keys) {
    const n = Number(specs[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function catalogProductWattage(
  product: { specifications?: Record<string, unknown>; name?: string; model?: string; wattageCapacity?: string } | null | undefined
): number | null {
  const fromSpec = specNumber(product, ["panelWattage", "wattage"]);
  if (fromSpec) return fromSpec;
  const match = `${product?.name || ""} ${product?.model || ""} ${product?.wattageCapacity || ""}`.match(
    /(\d+(?:\.\d+)?)\s*w\b/i
  );
  return match ? Number(match[1]) : null;
}

export function catalogProductInverterKw(
  product: { specifications?: Record<string, unknown>; name?: string; model?: string; wattageCapacity?: string } | null | undefined
): number | null {
  const fromSpec = specNumber(product, ["inverterKw", "capacityKw", "ratedKw"]);
  if (fromSpec) return fromSpec;
  const match = `${product?.name || ""} ${product?.model || ""} ${product?.wattageCapacity || ""}`.match(
    /(\d+(?:\.\d+)?)\s*kw\b/i
  );
  return match ? Number(match[1]) : null;
}

export function catalogProductBatteryKwh(
  product: { specifications?: Record<string, unknown>; name?: string; model?: string; wattageCapacity?: string } | null | undefined
): number | null {
  const fromSpec = specNumber(product, ["batteryKwh", "capacityKwh", "kwh"]);
  if (fromSpec) return fromSpec;
  const match = `${product?.name || ""} ${product?.model || ""} ${product?.wattageCapacity || ""}`.match(
    /(\d+(?:\.\d+)?)\s*kwh\b/i
  );
  return match ? Number(match[1]) : null;
}

export function wattageLabelFromProduct(product: Parameters<typeof catalogProductWattage>[0]): number {
  return catalogProductWattage(product) || 0;
}

export function inverterKwLabelFromProduct(product: Parameters<typeof catalogProductInverterKw>[0]): string {
  const kw = catalogProductInverterKw(product);
  return kw ? `${kw}kW` : "";
}

export function batteryKwhLabelFromProduct(product: Parameters<typeof catalogProductBatteryKwh>[0]): string {
  const kwh = catalogProductBatteryKwh(product);
  return kwh ? `${kwh}kWh` : "";
}

export function catalogProductMatchesWattage(
  product: Parameters<typeof catalogProductWattage>[0],
  wattage: number
): boolean {
  const productW = catalogProductWattage(product);
  if (productW == null) return true;
  const next = parsePositiveNumber(wattage);
  if (next == null) return true;
  return numbersMatch(productW, next);
}

export function catalogProductMatchesInverterCapacity(
  product: Parameters<typeof catalogProductInverterKw>[0],
  capacity: string | number
): boolean {
  const productKw = catalogProductInverterKw(product);
  if (productKw == null) return true;
  const next = parsePositiveNumber(capacity);
  if (next == null) return true;
  return numbersMatch(productKw, next);
}

export function catalogProductMatchesBatteryCapacity(
  product: Parameters<typeof catalogProductBatteryKwh>[0],
  capacityKwh: string | number
): boolean {
  const productKwh = catalogProductBatteryKwh(product);
  if (productKwh == null) return true;
  const next = parsePositiveNumber(capacityKwh);
  if (next == null) return true;
  return numbersMatch(productKwh, next);
}

export function catalogIdAfterBrandChange(currentId: string, previousBrand: string, nextBrand: string): string {
  if (!currentId) return "";
  if (normalizeIdentityKey(previousBrand) !== normalizeIdentityKey(nextBrand)) return "";
  return currentId;
}

export function catalogProductMatchesIdentity(
  product: { brand?: string; model?: string; name?: string } | null | undefined,
  brand: string,
  model?: string
): boolean {
  if (!product) return false;
  if (normalizeIdentityKey(product.brand) !== normalizeIdentityKey(brand)) return false;
  if (!model) return true;
  const productModel = normalizeIdentityKey(product.model || product.name);
  return !productModel || productModel === normalizeIdentityKey(model);
}

export function catalogProductMatchesPanelIdentity(
  product: Parameters<typeof catalogProductWattage>[0] & { brand?: string; model?: string; name?: string } | null | undefined,
  brand: string,
  model: string,
  wattage: number
): boolean {
  return catalogProductMatchesIdentity(product, brand, model) && catalogProductMatchesWattage(product, wattage);
}

export function catalogProductMatchesInverterIdentity(
  product: Parameters<typeof catalogProductInverterKw>[0] & { brand?: string; model?: string; name?: string } | null | undefined,
  brand: string,
  model: string,
  capacity: string
): boolean {
  return catalogProductMatchesIdentity(product, brand, model) && catalogProductMatchesInverterCapacity(product, capacity);
}

export function catalogProductMatchesBatteryIdentity(
  product: Parameters<typeof catalogProductBatteryKwh>[0] & { brand?: string; model?: string; name?: string } | null | undefined,
  brand: string,
  model: string,
  capacityKwh: string
): boolean {
  return catalogProductMatchesIdentity(product, brand, model) && catalogProductMatchesBatteryCapacity(product, capacityKwh);
}

export function catalogIdAfterWattageChange(
  currentId: string,
  product: Parameters<typeof catalogProductWattage>[0] | null | undefined,
  nextWattage: number
): string {
  if (!currentId) return "";
  return catalogProductMatchesWattage(product, nextWattage) ? currentId : "";
}

export function catalogIdAfterInverterCapacityChange(
  currentId: string,
  product: Parameters<typeof catalogProductInverterKw>[0] | null | undefined,
  nextCapacity: string
): string {
  if (!currentId) return "";
  return catalogProductMatchesInverterCapacity(product, nextCapacity) ? currentId : "";
}

export function catalogIdAfterBatteryCapacityChange(
  currentId: string,
  product: Parameters<typeof catalogProductBatteryKwh>[0] | null | undefined,
  nextCapacityKwh: string
): string {
  if (!currentId) return "";
  return catalogProductMatchesBatteryCapacity(product, nextCapacityKwh) ? currentId : "";
}

export function standCapacityPanels(l3Quantity: number, l2Quantity: number): number {
  const l3 = Math.max(0, Math.floor(finiteNumber(l3Quantity, 0)));
  const l2 = Math.max(0, Math.floor(finiteNumber(l2Quantity, 0)));
  return l3 * L3_PANEL_POSITIONS + l2 * L2_PANEL_POSITIONS;
}

export function kitSectionRate(value: number | undefined, fallback: number): number {
  const parsed = nonNegativeFinite(value);
  return parsed == null ? fallback : parsed;
}

export function resolveStandardStructureSelection(
  config: Pick<CommercialQuoteConfig, "structureMode" | "manualL3Quantity" | "manualL2Quantity" | "panelQuantity">
): StandardStructureSelection {
  const panelQuantity = Math.max(0, Math.floor(finiteNumber(config.panelQuantity, 0)));
  const mode: QuoteStructureMode = config.structureMode === "manual" ? "manual" : "auto";
  if (mode === "manual") {
    const l3 = Math.max(0, Math.floor(finiteNumber(config.manualL3Quantity, 0)));
    const l2 = Math.max(0, Math.floor(finiteNumber(config.manualL2Quantity, 0)));
    const capacity = standCapacityPanels(l3, l2);
    return {
      mode,
      l3,
      l2,
      capacity,
      panelQuantity,
      underCapacity: capacity < panelQuantity,
    };
  }
  const recommended = recommendStructures(panelQuantity);
  return {
    mode,
    l3: recommended.l3,
    l2: recommended.l2,
    capacity: recommended.positions,
    panelQuantity,
    underCapacity: recommended.positions < panelQuantity,
  };
}

export function standardStructureSummaryLabel(selection: StandardStructureSelection): string {
  const kits = `${selection.l3} L3 + ${selection.l2} L2`;
  if (selection.mode === "manual") {
    return `Manual — ${kits} · capacity ${selection.capacity} panels`;
  }
  return `Auto — ${kits}`;
}

export function validateCommercialQuoteConfig(config: CommercialQuoteConfig): string[] {
  const errors: string[] = [];
  if (positiveFinite(config.systemSizeKw) == null) errors.push("System size must be greater than 0 kW.");
  if (positiveFinite(config.panelWattage) == null) errors.push("Panel wattage must be greater than 0.");
  if (positiveInteger(config.panelQuantity) == null) errors.push("Panel quantity must be a whole number greater than 0.");
  if (nonNegativeFinite(config.panelRatePerWatt) == null) errors.push("Panel PKR/W cannot be negative.");
  if (nonNegativeFinite(config.installationRatePerWatt) == null) errors.push("Installation PKR/W cannot be negative.");
  if (nonNegativeFinite(config.elevatedStructureRatePerWatt) == null) errors.push("Elevated structure PKR/W cannot be negative.");
  if (positiveInteger(config.inverterQuantity) == null) errors.push("Inverter quantity must be a whole number greater than 0.");
  if (nonNegativeFinite(config.inverterUnitPrice) == null) errors.push("Inverter unit price cannot be negative.");
  if (config.batteryEnabled && config.systemType !== "On-grid") {
    if (positiveInteger(config.batteryQuantity) == null) errors.push("Battery quantity must be a whole number greater than 0.");
    if (nonNegativeFinite(config.batteryUnitPrice) == null) errors.push("Battery unit price cannot be negative.");
  }
  if (config.structureType === "girder" && nonNegativeFinite(config.girderAmount) == null) {
    errors.push("Girder amount cannot be negative.");
  }
  if (config.structureType === "custom" && nonNegativeFinite(config.customStructureAmount) == null) {
    errors.push("Custom structure amount cannot be negative.");
  }
  if (config.structureType === "standard" && config.structureMode === "manual") {
    if (nonNegativeInteger(config.manualL3Quantity) == null) errors.push("L3 quantity must be a whole number of 0 or more.");
    if (nonNegativeInteger(config.manualL2Quantity) == null) errors.push("L2 quantity must be a whole number of 0 or more.");
    const selection = resolveStandardStructureSelection(config);
    if (selection.underCapacity) errors.push(STRUCTURE_CAPACITY_WARNING);
  }
  if (config.structureType === "standard") {
    if (nonNegativeFinite(kitSectionRate(config.l3RatePerSection, L3_STRUCTURE_KIT_RATE)) == null) {
      errors.push("L3 structure rate cannot be negative.");
    }
    if (nonNegativeFinite(kitSectionRate(config.l2RatePerSection, L2_STRUCTURE_KIT_RATE)) == null) {
      errors.push("L2 structure rate cannot be negative.");
    }
  }
  const charges = mergeOtherCharges(config.systemSizeKw, config.otherCharges, config.systemType);
  const chargeLabels: Array<[keyof CommercialOtherCharges, string]> = [
    ["dcCable", "DC Cable"],
    ["acCable", "AC Cable"],
    ["earthWire", "Earthing Wire"],
    ["dbBox", "DB / Protection"],
    ["earthingBore", "Earthing Bore"],
    ["civilWork", "Civil Work"],
    ["freight", "Transportation / Freight"],
    ["netMetering", "Net Metering"],
    ["surveyDesign", "Survey / Design"],
  ];
  for (const [key, label] of chargeLabels) {
    const line = charges[key];
    if (!line.enabled) continue;
    if (positiveFinite(line.qty) == null) errors.push(`${label} quantity must be greater than 0.`);
    if (nonNegativeFinite(line.rate) == null) errors.push(`${label} rate cannot be negative.`);
  }
  if (config.projectScope) {
    const ctx = {
      systemType: config.systemType,
      structureType: config.structureType,
      batteryEnabled: Boolean(config.batteryEnabled) && config.systemType !== "On-grid",
      panelQuantity: Math.max(0, Math.floor(finiteNumber(config.panelQuantity, 0))),
    };
    const resolved = applyScopeDependencies(config.projectScope, ctx);
    errors.push(...validateProjectScope(resolved, ctx));
  }
  return errors;
}

export function buildCommercialQuoteBoq(config: CommercialQuoteConfig): BoqRow[] {
  const wattage = finiteNumber(config.panelWattage, 0);
  const qty = Math.max(0, Math.floor(finiteNumber(config.panelQuantity, 0)));
  const panelRate = finiteNumber(config.panelRatePerWatt, 0);
  const installRateW = finiteNumber(config.installationRatePerWatt, 0);
  const arrayWatts = calculateArrayWatts(wattage, qty);
  const panelUnit = calculatePanelUnitPrice(wattage, panelRate);
  const panelTotal = calculatePanelTotal(wattage, qty, panelRate);
  const installTotal = calculateInstallationTotal(wattage, qty, installRateW);
  const rows: BoqRow[] = [];

  rows.push({
    id: "ai-h-equipment",
    type: "heading",
    name: "Imported Equipment",
    description: "AI Quote Builder draft section",
    brand: "",
    unit: "",
    qty: 0,
    rate: 0,
    total: 0,
  });

  rows.push(
    item({
      id: "panel_row",
      srNo: "1",
      name: `${config.panelBrand} ${wattage}W ${config.panelModel}`.replace(/\s+/g, " ").trim(),
      description: `Quoted at Rs. ${panelRate}/W × ${wattage}W × ${qty} pcs (actual DC array ${arrayWatts} W)`,
      brand: config.panelBrand,
      unit: "Pcs",
      qty,
      rate: panelUnit,
      total: panelTotal,
      catalogProductId: config.panelCatalogProductId || "",
    })
  );

  const invQty = Math.max(0, Math.floor(finiteNumber(config.inverterQuantity, 0)));
  const invRate = finiteNumber(config.inverterUnitPrice, 0);
  rows.push(
    item({
      id: "inverter_row",
      srNo: "2",
      name: `${config.inverterBrand} ${config.inverterCapacity} ${config.inverterModel}`.replace(/\s+/g, " ").trim(),
      description: "Smart inverter — website catalogue price is a suggestion only",
      brand: config.inverterBrand,
      unit: "Pcs",
      qty: invQty,
      rate: invRate,
      total: invQty * invRate,
      catalogProductId: config.inverterCatalogProductId || "",
    })
  );

  if (config.batteryEnabled && config.systemType !== "On-grid") {
    const battQty = Math.max(0, Math.floor(finiteNumber(config.batteryQuantity, 0)));
    const battRate = finiteNumber(config.batteryUnitPrice, 0);
    const battName = [config.batteryBrand, config.batteryModel, config.batteryCapacityKwh].filter(Boolean).join(" ");
    rows.push(
      item({
        id: "battery_row",
        srNo: "3",
        name: battName || "Lithium Battery",
        description: "Battery selection from website/CRM catalog — quote unit price is editable",
        brand: config.batteryBrand,
        unit: "Pcs",
        qty: battQty,
        rate: battRate,
        total: battQty * battRate,
        catalogProductId: config.batteryCatalogProductId || "",
      })
    );
  }

  const equipmentTotal = rows.filter((r) => r.type === "item").reduce((s, r) => s + (Number(r.total) || 0), 0);
  rows.push(subtotalRow("ai-s-equipment", "Imported Equipment Subtotal", equipmentTotal));

  const charges = mergeOtherCharges(config.systemSizeKw, config.otherCharges, config.systemType);
  const scopeCtx = {
    systemType: config.systemType,
    structureType: config.structureType,
    batteryEnabled: Boolean(config.batteryEnabled) && config.systemType !== "On-grid",
    panelQuantity: qty,
  };
  const resolvedScope = config.projectScope ? applyScopeDependencies(config.projectScope, scopeCtx) : null;
  const skipGeneric = suppressedGenericChargeIds(resolvedScope);

  const cableRows: BoqRow[] = [];
  pushIf(
    cableRows,
    skipGeneric.has("dc_cable_row")
      ? null
      : optionalChargeRow("dc_cable_row", "4", charges.dcCable, {
          name: `DC Solar Cable ${DEFAULT_DC_CABLE_SIZE}`,
          description: `Double Insulated Tin Coated DC Solar Cable ${DEFAULT_DC_CABLE_SIZE}`,
          brand: "GM/FAST",
          unit: "Meter",
        })
  );
  pushIf(
    cableRows,
    skipGeneric.has("ac_cable_row")
      ? null
      : optionalChargeRow("ac_cable_row", "5", charges.acCable, {
          name: `AC Connecting Cable ${DEFAULT_AC_CABLE_SIZE}`,
          description: "AC copper flexible connection cable job",
          brand: "GM/FAST",
          unit: "Meter",
        })
  );
  pushIf(
    cableRows,
    skipGeneric.has("earth_wire_row")
      ? null
      : optionalChargeRow("earth_wire_row", "6", charges.earthWire, {
          name: "Earthing Bare Copper Wire",
          description: "Bare copper conductor for system grounding",
          brand: "GM/FAST",
          unit: "Meter",
        })
  );
  if (cableRows.length) {
    rows.push(heading("ai-h-cables", "Cables & Conductors"));
    rows.push(...cableRows);
    rows.push(subtotalRow("ai-s-cables", "Cables & Conductors Subtotal", cableRows.reduce((s, r) => s + (Number(r.total) || 0), 0)));
  }

  const dbRow = optionalChargeRow("db_box_row", "7", charges.dbBox, {
    name: "AC/DC Distribution DB Box Equipped",
    description: "Miniature Circuit Breakers, SPDs, GADA/Chint switches",
    brand: "GADA/Chint",
    unit: "Job",
  });
  if (dbRow) {
    rows.push(heading("ai-h-db", "DB Boxes & Breakers"));
    rows.push(dbRow);
    rows.push(subtotalRow("ai-s-db", "DB Boxes & Breakers Subtotal", Number(dbRow.total) || 0));
  }

  const boreRow = optionalChargeRow("earthing_bore_row", "9", charges.earthingBore, {
    name: "Chemical Earthing Bores",
    description: "Copper rods with chemical enhancement compound filling",
    brand: "Local",
    unit: "Bores",
  });
  if (boreRow) {
    rows.push(heading("ai-h-earth", "System Earthing Works"));
    rows.push(boreRow);
    rows.push(subtotalRow("ai-s-earth", "System Earthing Works Subtotal", Number(boreRow.total) || 0));
  }

  rows.push(heading("ai-h-install", "Installation & Structure"));

  if (config.structureType === "standard") {
    const selection = resolveStandardStructureSelection({ ...config, panelQuantity: qty });
    const l3Rate = kitSectionRate(config.l3RatePerSection, L3_STRUCTURE_KIT_RATE);
    const l2Rate = kitSectionRate(config.l2RatePerSection, L2_STRUCTURE_KIT_RATE);
    if (selection.l3 > 0) {
      rows.push({
        id: STRUCTURE_L3_ROW_ID,
        type: "item",
        ...structureKitRowFields("L3", selection.l3),
        rate: l3Rate,
        total: selection.l3 * l3Rate,
      });
    }
    if (selection.l2 > 0) {
      rows.push({
        id: STRUCTURE_L2_ROW_ID,
        type: "item",
        ...structureKitRowFields("L2", selection.l2),
        rate: l2Rate,
        total: selection.l2 * l2Rate,
      });
    }
  } else if (config.structureType === "elevated") {
    const elevatedRate = finiteNumber(
      config.elevatedStructureRatePerWatt,
      DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT
    );
    const elevatedTotal = calculateElevatedStructureTotal(wattage, qty, elevatedRate);
    rows.push(
      item({
        id: "structure_row",
        srNo: "5",
        name: "Elevated Mechanical Mounting Structure",
        description: `Elevated structure priced at Rs. ${elevatedRate}/W over actual DC array (${arrayWatts} W). Standard L2/L3 kits are not used.`,
        brand: "Mughal",
        unit: "Job",
        qty: 1,
        rate: elevatedTotal,
        total: elevatedTotal,
      })
    );
  } else if (config.structureType === "girder") {
    const amount = finiteNumber(config.girderAmount, DEFAULT_GIRDER_STRUCTURE_AMOUNT);
    rows.push(
      item({
        id: "structure_row",
        srNo: "5",
        name: "Premium Mughal Girder Framing Structure",
        description: "Heavy duty steel columns & girder frames — existing commercial job amount, editable.",
        brand: "Mughal",
        unit: "Job",
        qty: 1,
        rate: amount,
        total: amount,
      })
    );
  } else {
    const amount = finiteNumber(config.customStructureAmount, 0);
    rows.push(
      item({
        id: "structure_row",
        srNo: "5",
        name: config.customStructureName || "Custom Mounting Structure",
        description: config.customStructureDescription || "Custom structure — no formula; amount is manual.",
        brand: "Custom",
        unit: "Job",
        qty: 1,
        rate: amount,
        total: amount,
      })
    );
  }

  pushIf(
    rows,
    optionalChargeRow("civil_work_row", "11", charges.civilWork, {
      name: "Structure Pillars Foundations civil work",
      description: "Concrete pillar foundation blocks for load stability",
      brand: "Local",
      unit: "Job",
    })
  );

  rows.push(
    item({
      id: "install_service_row",
      srNo: "4",
      name: "Complete Installation & Commissioning",
      description: `Installation & commissioning calculated at Rs. ${installRateW}/W over actual DC array (${arrayWatts} W).`,
      brand: "Sunchaser",
      unit: "Job",
      qty: 1,
      rate: installTotal,
      total: installTotal,
    })
  );

  const installSectionTotal = rows
    .filter(
      (r) =>
        r.type === "item" &&
        (r.id === "install_service_row" ||
          r.id === "structure_row" ||
          r.id === STRUCTURE_L3_ROW_ID ||
          r.id === STRUCTURE_L2_ROW_ID ||
          r.id === "civil_work_row")
    )
    .reduce((s, r) => s + (Number(r.total) || 0), 0);
  rows.push(subtotalRow("ai-s-install", "Installation & Structure Subtotal", installSectionTotal));

  const serviceRows: BoqRow[] = [];
  pushIf(
    serviceRows,
    optionalChargeRow("freight_row", "13", charges.freight, {
      name: "Transportation, Logistics Freight & Manual Lifting",
      description: "Equipment loading, delivery to site and manual roof shifting logistics",
      brand: "Local",
      unit: "Job",
    })
  );
  pushIf(
    serviceRows,
    optionalChargeRow("net_metering_row", "14", charges.netMetering, {
      name: "LESCO Net Metering Licensing Process",
      description: "Document processing, demand notice payments & green meter commission",
      brand: "LESCO",
      unit: "Job",
    })
  );
  pushIf(
    serviceRows,
    optionalChargeRow("survey_design_row", "15", charges.surveyDesign, {
      name: "Survey, Designing, Testing & Project Management Suite",
      description: "Engineering site audit, CAD layouts, electrical simulations",
      brand: "Helios",
      unit: "Job",
    })
  );
  if (serviceRows.length) {
    rows.push(heading("ai-h-services", "Transportation & Services"));
    rows.push(...serviceRows);
    rows.push(
      subtotalRow(
        "ai-s-services",
        "Transportation & Services Subtotal",
        serviceRows.reduce((s, r) => s + (Number(r.total) || 0), 0)
      )
    );
  }

  const scopeRows = projectScopeToBoqRows(resolvedScope);
  if (scopeRows.length) {
    rows.push(heading("ai-h-project-scope", "Advanced Project Scope"));
    rows.push(...scopeRows);
    rows.push(
      subtotalRow(
        "ai-s-project-scope",
        "Advanced Project Scope Subtotal",
        scopeRows.reduce((s, r) => s + (Number(r.total) || 0), 0)
      )
    );
  }

  return rows;
}

export function buildCommercialDraftApply(config: CommercialQuoteConfig): CommercialQuoteDraftApply {
  const batteryLabel = !config.batteryEnabled || config.systemType === "On-grid"
    ? "None"
    : [config.batteryBrand, config.batteryModel, config.batteryCapacityKwh].filter(Boolean).join(" ") || "Battery";
  return {
    systemSizekW: finiteNumber(config.systemSizeKw, 0),
    systemType: config.systemType,
    panelBrand: config.panelBrand,
    panelModel: config.panelModel,
    panelWattage: finiteNumber(config.panelWattage, 0),
    panelQuantity: Math.max(0, Math.floor(finiteNumber(config.panelQuantity, 0))),
    panelRatePerWatt: finiteNumber(config.panelRatePerWatt, 0),
    panelCatalogProductId: config.panelCatalogProductId || "",
    inverterBrand: config.inverterBrand,
    inverterModel: config.inverterModel,
    inverterCapacity: config.inverterCapacity,
    inverterQuantity: Math.max(0, Math.floor(finiteNumber(config.inverterQuantity, 0))),
    inverterUnitPrice: finiteNumber(config.inverterUnitPrice, 0),
    inverterCatalogProductId: config.inverterCatalogProductId || "",
    batteryOption: batteryLabel,
    batteryCatalogProductId: config.batteryEnabled && config.systemType !== "On-grid" ? config.batteryCatalogProductId || "" : "",
    batteryQuantity: config.batteryEnabled ? Math.max(0, Math.floor(finiteNumber(config.batteryQuantity, 0))) : 0,
    batteryUnitPrice: finiteNumber(config.batteryUnitPrice, 0),
    structureType: config.structureType,
    installationRatePerWatt: finiteNumber(config.installationRatePerWatt, 0),
    elevatedStructureRatePerWatt: finiteNumber(config.elevatedStructureRatePerWatt, 0),
    boqRows: buildCommercialQuoteBoq(config),
    draftOnly: true,
  };
}

export function attachLiveCatalogId(products: Product[] | null | undefined, id?: string): string {
  const live = (products || []).map((p) => liftWebsiteSourceFields(p));
  return liveCatalogProductId(live, id);
}

export {
  recommendedPanelQuantity,
  DEFAULT_INSTALLATION_RATE_PER_WATT,
  DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT,
  DEFAULT_GIRDER_STRUCTURE_AMOUNT,
  L3_STRUCTURE_KIT_RATE,
  L2_STRUCTURE_KIT_RATE,
};
