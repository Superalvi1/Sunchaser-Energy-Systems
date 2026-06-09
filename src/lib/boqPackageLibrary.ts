import type { BoqRow } from "../types";
import type { QuoteDiscountType } from "./quoteDiscount";

export const PACKAGE_SYSTEM_SIZES_KW = [3, 4, 6, 8, 10, 12, 15, 20, 25] as const;
export type PackageSystemSizeKw = (typeof PACKAGE_SYSTEM_SIZES_KW)[number];

export type BoqPackageStructureType = "standard" | "elevated";
export type BoqPackageEquipmentTier = "budgeted" | "premium";

export const PACKAGE_STRUCTURE_OPTIONS: { id: BoqPackageStructureType; label: string }[] = [
  { id: "standard", label: "Standard Structure" },
  { id: "elevated", label: "Elevated (Garder) Structure" },
];

export const PACKAGE_TIER_OPTIONS: { id: BoqPackageEquipmentTier; label: string }[] = [
  { id: "budgeted", label: "Budgeted" },
  { id: "premium", label: "Premium" },
];

export interface BoqPackageEquipmentSpec {
  systemSizeKw: number;
  structureType: BoqPackageStructureType;
  equipmentTier: BoqPackageEquipmentTier;
  systemType: "On-grid" | "Hybrid" | "Off-grid";
  panelBrand: string;
  panelWattage: number;
  inverterBrand: string;
  inverterCapacity: string;
  batteryOption: string;
  netMeteringRequired: "Yes" | "No";
  installationCharges: number;
  netMeteringCharges: number;
}

