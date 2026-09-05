/**
 * Shared AutoSizer → editable quote snapshot.
 *
 * Production CRM rates and section layout come from the existing Auto Sizer /
 * package BOQ (SalesTeamApp.generateDefaultBoqRows). Standard structures now
 * emit L2/L3 kit lines derived from panel count instead of 1-row-per-panel.
 *
 * Pricing rule (AutoSizer): company commercial quotation rates
 * (panelRateForBrand / inverterRateForKw / batteryRateForOption / cable presets).
 * Manual BOQ catalog picker uses product.price as the initial line rate.
 * Selecting a catalog product in AutoSizer presets attaches catalogProductId
 * but does NOT replace commercial rates. Sales can still edit rates on the snapshot.
 */

import type { BoqRow } from "../../types";
import { calculateBoqRowTotals } from "../boqPackageLibrary";
import {
  resolveAutoSizerPreset,
  recommendedBatteryOption,
  type AutoSizerPreset,
  type AutoSizerSystemType,
} from "./presets";
import {
  hydrateCompanySizePreset,
  liveCatalogProductId,
  parseCompanyAutoSizerPresets,
  type CatalogProductLike,
  type CompanyAutoSizerPresets,
} from "./companyPresets";
import {
  LEGACY_PER_PANEL_STRUCTURE_ROW_ID,
  STRUCTURE_L2_ROW_ID,
  STRUCTURE_L3_ROW_ID,
  normalizeStructureBreakdown,
  recommendStructures,
  structureKitRowFields,
  type StructureBreakdown,
} from "./structureRecommendation";

export { STRUCTURE_L3_ROW_ID, STRUCTURE_L2_ROW_ID };
export const STRUCTURE_JOB_ROW_ID = LEGACY_PER_PANEL_STRUCTURE_ROW_ID;

export const AUTO_SIZER_BOQ_IDS = [
  "h-1",
  "panel_row",
  "inverter_row",
  "battery_row",
  "s-1",
  "h-2",
  "dc_cable_row",
  "ac_cable_row",
  "earth_wire_row",
  "s-2",
  "h-3",
  "db_box_row",
  "s-3",
  "h-4",
  "supplies_row",
  "s-4",
  "h-5",
  "earthing_bore_row",
  "s-5",
  "h-6",
  STRUCTURE_JOB_ROW_ID,
  STRUCTURE_L3_ROW_ID,
  STRUCTURE_L2_ROW_ID,
  "civil_work_row",
  "install_service_row",
  "s-6",
  "h-7",
  "freight_row",
  "net_metering_row",
  "survey_design_row",
  "s-7",
] as const;

export type AutoSizerStructureKind = "standard" | "elevated" | "girder" | "custom" | string;

export interface GenerateRecommendedBoqInput {
  systemSizeKw: number;
  systemType?: AutoSizerSystemType;
  structureType?: AutoSizerStructureKind;
  panelBrand?: string;
  panelWattage?: number;
  inverterBrand?: string;
  inverterCapacity?: string;
  inverterQuantity?: number;
  batteryOption?: string;
  netMeteringRequired?: "Yes" | "No";
  /** Manual L2/L3 quantities. When set, they replace the recommended kit split. */
  structureOverride?: { l3?: number; l2?: number } | null;
  companyPresets?: CompanyAutoSizerPresets | null;
  settings?: unknown;
  products?: CatalogProductLike[] | null;
}

export interface RecommendedBoqResult {
  rows: BoqRow[];
  panelCount: number;
  structure: StructureBreakdown;
  preset: AutoSizerPreset;
  subtotal: number;
}

function estimatePanelCount(systemSizeKw: number, panelWattage: number): number {
  if (systemSizeKw <= 0 || panelWattage <= 0) return 0;
  return Math.ceil((systemSizeKw * 1000) / panelWattage);
}

function normalizeStructureKind(raw?: string): "standard" | "elevated" | "girder" | "custom" {
  const token = String(raw || "standard").trim().toLowerCase();
  if (token === "elevated") return "elevated";
  if (token === "girder") return "girder";
  if (token === "custom") return "custom";
  return "standard";
}

function panelRateForBrand(brand: string): number {
  if (brand === "Longi") return 25215;
  if (brand === "Canadian Solar") return 23000;
  if (brand === "JA Solar") return 19500;
  return 21000;
}

