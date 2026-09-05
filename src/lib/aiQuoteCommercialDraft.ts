/**
 * Deterministic AI Quote Builder draft — BOQ snapshot only.
 * Apply never writes CRM and never sends messages.
 */

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
  positiveFinite,
  recommendedPanelQuantity,
} from "./quoteCommercialMath";
import { normalizeIdentityKey } from "./websiteCatalog/normalize";
import {
  STRUCTURE_L2_ROW_ID,
  STRUCTURE_L3_ROW_ID,
  recommendStructures,
  structureKitRowFields,
} from "./autoSizer/structureRecommendation";
import { liveCatalogProductId } from "./autoSizer/companyPresets";
import { liftWebsiteSourceFields } from "./websiteCatalog/normalize";

export type QuoteStructureKind = "standard" | "elevated" | "girder" | "custom";
export type QuoteSystemType = "On-grid" | "Hybrid" | "Off-grid";

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
  installationRatePerWatt: number;
  elevatedStructureRatePerWatt: number;
  girderAmount: number;
  customStructureName: string;
  customStructureDescription: string;
  customStructureAmount: number;
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

function item(partial: Omit<BoqRow, "type" | "description" | "brand" | "unit"> & Partial<BoqRow>): BoqRow {
  return {
    type: "item",
    description: "",
    brand: "",
    unit: "Pcs",
    ...partial,
  };
}

export function defaultBatteryEnabled(systemType: QuoteSystemType): boolean {
  return systemType !== "On-grid";
}

export function validateCommercialQuoteConfig(config: CommercialQuoteConfig): string[] {
  const errors: string[] = [];
  if (positiveFinite(config.systemSizeKw) == null) errors.push("System size must be greater than 0 kW.");
  if (positiveFinite(config.panelWattage) == null) errors.push("Panel wattage must be greater than 0.");
  if (positiveFinite(config.panelQuantity) == null) errors.push("Panel quantity must be greater than 0.");
  if (nonNegativeFinite(config.panelRatePerWatt) == null) errors.push("Panel PKR/W cannot be negative.");
  if (nonNegativeFinite(config.installationRatePerWatt) == null) errors.push("Installation PKR/W cannot be negative.");
  if (nonNegativeFinite(config.elevatedStructureRatePerWatt) == null) errors.push("Elevated structure PKR/W cannot be negative.");
  if (positiveFinite(config.inverterQuantity) == null) errors.push("Inverter quantity must be greater than 0.");
  if (nonNegativeFinite(config.inverterUnitPrice) == null) errors.push("Inverter unit price cannot be negative.");
  if (config.batteryEnabled && config.systemType !== "On-grid") {
    if (positiveFinite(config.batteryQuantity) == null) errors.push("Battery quantity must be greater than 0.");
    if (nonNegativeFinite(config.batteryUnitPrice) == null) errors.push("Battery unit price cannot be negative.");
  }
  if (config.structureType === "girder" && nonNegativeFinite(config.girderAmount) == null) {
    errors.push("Girder amount cannot be negative.");
  }
  if (config.structureType === "custom" && nonNegativeFinite(config.customStructureAmount) == null) {
    errors.push("Custom structure amount cannot be negative.");
  }
  return errors;
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
  rows.push({
    id: "ai-s-equipment",
    type: "subtotal",
    name: "Imported Equipment Subtotal",
    description: "",
    brand: "",
    unit: "",
    qty: 0,
    rate: 0,
    total: equipmentTotal,
  });

  rows.push({
    id: "ai-h-install",
    type: "heading",
    name: "Installation & Structure",
    description: "AI Quote Builder draft section",
    brand: "",
    unit: "",
    qty: 0,
    rate: 0,
    total: 0,
  });

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

  const structure = recommendStructures(qty);
  if (config.structureType === "standard") {
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

  const installSectionTotal = rows
    .filter((r) => r.type === "item" && (r.id === "install_service_row" || r.id === "structure_row" || r.id === STRUCTURE_L3_ROW_ID || r.id === STRUCTURE_L2_ROW_ID))
    .reduce((s, r) => s + (Number(r.total) || 0), 0);
  rows.push({
    id: "ai-s-install",
    type: "subtotal",
    name: "Installation & Structure Subtotal",
    description: "",
    brand: "",
    unit: "",
    qty: 0,
    rate: 0,
    total: installSectionTotal,
  });

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

export { recommendedPanelQuantity, DEFAULT_INSTALLATION_RATE_PER_WATT, DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT, DEFAULT_GIRDER_STRUCTURE_AMOUNT };