export interface BoqPackageRecord {
  id: string;
  name: string;
  systemSizeKw: number;
  structureType: BoqPackageStructureType;
  equipmentTier: BoqPackageEquipmentTier;
  systemType: "On-grid" | "Hybrid" | "Off-grid";
  panelBrand: string;
  panelWattage: number;
  inverterBrand: string;
  inverterCapacity: string;
  batteryOption: string;
  netMeteringRequired: "Yes" | "No";
  installationCharges: number;
  netMeteringCharges: number;
  boqRows: BoqRow[];
  price: number;
  profitMargin: number;
  discountType: QuoteDiscountType;
  discountValue: number;
  enabled: boolean;
  archived: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function structureTypeLabel(structure: BoqPackageStructureType): string {
  return structure === "elevated" ? "Elevated" : "Standard";
}

export function equipmentTierLabel(tier: BoqPackageEquipmentTier): string {
  return tier === "premium" ? "Premium" : "Budgeted";
}

export function buildPackageDisplayName(
  systemSizeKw: number,
  structureType: BoqPackageStructureType,
  equipmentTier: BoqPackageEquipmentTier
): string {
  return `${systemSizeKw}kW ${structureTypeLabel(structureType)} ${equipmentTierLabel(equipmentTier)}`;
}

export function buildPackageId(
  systemSizeKw: number,
  structureType: BoqPackageStructureType,
  equipmentTier: BoqPackageEquipmentTier
): string {
  return `pkg-${systemSizeKw}kw-${structureType}-${equipmentTier}`;
}

export function getPackageShortLabel(pkg: BoqPackageRecord): string {
  return `${structureTypeLabel(pkg.structureType)} ${equipmentTierLabel(pkg.equipmentTier)}`;
}

export function isLegacySolarPackage(pkg: any): boolean {
  if (!pkg || typeof pkg !== "object") return true;
  const id = String(pkg.id || "");
  if (/^sp-/i.test(id)) return true;
  const name = String(pkg.name || "");
  if (/Hybrid Solar System|On-grid Solar System/i.test(name)) return true;
  const rows = pkg.boqRows ?? pkg.boq_rows;
  if (!Array.isArray(rows) || rows.length === 0) return true;
  if (pkg.systemSizeKw == null && pkg.system_size_kw == null) return true;
  if (!pkg.equipmentTier && !pkg.equipment_tier) return true;
  return false;
}

export function isLoadableCatalogPackage(pkg: BoqPackageRecord): boolean {
  if (pkg.archived || !pkg.enabled) return false;
  if (!pkg.boqRows?.length) return false;
  if (!PACKAGE_SYSTEM_SIZES_KW.includes(pkg.systemSizeKw as PackageSystemSizeKw)) return false;
  if (pkg.structureType !== "standard" && pkg.structureType !== "elevated") return false;
  if (pkg.equipmentTier !== "budgeted" && pkg.equipmentTier !== "premium") return false;
  if (/^sp-/i.test(pkg.id)) return false;
  if (/Hybrid Solar System|On-grid Solar System/i.test(pkg.name)) return false;
  return true;
}

export function needsPackageLibraryMigration(packages: any[] | undefined, packageLibraryVersion?: number): boolean {
  if (!packages?.length) return true;
  if (Number(packageLibraryVersion || 0) < 2) return true;
  return packages.some(isLegacySolarPackage);
}

export function ensurePackageLibraryCatalog(
  packages: any[] | undefined,
  settings: Record<string, any> | undefined
): { packages: BoqPackageRecord[]; settings: Record<string, any>; migrated: boolean } {
  const nextSettings = { ...(settings || {}) };
  if (needsPackageLibraryMigration(packages, nextSettings.packageLibraryVersion)) {
    return {
      packages: buildDefaultPackageCatalog(),
      settings: { ...nextSettings, packageLibraryVersion: 2 },
      migrated: true,
    };
  }
  const normalized = (packages || [])
    .map((pkg) => normalizeSolarPackage(pkg))
    .filter((pkg): pkg is BoqPackageRecord => !!pkg);
  return { packages: normalized, settings: nextSettings, migrated: false };
}

export function normalizeSolarPackage(raw: any): BoqPackageRecord | null {
  if (!raw?.id) return null;
  if (isLegacySolarPackage(raw)) return null;
  const systemSizeKw = Number(raw.systemSizeKw ?? raw.system_size_kw ?? 0);
  const structureType = (raw.structureType || raw.structure_type || "standard").toString().toLowerCase();
  const equipmentTier = (raw.equipmentTier || raw.equipment_tier || "budgeted").toString().toLowerCase();
  const normalizedStructure: BoqPackageStructureType =
    structureType === "elevated" || structureType === "girder" ? "elevated" : "standard";
  const normalizedTier: BoqPackageEquipmentTier = equipmentTier === "premium" ? "premium" : "budgeted";

  if (!systemSizeKw) {
    const match = String(raw.name || raw.id || "").match(/(\d+)\s*kW/i);
    if (!match) return null;
  }

  const kw = systemSizeKw || Number(String(raw.name || "").match(/(\d+)\s*kW/i)?.[1] || 0);
  if (!kw) return null;

  const spec = resolvePackageEquipmentSpec(kw, normalizedStructure, normalizedTier);
  const boqRows = Array.isArray(raw.boqRows)
    ? raw.boqRows
    : Array.isArray(raw.boq_rows)
      ? raw.boq_rows
      : generatePackageBoqRows(spec);

  return {
    id: raw.id,
    name: raw.name || buildPackageDisplayName(kw, normalizedStructure, normalizedTier),
    systemSizeKw: kw,
    structureType: normalizedStructure,
    equipmentTier: normalizedTier,
    systemType: raw.systemType || spec.systemType,
    panelBrand: raw.panelBrand || raw.panel_brand || spec.panelBrand,
    panelWattage: Number(raw.panelWattage || raw.panel_wattage || spec.panelWattage),
    inverterBrand: raw.inverterBrand || raw.inverter_brand || spec.inverterBrand,
    inverterCapacity: raw.inverterCapacity || raw.inverter_capacity || spec.inverterCapacity,
    batteryOption: raw.batteryOption || raw.battery_option || spec.batteryOption,
    netMeteringRequired: raw.netMeteringRequired || spec.netMeteringRequired,
    installationCharges: Number(raw.installationCharges ?? spec.installationCharges),
    netMeteringCharges: Number(raw.netMeteringCharges ?? spec.netMeteringCharges),
    boqRows: calculateBoqRowTotals(boqRows),
    price: Number(raw.price || computePackageGrandTotal(boqRows)),
    profitMargin: Number(raw.profitMargin ?? raw.profit_margin ?? 0.25),
    discountType:
      String(raw.discountType || raw.discount_type || "fixed").toLowerCase() === "percentage"
        ? "percentage"
        : "fixed",
    discountValue: Number(raw.discountValue ?? raw.discount_value ?? 0),
    enabled: raw.enabled !== false,
    archived: !!raw.archived,
    createdAt: raw.createdAt || raw.created_at,
    updatedAt: raw.updatedAt || raw.updated_at,
  };
}

export function resolvePackageEquipmentSpec(
  systemSizeKw: number,
  structureType: BoqPackageStructureType,
  equipmentTier: BoqPackageEquipmentTier
): BoqPackageEquipmentSpec {
  const premium = equipmentTier === "premium";
  let systemType: BoqPackageEquipmentSpec["systemType"] = systemSizeKw >= 20 ? "On-grid" : "Hybrid";
  let panelBrand = premium ? "Canadian Solar" : "Jinko";
  let panelWattage = premium ? 580 : 580;
  let inverterBrand = premium ? "Goodwe" : "Knox";
  let inverterCapacity = `${systemSizeKw}kW`;
  let batteryOption = systemSizeKw >= 20 ? "None" : premium ? "Lithium Battery Pack 10.24kWh" : "Lithium Battery Pack 5.12kWh";
  let netMeteringRequired: "Yes" | "No" = systemSizeKw <= 3 ? "No" : "Yes";
  let installationCharges = 40000 + systemSizeKw * 3500;
  let netMeteringCharges = systemSizeKw >= 25 ? 95000 : systemSizeKw >= 20 ? 90000 : systemSizeKw <= 3 ? 0 : 90000;

  if (systemSizeKw === 3) {
    panelBrand = premium ? "Longi" : "Jinko";
    inverterBrand = premium ? "Knox" : "Solis";
    inverterCapacity = "3kW";
    batteryOption = premium ? "Lithium Battery Pack 5.12kWh" : "Lithium Battery Pack 5.12kWh";
    installationCharges = premium ? 45000 : 40000;
  } else if (systemSizeKw === 4) {
    inverterBrand = premium ? "Knox" : "Solis";
    inverterCapacity = "4kW";
    installationCharges = premium ? 48000 : 42000;
  } else if (systemSizeKw === 6) {
    inverterBrand = premium ? "Knox" : "Knox";
    inverterCapacity = "6kW";
    installationCharges = premium ? 55000 : 50000;
  } else if (systemSizeKw === 8) {
    batteryOption = premium ? "Lithium Battery Pack 10.24kWh" : "Lithium Battery Pack 5.12kWh";
    inverterCapacity = "8kW";
    installationCharges = premium ? 70000 : 65000;
  } else if (systemSizeKw === 10) {
    batteryOption = "Lithium Battery Pack 10.24kWh";
    installationCharges = premium ? 90000 : 80000;
  } else if (systemSizeKw === 12) {
    batteryOption = "Lithium Battery Pack 10.24kWh";
    installationCharges = premium ? 100000 : 90000;
  } else if (systemSizeKw === 15) {
    panelBrand = premium ? "Canadian Solar" : "JA Solar";
    panelWattage = premium ? 580 : 550;
    inverterBrand = premium ? "Goodwe" : "Solis";
    batteryOption = premium ? "Lithium Battery Pack 15.0kWh" : "Lithium Battery Pack 10.24kWh";
    installationCharges = premium ? 115000 : 100000;
    if (structureType === "elevated") installationCharges += 10000;
  } else if (systemSizeKw === 20) {
    panelBrand = premium ? "Canadian Solar" : "Canadian Solar";
    inverterBrand = premium ? "Goodwe" : "Goodwe";
    batteryOption = "None";
    installationCharges = premium ? 135000 : 120000;
  } else if (systemSizeKw === 25) {
    panelBrand = premium ? "Canadian Solar" : "Canadian Solar";
    inverterBrand = premium ? "Goodwe" : "Goodwe";
    batteryOption = "None";
    installationCharges = premium ? 145000 : 130000;
    netMeteringCharges = 95000;
  }

  if (structureType === "elevated" && systemSizeKw < 15) {
    installationCharges += 8000;
  }

  return {
    systemSizeKw,
    structureType,
    equipmentTier,
    systemType,
    panelBrand,
    panelWattage,
    inverterBrand,
    inverterCapacity,
    batteryOption,
    netMeteringRequired,
    installationCharges,
    netMeteringCharges,
  };
}

export function calculateBoqRowTotals(rows: BoqRow[]): BoqRow[] {
  const updated = rows.map((r) => ({ ...r }));
  let currentSubtotal = 0;
  for (let i = 0; i < updated.length; i++) {
    const row = updated[i];
    if (row.type === "item") {
      const qty = Number(row.qty) || 0;
      const rate = Number(row.rate) || 0;
      row.total = qty * rate;
      currentSubtotal += row.total;
    } else if (row.type === "subtotal") {
      row.total = currentSubtotal;
      currentSubtotal = 0;
    }
  }
  return updated;
}

export function computePackageGrandTotal(rows: BoqRow[]): number {
  return rows.filter((r) => r.type === "item").reduce((sum, r) => sum + (Number(r.total) || 0), 0);
}

function structLabelForBoq(structureType: BoqPackageStructureType): string {
  return structureType === "elevated" ? "Elevated" : "Standard";
}

export function generatePackageBoqRows(spec: BoqPackageEquipmentSpec): BoqRow[] {
  const {
    systemSizeKw: sizekW,
    structureType,
    equipmentTier,
    systemType: sType,
    panelBrand: pBrand,
    panelWattage: pWattage,
    inverterBrand: iBrand,
    inverterCapacity: iCapacity,
    batteryOption: batt,
    netMeteringRequired: netMeter,
    installationCharges,
    netMeteringCharges,
  } = spec;

  const premium = equipmentTier === "premium";
  const struct = structLabelForBoq(structureType);
  const panelCount = Math.ceil((sizekW * 1000) / pWattage);
  const rows: BoqRow[] = [];

  rows.push({ id: "h-1", type: "heading", name: "Imported Equipment", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  let panelRate = premium ? 24500 : 21000;
  if (pBrand === "Longi") panelRate = premium ? 27500 : 25215;
  else if (pBrand === "Canadian Solar") panelRate = premium ? 26500 : 23000;
  else if (pBrand === "JA Solar") panelRate = premium ? 22000 : 19500;

  rows.push({
    id: "panel_row",
    type: "item",
    srNo: "1",
    name: `${pBrand} ${pWattage}W Mono-PERC Solar Panels`,
    description: premium ? "Premium tier-1 high efficiency solar modules" : "Tier-1 high efficiency solar modules",
    brand: pBrand,
    unit: "Pcs",
    qty: panelCount,
    rate: panelRate,
    total: panelCount * panelRate,
  });

  let inverterRate = premium ? 480000 : 400000;
  if (sizekW > 15) inverterRate = premium ? 520000 : 420000;
  if (sizekW > 25) inverterRate = premium ? 720000 : 580000;

  rows.push({
    id: "inverter_row",
    type: "item",
    srNo: "2",
    name: `${iBrand} ${iCapacity} Smart Sync Inverter`,
    description: premium ? "Premium intelligent energy management inverter" : "Intelligent energy management inverter",
    brand: iBrand,
    unit: "Pcs",
    qty: 1,
    rate: inverterRate,
    total: inverterRate,
  });

  if (sType !== "On-grid" && batt !== "None") {
    let batteryRate = premium ? 280000 : 235000;
    if (batt.includes("10.24")) batteryRate = premium ? 540000 : 480000;
    if (batt.includes("15.0")) batteryRate = premium ? 780000 : 690000;

    rows.push({
      id: "battery_row",
      type: "item",
      srNo: "3",
      name: batt,
      description: "Lithium iron phosphate (LiFePO4) storage batteries",
      brand: premium ? "Sunchaser Core" : "Soluna",
      unit: "Pcs",
      qty: 1,
      rate: batteryRate,
      total: batteryRate,
    });
  }

  rows.push({ id: "s-1", type: "subtotal", name: "Imported Equipment Subtotal", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({ id: "h-2", type: "heading", name: "Cables & Conductors", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  const dcQty = Math.round(sizekW * 15 + 40);
  const cableRate = premium ? 320 : 280;
  rows.push({
    id: "dc_cable_row",
    type: "item",
    srNo: "4",
    name: "DC Solar Cable 6mm",
    description: "Double Insulated Tin Coated DC Solar Cable",
    brand: premium ? "LAPP/FAST" : "GM/FAST",
    unit: "Meter",
    qty: dcQty,
    rate: cableRate,
    total: dcQty * cableRate,
  });

  rows.push({
    id: "ac_cable_row",
    type: "item",
    srNo: "5",
    name: "AC Connecting Cable 4-Core",
    description: "AC copper flexible connection cable job",
    brand: premium ? "LAPP/FAST" : "GM/FAST",
    unit: "Meter",
    qty: 40,
    rate: premium ? 300 : 250,
    total: 40 * (premium ? 300 : 250),
  });

  rows.push({
    id: "earth_wire_row",
    type: "item",
    srNo: "6",
    name: "Earthing Bare Copper Wire",
    description: "Bare copper conductor for system grounding",
    brand: premium ? "LAPP/FAST" : "GM/FAST",
    unit: "Meter",
    qty: 50,
    rate: premium ? 420 : 380,
    total: 50 * (premium ? 420 : 380),
  });

  rows.push({ id: "s-2", type: "subtotal", name: "Cables & Conductors Subtotal", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({ id: "h-3", type: "heading", name: "DB Boxes & Breakers", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({
    id: "db_box_row",
    type: "item",
    srNo: "7",
    name: "AC/DC Distribution DB Box Equipped",
    description: "Miniature Circuit Breakers, SPDs, GADA/Chint switches",
    brand: premium ? "Schneider/Chint" : "GADA/Chint",
    unit: "Job",
    qty: 1,
    rate: premium ? 42000 : 32000,
    total: premium ? 42000 : 32000,
  });

  rows.push({ id: "s-3", type: "subtotal", name: "DB Boxes & Breakers Subtotal", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({ id: "h-4", type: "heading", name: "Electrical & Mechanical Supplies", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({
    id: "supplies_row",
    type: "item",
    srNo: "8",
    name: "PVC Pipes, Ducts & Conduits Job",
    description: "Pipes, elbows, joints, PVC trunks/ducts for clean wiring routing",
    brand: premium ? "Beta/Premium" : "Beta/Eq",
    unit: "Job",
    qty: 1,
    rate: premium ? 24000 : 18000,
    total: premium ? 24000 : 18000,
  });

  rows.push({ id: "s-4", type: "subtotal", name: "Supplies Subtotal", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({ id: "h-5", type: "heading", name: "System Earthing Works", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

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
    rate: premium ? 52000 : 48000,
    total: boreQty * (premium ? 52000 : 48000),
  });

  rows.push({ id: "s-5", type: "subtotal", name: "System Earthing Works Subtotal", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({ id: "h-6", type: "heading", name: "System Installation & Fabrication", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  if (struct === "Elevated") {
    rows.push({
      id: "structure_row",
      type: "item",
      srNo: "10",
      name: "Elevated (Garder) Mechanical Mounting Structure",
      description: "Hot-Dip Galvanized C-Channel / H-Beam steel fabrication (10ft clearance)",
      brand: "Mughal",
      unit: "Job",
      qty: 1,
      rate: premium ? 175000 : 147600,
      total: premium ? 175000 : 147600,
    });
  } else {
    rows.push({
      id: "structure_row",
      type: "item",
      srNo: "10",
      name: "Standard Galvanized L3 14 Gauge Structure",
      description: "Galvanized iron mounting structure with Rawal bolts",
      brand: "Mughal",
      unit: "Pcs",
      qty: panelCount,
      rate: premium ? 5600 : 4800,
      total: panelCount * (premium ? 5600 : 4800),
    });
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
    rate: premium ? 20000 : 16000,
    total: premium ? 20000 : 16000,
  });

  rows.push({
    id: "install_service_row",
    type: "item",
    srNo: "12",
    name: "Complete Installation & Commissioning Service",
    description: "Electrical wiring terminations, panel alignment, system tuning & start",
    brand: "Sunchaser",
    unit: "Job",
    qty: 1,
    rate: installationCharges,
    total: installationCharges,
  });

  rows.push({ id: "s-6", type: "subtotal", name: "System Installation & Fabrication Subtotal", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({ id: "h-7", type: "heading", name: "Transportation & Services", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  rows.push({
    id: "freight_row",
    type: "item",
    srNo: "13",
    name: "Transportation, Logistics Freight & Manual Lifting",
    description: "Equipment loading, delivery to site and manual roof shifting logistics",
    brand: "Local",
    unit: "Job",
    qty: 1,
    rate: premium ? 14000 : 10000,
    total: premium ? 14000 : 10000,
  });

  if (netMeter === "Yes") {
    rows.push({
      id: "net_metering_row",
      type: "item",
      srNo: "14",
      name: "LESCO Net Metering Licensing Process",
      description: "Document processing, demand notice payments & green meter commission",
      brand: "LESCO",
      unit: "Job",
      qty: 1,
      rate: netMeteringCharges,
      total: netMeteringCharges,
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
    rate: premium ? 8000 : 5000,
    total: premium ? 8000 : 5000,
  });

  rows.push({ id: "s-7", type: "subtotal", name: "Transportation & Services Subtotal", description: "", brand: "", unit: "", qty: 0, rate: 0, total: 0 });

  return calculateBoqRowTotals(rows);
}

export function buildBoqPackageRecord(
  systemSizeKw: number,
  structureType: BoqPackageStructureType,
  equipmentTier: BoqPackageEquipmentTier,
  overrides?: Partial<BoqPackageRecord>
): BoqPackageRecord {
  const spec = resolvePackageEquipmentSpec(systemSizeKw, structureType, equipmentTier);
  const boqRows = overrides?.boqRows?.length
    ? calculateBoqRowTotals(overrides.boqRows)
    : generatePackageBoqRows(spec);
  const now = new Date().toISOString();

  return {
    id: overrides?.id || buildPackageId(systemSizeKw, structureType, equipmentTier),
    name: buildPackageDisplayName(systemSizeKw, structureType, equipmentTier),
    systemSizeKw,
    structureType,
    equipmentTier,
    systemType: overrides?.systemType || spec.systemType,
    panelBrand: overrides?.panelBrand || spec.panelBrand,
    panelWattage: overrides?.panelWattage || spec.panelWattage,
    inverterBrand: overrides?.inverterBrand || spec.inverterBrand,
    inverterCapacity: overrides?.inverterCapacity || spec.inverterCapacity,
    batteryOption: overrides?.batteryOption || spec.batteryOption,
    netMeteringRequired: overrides?.netMeteringRequired || spec.netMeteringRequired,
    installationCharges: overrides?.installationCharges ?? spec.installationCharges,
    netMeteringCharges: overrides?.netMeteringCharges ?? spec.netMeteringCharges,
    boqRows,
    price: overrides?.price ?? computePackageGrandTotal(boqRows),
    profitMargin: overrides?.profitMargin ?? (equipmentTier === "premium" ? 0.3 : 0.25),
    discountType: overrides?.discountType ?? "fixed",
    discountValue: overrides?.discountValue ?? 0,
    enabled: overrides?.enabled !== false,
    archived: !!overrides?.archived,
    createdAt: overrides?.createdAt || now,
    updatedAt: now,
  };
}

export function buildDefaultPackageCatalog(): BoqPackageRecord[] {
  const catalog: BoqPackageRecord[] = [];
  for (const kw of PACKAGE_SYSTEM_SIZES_KW) {
    for (const structure of PACKAGE_STRUCTURE_OPTIONS) {
      for (const tier of PACKAGE_TIER_OPTIONS) {
        catalog.push(buildBoqPackageRecord(kw, structure.id, tier.id));
      }
    }
  }
  return catalog;
}

export function cloneBoqRowsForLoad(rows: BoqRow[]): BoqRow[] {
  const stamp = Date.now();
  return rows.map((row, index) => ({
    ...row,
    id: row.id.startsWith("h-")
      ? `row-heading-${stamp}-${index}`
      : row.id.startsWith("s-")
        ? `row-subtotal-${stamp}-${index}`
        : `row-item-${stamp}-${index}`,
  }));
}

export function groupActivePackagesBySize(
  packages: BoqPackageRecord[],
  options?: { includeArchived?: boolean }
): Map<number, BoqPackageRecord[]> {
  const map = new Map<number, BoqPackageRecord[]>();
  for (const kw of PACKAGE_SYSTEM_SIZES_KW) {
    map.set(kw, []);
  }
  for (const raw of packages || []) {
    const pkg = normalizeSolarPackage(raw);
    if (!pkg) continue;
    if (!options?.includeArchived && pkg.archived) continue;
    if (!pkg.enabled) continue;
    const list = map.get(pkg.systemSizeKw as PackageSystemSizeKw) || [];
    list.push(pkg);
    map.set(pkg.systemSizeKw, list);
  }
  for (const [kw, list] of map) {
    list.sort((a, b) => {
      const structOrder = a.structureType === b.structureType ? 0 : a.structureType === "standard" ? -1 : 1;
      if (structOrder !== 0) return structOrder;
      return a.equipmentTier === "budgeted" ? -1 : 1;
    });
    map.set(kw, list);
  }
  return map;
}

export type BoqPackageFilterOptions = {
  search?: string;
  systemSizeKw?: number | "all";
  structureType?: BoqPackageStructureType | "all";
  equipmentTier?: BoqPackageEquipmentTier | "all";
  includeArchived?: boolean;
  includeDisabled?: boolean;
};

export function filterBoqPackages(
  packages: BoqPackageRecord[],
  options: BoqPackageFilterOptions = {}
): BoqPackageRecord[] {
  const query = (options.search || "").trim().toLowerCase();
  return packages.filter((pkg) => {
    if (!options.includeArchived && pkg.archived) return false;
    if (!options.includeDisabled && !pkg.enabled) return false;
    if (options.systemSizeKw && options.systemSizeKw !== "all" && pkg.systemSizeKw !== options.systemSizeKw) {
      return false;
    }
    if (options.structureType && options.structureType !== "all" && pkg.structureType !== options.structureType) {
      return false;
    }
    if (options.equipmentTier && options.equipmentTier !== "all" && pkg.equipmentTier !== options.equipmentTier) {
      return false;
    }
    if (query) {
      const haystack = [
        pkg.name,
        pkg.panelBrand,
        pkg.inverterBrand,
        pkg.batteryOption,
        getPackageShortLabel(pkg),
        `${pkg.systemSizeKw}kw`,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function duplicateBoqPackage(pkg: BoqPackageRecord): BoqPackageRecord {
  const stamp = Date.now();
  return {
    ...pkg,
    id: `${pkg.id}-copy-${stamp}`,
    name: `${pkg.name} (Copy)`,
    boqRows: pkg.boqRows.map((row) => ({ ...row })),
    archived: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function serializePackageBoqSnapshot(
  rows: BoqRow[],
  discountType: QuoteDiscountType,
  discountValue: number
): string {
  const normalized = (rows || []).map((row) => ({
    type: row.type,
    name: row.name,
    description: row.description,
    brand: row.brand,
    unit: row.unit,
    qty: Number(row.qty) || 0,
    rate: Number(row.rate) || 0,
  }));
  return JSON.stringify({ rows: normalized, discountType, discountValue: Number(discountValue) || 0 });
}

export function buildPackageBoqRowsForSave(rows: BoqRow[]): BoqRow[] {
  const stamped = (rows || []).map((row, index) => ({
    ...row,
    id: row.id || `pkg-row-${index}`,
  }));
  return calculateBoqRowTotals(stamped);
}

export function buildPackageRecordFromBoqState(
  base: BoqPackageRecord,
  rows: BoqRow[],
  options: {
    discountType: QuoteDiscountType;
    discountValue: number;
    panelBrand?: string;
    panelWattage?: number;
    inverterBrand?: string;
    inverterCapacity?: string;
    batteryOption?: string;
    netMeteringRequired?: "Yes" | "No";
    installationCharges?: number;
    netMeteringCharges?: number;
    systemType?: BoqPackageRecord["systemType"];
  }
): BoqPackageRecord {
  const boqRows = buildPackageBoqRowsForSave(rows);
  return {
    ...base,
    systemType: options.systemType ?? base.systemType,
    panelBrand: options.panelBrand ?? base.panelBrand,
    panelWattage: Number(options.panelWattage ?? base.panelWattage),
    inverterBrand: options.inverterBrand ?? base.inverterBrand,
    inverterCapacity: options.inverterCapacity ?? base.inverterCapacity,
    batteryOption: options.batteryOption ?? base.batteryOption,
    netMeteringRequired: options.netMeteringRequired ?? base.netMeteringRequired,
    installationCharges: Number(options.installationCharges ?? base.installationCharges),
    netMeteringCharges: Number(options.netMeteringCharges ?? base.netMeteringCharges),
    boqRows,
    price: computePackageGrandTotal(boqRows),
    discountType: options.discountType,
    discountValue: Number(options.discountValue) || 0,
    updatedAt: new Date().toISOString(),
  };
}

export function buildNewPackageFromBoqState(
  rows: BoqRow[],
  meta: {
    name: string;
    systemSizeKw: number;
    structureType: BoqPackageStructureType;
    equipmentTier: BoqPackageEquipmentTier;
    discountType: QuoteDiscountType;
    discountValue: number;
    panelBrand: string;
    panelWattage: number;
    inverterBrand: string;
    inverterCapacity: string;
    batteryOption: string;
    netMeteringRequired: "Yes" | "No";
    installationCharges: number;
    netMeteringCharges: number;
    systemType: BoqPackageRecord["systemType"];
  },
  id?: string
): BoqPackageRecord {
  const boqRows = buildPackageBoqRowsForSave(rows);
  const packageId = id || `pkg-custom-${Date.now()}`;
  return buildBoqPackageRecord(meta.systemSizeKw, meta.structureType, meta.equipmentTier, {
    id: packageId,
    name: meta.name.trim() || buildPackageDisplayName(meta.systemSizeKw, meta.structureType, meta.equipmentTier),
    systemType: meta.systemType,
    panelBrand: meta.panelBrand,
    panelWattage: meta.panelWattage,
    inverterBrand: meta.inverterBrand,
    inverterCapacity: meta.inverterCapacity,
    batteryOption: meta.batteryOption,
    netMeteringRequired: meta.netMeteringRequired,
    installationCharges: meta.installationCharges,
    netMeteringCharges: meta.netMeteringCharges,
    boqRows,
    price: computePackageGrandTotal(boqRows),
    discountType: meta.discountType,
    discountValue: meta.discountValue,
    enabled: true,
    archived: false,
  });
}