function inverterRateForKw(sizekW: number): number {
  if (sizekW >= 100) return 1400000;
  if (sizekW >= 50) return 800000;
  if (sizekW > 25) return 580000;
  if (sizekW > 15) return 420000;
  return 400000;
}

function batteryRateForOption(batt: string): number {
  if (batt.includes("15.0")) return 690000;
  if (batt.includes("10.24")) return 480000;
  return 235000;
}

function heading(id: string, name: string): BoqRow {
  return { id, type: "heading", name, description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 };
}

function subtotal(id: string, name: string): BoqRow {
  return { id, type: "subtotal", name, description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 };
}

export function generateRecommendedBoq(input: GenerateRecommendedBoqInput): RecommendedBoqResult {
  const sizekW = Number(input.systemSizeKw) || 0;
  const structKind = normalizeStructureKind(input.structureType);
  const companyPresets = input.companyPresets || parseCompanyAutoSizerPresets(input.settings);
  const sizeKey = sizekW === 6 || sizekW === 8 || sizekW === 10 ? sizekW : null;
  const companyPreset = sizeKey
    ? hydrateCompanySizePreset(companyPresets[sizeKey] || companyPresets[String(sizeKey) as "6"], input.products)
    : undefined;

  const preset = resolveAutoSizerPreset(sizekW, {
    structureType: structKind === "elevated" ? "elevated" : "standard",
    systemType: input.systemType,
    companyPreset,
  });

  const pBrand = input.panelBrand || preset.panel.brand;
  const pWattage = Number(input.panelWattage || preset.panel.wattage || 580);
  const iBrand = input.inverterBrand || preset.inverter.brand;
  const iCapacity = input.inverterCapacity || preset.inverter.capacity || `${Math.ceil(sizekW)}kW`;
  const iQty = Math.max(1, Math.floor(Number(input.inverterQuantity || preset.inverter.quantity || 1)));
  const sType = input.systemType || preset.systemType;
  const batt = recommendedBatteryOption(sType, preset.battery.option, input.batteryOption);
  const netMeter = input.netMeteringRequired || preset.netMeteringRequired;
  const struct = normalizeStructureKind(input.structureType || preset.structureType);

  const panelCount = estimatePanelCount(sizekW, pWattage);
  const structure = input.structureOverride
    ? normalizeStructureBreakdown(panelCount, input.structureOverride)
    : recommendStructures(panelCount);

  const panelCatalogId = liveCatalogProductId(input.products, companyPreset?.panelProductId);
  const inverterCatalogId = liveCatalogProductId(input.products, companyPreset?.inverterProductId);
  const batteryCatalogId = liveCatalogProductId(input.products, companyPreset?.batteryProductId);
  const dcCatalogId = liveCatalogProductId(input.products, companyPreset?.dcCableProductId);
  const acCatalogId = liveCatalogProductId(input.products, companyPreset?.acCableProductId);

  const rows: BoqRow[] = [];

  rows.push(heading("h-1", "Imported Equipment"));

  const panelRate = panelRateForBrand(pBrand);
  rows.push({
    id: "panel_row",
    type: "item",
    srNo: "1",
    name: `${pBrand} ${pWattage}W Mono-PERC Solar Panels`,
    description: "Tier-1 high efficiency solar modules",
    brand: pBrand,
    unit: "Pcs",
    qty: panelCount,
    rate: panelRate,
    total: panelCount * panelRate,
    catalogProductId: panelCatalogId,
  });

  const inverterRate = inverterRateForKw(sizekW);
  rows.push({
    id: "inverter_row",
    type: "item",
    srNo: "2",
    name: `${iBrand} ${iCapacity} Smart Sync Inverter`,
    description: "Intelligent energy management inverter",
    brand: iBrand,
    unit: "Pcs",
    qty: iQty,
    rate: inverterRate,
    total: iQty * inverterRate,
    catalogProductId: inverterCatalogId,
  });

  if (sType !== "On-grid" && batt && batt !== "None") {
    const batteryRate = batteryRateForOption(batt);
    rows.push({
      id: "battery_row",
      type: "item",
      srNo: "3",
      name: batt,
      description: "Lithium iron phosphate (LiFePO4) storage batteries",
      brand: "Soluna",
      unit: "Pcs",
      qty: 1,
      rate: batteryRate,
      total: batteryRate,
      catalogProductId: batteryCatalogId,
    });
  }

  rows.push(subtotal("s-1", "Imported Equipment Subtotal"));

  rows.push(heading("h-2", "Cables & Conductors"));
  const dc = preset.cables.find((c) => c.kind === "dc")!;
  const ac = preset.cables.find((c) => c.kind === "ac")!;
  const earth = preset.cables.find((c) => c.kind === "earth")!;

  rows.push({
    id: "dc_cable_row",
    type: "item",
    srNo: "4",
    name: dc.name,
    description: `Double Insulated Tin Coated DC Solar Cable ${dc.size}`,
    brand: dc.brand,
    unit: dc.unit,
    qty: dc.quantity,
    rate: dc.rate,
    total: dc.quantity * dc.rate,
    catalogProductId: dcCatalogId,
  });
  rows.push({
    id: "ac_cable_row",
    type: "item",
    srNo: "5",
    name: ac.name,
    description: "AC copper flexible connection cable job",
    brand: ac.brand,
    unit: ac.unit,
    qty: ac.quantity,
    rate: ac.rate,
    total: ac.quantity * ac.rate,
    catalogProductId: acCatalogId,
  });
  rows.push({
    id: "earth_wire_row",
    type: "item",
    srNo: "6",
    name: earth.name,
    description: "Bare copper conductor for system grounding",
    brand: earth.brand,
    unit: earth.unit,
    qty: earth.quantity,
    rate: earth.rate,
    total: earth.quantity * earth.rate,
  });
  rows.push(subtotal("s-2", "Cables & Conductors Subtotal"));

  rows.push(heading("h-3", "DB Boxes & Breakers"));
  rows.push({
    id: "db_box_row",
    type: "item",
    srNo: "7",
    name: "AC/DC Distribution DB Box Equipped",
    description: "Miniature Circuit Breakers, SPDs, GADA/Chint switches",
    brand: "GADA/Chint",
    unit: "Job",
    qty: 1,
    rate: 32000,
    total: 32000,
  });
  rows.push(subtotal("s-3", "DB Boxes & Breakers Subtotal"));

  rows.push(heading("h-4", "Electrical & Mechanical Supplies"));
  rows.push({
    id: "supplies_row",
    type: "item",
    srNo: "8",
    name: "PVC Pipes, Ducts & Conduits Job",
    description: "Pipes, elbows, joints, PVC trunks/ducts for clean wiring routing",
    brand: "Beta/Eq",
    unit: "Job",
    qty: 1,
    rate: 18000,
    total: 18000,
  });
  rows.push(subtotal("s-4", "Supplies Subtotal"));

  rows.push(heading("h-5", "System Earthing Works"));
  const boreQty = sizekW > 15 ? 3 : 2;
  rows.push({
    id: "earthing_bore_row",
    type: "item",
    srNo: "9",
    name: "Chemical Earthing Bores",
    description: "Copper rods with chemical enhancement compound filling",
    brand: "Local",
    unit: "Bores",
    qty: boreQty,
    rate: 48000,
    total: boreQty * 48000,
  });
  rows.push(subtotal("s-5", "System Earthing Works Subtotal"));

  rows.push(heading("h-6", "System Installation & Fabrication"));

  if (struct === "elevated") {
    rows.push({
      id: STRUCTURE_JOB_ROW_ID,
      type: "item",
      srNo: "10",
      name: "Elevated Mechanical Mounting Structure",
      description: "Hot-Dip Galvanized C-Channel / H-Beam steel fabrication (10ft clearance)",
      brand: "Mughal",
      unit: "Job",
      qty: 1,
      rate: 147600,
      total: 147600,
    });
  } else if (struct === "girder") {
    rows.push({
      id: STRUCTURE_JOB_ROW_ID,
      type: "item",
      srNo: "10",
      name: "Premium Mughal Girder Framing Structure",
      description: "Heavy duty steel columns & girder frames for long span loads",
      brand: "Mughal",
      unit: "Job",
      qty: 1,
      rate: 180000,
      total: 180000,
    });
  } else if (struct === "custom") {
    rows.push({
      id: STRUCTURE_JOB_ROW_ID,
      type: "item",
      srNo: "10",
      name: "Custom Mounting Structure",
      description: "Custom designed mounting rails and brackets based on site constraints",
      brand: "Custom",
      unit: "Job",
      qty: 1,
      rate: 0,
      total: 0,
    });
  } else {
    if (structure.l3 > 0) {
      rows.push({
        id: STRUCTURE_L3_ROW_ID,
        type: "item",
        ...structureKitRowFields("L3", structure.l3),
      });
    }
    if (structure.l2 > 0) {
      rows.push({
        id: STRUCTURE_L2_ROW_ID,
        type: "item",
        ...structureKitRowFields("L2", structure.l2),
      });
    }
  }

  rows.push({
    id: "civil_work_row",
    type: "item",
    srNo: "11",
    name: "Structure Pillars Foundations civil work",
    description: "Concrete pillar foundation blocks for load stability",
    brand: "Local",
    unit: "Job",
    qty: 1,
    rate: 16000,
    total: 16000,
  });

  let installRate = preset.installationCharges || 80000;
  if (!input.systemSizeKw) {
    installRate = 80000;
  }
  if (!preset.installationCharges) {
    installRate = 80000;
    if (sizekW > 15) installRate = 120000;
    if (sizekW >= 50) installRate = 200000;
    if (sizekW >= 100) installRate = 350000;
  }

  rows.push({
    id: "install_service_row",
    type: "item",
    srNo: "12",
    name: "Complete Installation & Commissioning Service",
    description: "Electrical wiring terminations, panel alignment, system tuning & start",
    brand: "Sunchaser",
    unit: "Job",
    qty: 1,
    rate: installRate,
    total: installRate,
  });
  rows.push(subtotal("s-6", "System Installation & Fabrication Subtotal"));

  rows.push(heading("h-7", "Transportation & Services"));
  rows.push({
    id: "freight_row",
    type: "item",
    srNo: "13",
    name: "Transportation, Logistics Freight & Manual Lifting",
    description: "Equipment loading, delivery to site and manual roof shifting logistics",
    brand: "Local",
    unit: "Job",
    qty: 1,
    rate: 10000,
    total: 10000,
  });

  if (netMeter === "Yes") {
    let nmRate = preset.netMeteringCharges || 90000;
    if (!preset.netMeteringCharges) {
      nmRate = 90000;
      if (sizekW >= 30) nmRate = 100000;
      if (sizekW >= 50) nmRate = 120000;
      if (sizekW >= 100) nmRate = 150000;
    }
    rows.push({
      id: "net_metering_row",
      type: "item",
      srNo: "14",
      name: "LESCO Net Metering Licensing Process",
      description: "Document processing, demand notice payments & green meter commission",
      brand: "LESCO",
      unit: "Job",
      qty: 1,
      rate: nmRate,
      total: nmRate,
    });
  }

  rows.push({
    id: "survey_design_row",
    type: "item",
    srNo: "15",
    name: "Survey, Designing, Testing & Project Management Suite",
    description: "Engineering site audit, CAD layouts, electrical simulations",
    brand: "Helios",
    unit: "Job",
    qty: 1,
    rate: 5000,
    total: 5000,
  });
  rows.push(subtotal("s-7", "Transportation & Services Subtotal"));

  const totaled = calculateBoqRowTotals(rows);
  const subtotalAmount = totaled.filter((r) => r.type === "item").reduce((sum, r) => sum + (Number(r.total) || 0), 0);

  return {
    rows: totaled,
    panelCount,
    structure,
    preset: {
      ...preset,
      systemKw: sizekW,
      systemType: sType,
      panel: { brand: pBrand, wattage: pWattage },
      inverter: { brand: iBrand, capacity: iCapacity, quantity: iQty },
      battery: { option: batt },
      structureType: struct === "girder" ? "standard" : struct === "custom" ? "standard" : struct,
      netMeteringRequired: netMeter,
    },
    subtotal: subtotalAmount,
  };
}

export function readStructureBreakdownFromRows(rows: BoqRow[] | null | undefined): StructureBreakdown | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const l3 = rows.find((r) => r.id === STRUCTURE_L3_ROW_ID);
  const l2 = rows.find((r) => r.id === STRUCTURE_L2_ROW_ID);
  if (!l3 && !l2) return null;
  const panel = rows.find((r) => r.id === "panel_row");
  const panelCount = Number(panel?.qty) || 0;
  return normalizeStructureBreakdown(panelCount, {
    l3: Number(l3?.qty) || 0,
    l2: Number(l2?.qty) || 0,
  });
}
