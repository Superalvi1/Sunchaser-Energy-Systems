import {
  BATTERY_ACCESSORY_CATALOG,
  BATTERY_CATALOG,
  inverterDisplayName,
  INVERTER_CATALOG,
  PANEL_CATALOG,
  standardStandPrice,
  type BatteryCatalogItem,
  type InverterCatalogItem,
  type PanelCatalogItem,
} from "./solarEquipmentCatalog";

export const PUBLIC_QUOTE_CAPACITIES = [6, 8, 10, 12, 15, 20] as const;
export type PublicQuoteCapacity = (typeof PUBLIC_QUOTE_CAPACITIES)[number];
export type PublicQuoteStructure = "standard-l2" | "standard-l3" | "elevated" | "mixed";
export type CableBrand = "Pakistan Cables" | "Industrial Innovative";
export type QuoteItemKey = "panels" | "inverter" | "battery" | "structure" | "civilPad" | "installation" | "acCable" | "dcCable" | "breakers" | "miscellaneous" | "earthingCable" | "earthingBore" | "lightningArrester" | "transport" | "survey";
export const QUOTE_ITEM_KEYS: readonly QuoteItemKey[] = ["panels", "inverter", "battery", "structure", "civilPad", "installation", "acCable", "dcCable", "breakers", "miscellaneous", "earthingCable", "earthingBore", "lightningArrester", "transport", "survey"];
export const QUOTE_ITEM_PRICES = { acCable: 300, dcCable: 275, earthingCable: 115, bore: 9_000, lightningArrester: 6_000, transport: 10_000, survey: 5_000, singlePhaseBreakers: 20_000, threePhaseBreakers: 25_000, miscellaneous: 10_000, civilPadPerLeg: 500 } as const;

export type PublicQuoteConfig = {
  systemCapacityKw: number;
  panelId: string;
  panelQuantity: number;
  inverterId: string;
  inverterQuantity: number;
  batteryId: string;
  batteryQuantity: number;
  batteryAccessoryIds: string[];
  structureType: PublicQuoteStructure;
  structurePanelQuantity: number;
  mixedL2StandQuantity: number;
  mixedL3StandQuantity: number;
  mixedElevatedPanelQuantity: number;
  included: Record<QuoteItemKey, boolean>;
  acCableBrand: CableBrand;
  acCableMeters: number;
  dcCableBrand: CableBrand;
  dcCableMeters: number;
  earthingCableMeters: number;
  earthingBoreCount: 1 | 2;
  wiringPhase: "single" | "three";
  transportationPkr: number;
  transportOutOfCity: boolean;
  discountPkr: number;
};

export type PublicQuoteLine = {
  category: "Equipment" | "Cables & protection" | "Structure" | "Services";
  description: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPricePkr: number;
  totalPkr: number;
};

export type PublicQuoteCalculation = {
  systemCapacityKw: PublicQuoteCapacity;
  configuredPanelCapacityKw: number;
  panel: PanelCatalogItem;
  inverter: InverterCatalogItem;
  battery: BatteryCatalogItem;
  structureLabel: string;
  configuredStructureCapacityPanels: number;
  lines: PublicQuoteLine[];
  subtotalPkr: number;
  discountPkr: number;
  totalPkr: number;
};

type FixedLine = Omit<PublicQuoteLine, "category"> & {
  category: "Cables & protection" | "Services";
};

type CapacityRule = {
  fixedLines: readonly FixedLine[];
  elevatedFixedLines?: readonly FixedLine[];
  standardFoundationPkr?: number;
};

const pricedLine = (
  category: FixedLine["category"],
  description: string,
  specification: string,
  quantity: number,
  unit: string,
  unitPricePkr: number,
): FixedLine => ({
  category,
  description,
  specification,
  quantity,
  unit,
  unitPricePkr,
  totalPkr: quantity * unitPricePkr,
});

/** Historical source BOQs, used here only for standard-structure foundation allowances. */
export const PUBLIC_QUOTE_CAPACITY_RULES: Readonly<Record<PublicQuoteCapacity, CapacityRule>> = {
  6: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated cable", 1, "job", 20_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 40, "meter", 250),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint; complete internal wiring", 1, "job", 15_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 10_000),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    standardFoundationPkr: 10_000,
  },
  8: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated Pakistan cable", 1, "job", 20_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 30, "meter", 300),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint 4P; complete internal wiring", 1, "job", 20_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 10_000),
      pricedLine("Cables & protection", "Complete system earthing", "Less than 5 ohms; copper electrode and lightning arrester", 1, "job", 37_000),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    standardFoundationPkr: 12_000,
  },
  10: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "LS/Innovative tin-coated cable", 1, "job", 20_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 30, "meter", 300),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint; complete internal wiring", 1, "job", 15_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 10_000),
      pricedLine("Cables & protection", "Panel and SPD earthing wire", "GM CU/PVC", 1, "job", 10_000),
      pricedLine("Cables & protection", "AC/DC earthing bore and materials", "Less than 5 ohms", 1, "job", 18_000),
      pricedLine("Cables & protection", "Copper lightning arrester", "Copper", 1, "pcs", 5_000),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    elevatedFixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "LS/Innovative tin-coated cable", 1, "job", 20_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 30, "meter", 300),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint; complete internal wiring", 1, "job", 15_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 10_000),
      pricedLine("Cables & protection", "Panel and SPD earthing wire", "GM CU/PVC", 1, "job", 10_000),
      pricedLine("Cables & protection", "AC/DC earthing bore and materials", "Less than 5 ohms", 1, "job", 18_000),
      pricedLine("Cables & protection", "Copper lightning arrester", "Copper", 1, "pcs", 6_000),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    standardFoundationPkr: 16_000,
  },
  12: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated Pakistan cable", 1, "job", 25_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 40, "meter", 250),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint; complete internal wiring", 1, "job", 18_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 13_000),
      pricedLine("Cables & protection", "Complete system earthing", "Less than 5 ohms; copper electrode and lightning arrester", 1, "job", 35_000),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
  },
  15: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated Pakistan cable", 1, "job", 25_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 30, "meter", 300),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint 4P; complete internal wiring", 1, "job", 20_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 10_000),
      pricedLine("Cables & protection", "Complete system earthing", "Less than 5 ohms; copper electrode and lightning arrester", 1, "job", 37_000),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
  },
  20: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated Pakistan cable", 1, "job", 40_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 70, "meter", 250),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint; complete internal wiring", 1, "job", 30_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 15_000),
      pricedLine("Cables & protection", "Complete system earthing", "Less than 5 ohms; copper electrode and lightning arrester", 1, "job", 40_000),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
  },
};

export class PublicQuoteConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicQuoteConfigurationError";
  }
}

const byId = <T extends { id: string }>(catalog: readonly T[], id: string, label: string): T => {
  const match = catalog.find((item) => item.id === id);
  if (!match) throw new PublicQuoteConfigurationError(`Please select a valid ${label}.`);
  return match;
};

export function publicQuoteInverters(capacityKw: number): InverterCatalogItem[] {
  void capacityKw;
  return [...INVERTER_CATALOG];
}

export function publicQuoteBatteries(capacityKw: number): BatteryCatalogItem[] {
  return BATTERY_CATALOG
    .filter((item) => !item.bundleOnly)
    .sort((a, b) => {
      const target = capacityKw <= 10 ? 5 : capacityKw <= 12 ? 10 : 16;
      return Math.abs(a.capacityKwh - target) - Math.abs(b.capacityKwh - target);
    });
}

export function recommendedPanelQuantity(capacityKw: number, panelWatts: number): number {
  return Math.ceil((capacityKw * 1_000) / panelWatts);
}

export type CivilPadBreakdown = {
  l2Stands: number;
  l3Stands: number;
  l2Legs: number;
  l3Legs: number;
  totalLegs: number;
  totalPkr: number;
};

export function calculateCivilPadBreakdown(
  config: Pick<PublicQuoteConfig, "structureType" | "structurePanelQuantity" | "mixedL2StandQuantity" | "mixedL3StandQuantity">,
): CivilPadBreakdown {
  let l2Stands = 0;
  let l3Stands = 0;

  if (config.structureType === "standard-l2") {
    l2Stands = Math.ceil(Math.max(0, config.structurePanelQuantity) / 2);
  } else if (config.structureType === "standard-l3") {
    l3Stands = Math.ceil(Math.max(0, config.structurePanelQuantity) / 3);
  } else if (config.structureType === "mixed") {
    l2Stands = Math.max(0, Math.floor(config.mixedL2StandQuantity));
    l3Stands = Math.max(0, Math.floor(config.mixedL3StandQuantity));
  }

  const l2Legs = l2Stands * 4;
  const l3Legs = l3Stands * 6;
  const totalLegs = l2Legs + l3Legs;
  return {
    l2Stands,
    l3Stands,
    l2Legs,
    l3Legs,
    totalLegs,
    totalPkr: totalLegs * QUOTE_ITEM_PRICES.civilPadPerLeg,
  };
}

export function defaultPublicQuoteConfig(capacityKw: PublicQuoteCapacity = 8): PublicQuoteConfig {
  const panel = PANEL_CATALOG.find((item) => item.id === "panel-aiko-abc-645") || PANEL_CATALOG[0];
  const inverter = publicQuoteInverters(capacityKw)[0];
  const battery = publicQuoteBatteries(capacityKw)[0];
  return {
    systemCapacityKw: capacityKw,
    panelId: panel.id,
    panelQuantity: recommendedPanelQuantity(capacityKw, panel.watts),
    inverterId: inverter.id,
    inverterQuantity: 1,
    batteryId: inverter.bundle?.batteryId || battery.id,
    batteryQuantity: 1,
    batteryAccessoryIds: [],
    structureType: "standard-l2",
    structurePanelQuantity: recommendedPanelQuantity(capacityKw, panel.watts),
    mixedL2StandQuantity: Math.ceil(recommendedPanelQuantity(capacityKw, panel.watts) / 2),
    mixedL3StandQuantity: 0,
    mixedElevatedPanelQuantity: 0,
    included: Object.fromEntries(QUOTE_ITEM_KEYS.map((key) => [key, true])) as Record<QuoteItemKey, boolean>,
    acCableBrand: "Pakistan Cables",
    acCableMeters: 30,
    dcCableBrand: "Pakistan Cables",
    dcCableMeters: 90,
    earthingCableMeters: 90,
    earthingBoreCount: 2,
    wiringPhase: inverter.phase === "three" ? "three" : "single",
    transportationPkr: QUOTE_ITEM_PRICES.transport,
    transportOutOfCity: false,
    discountPkr: 0,
  };
}

export function calculatePublicQuotation(config: PublicQuoteConfig, options: { allowDiscount?: boolean; allowCustomTransport?: boolean } = {}): PublicQuoteCalculation {
  if (!PUBLIC_QUOTE_CAPACITIES.includes(config.systemCapacityKw as PublicQuoteCapacity)) {
    throw new PublicQuoteConfigurationError(
      `No verified BOQ exists for ${config.systemCapacityKw} kW. Please contact Sunchaser for a manual specification.`,
    );
  }
  const capacity = config.systemCapacityKw as PublicQuoteCapacity;
  const rule = PUBLIC_QUOTE_CAPACITY_RULES[capacity];
  const panel = byId(PANEL_CATALOG, config.panelId, "solar panel");
  const inverter = byId(INVERTER_CATALOG, config.inverterId, "inverter");
  const included = config.included;
  if (
    !included ||
    QUOTE_ITEM_KEYS.some((key) =>
      key === "civilPad"
        ? included[key] !== undefined && typeof included[key] !== "boolean"
        : typeof included[key] !== "boolean",
    )
  ) throw new PublicQuoteConfigurationError("Please select valid quotation items.");
  const civilPadIncluded = included.civilPad === true;
  if (!Number.isInteger(config.panelQuantity) || config.panelQuantity < 1 || config.panelQuantity > 200) {
    throw new PublicQuoteConfigurationError("Panel quantity must be a whole number between 1 and 200.");
  }
  if (!Number.isInteger(config.inverterQuantity) || config.inverterQuantity < 1 || config.inverterQuantity > 10) {
    throw new PublicQuoteConfigurationError("Inverter quantity must be a whole number between 1 and 10.");
  }
  if (!Number.isInteger(config.batteryQuantity) || config.batteryQuantity < 1 || config.batteryQuantity > 20) {
    throw new PublicQuoteConfigurationError("Battery quantity must be a whole number between 1 and 20.");
  }
  const validateMeters = (enabled: boolean, value: number, label: string) => {
    if (enabled && (!Number.isInteger(value) || value < 1 || value > 10_000)) throw new PublicQuoteConfigurationError(`${label} must be between 1 and 10,000 meters.`);
  };
  validateMeters(included.acCable, config.acCableMeters, "AC cable length");
  validateMeters(included.dcCable, config.dcCableMeters, "DC cable length");
  validateMeters(included.earthingCable, config.earthingCableMeters, "Earthing cable length");
  if (included.acCable && !["Pakistan Cables", "Industrial Innovative"].includes(config.acCableBrand)) throw new PublicQuoteConfigurationError("Please choose a valid AC cable brand.");
  if (included.dcCable && !["Pakistan Cables", "Industrial Innovative"].includes(config.dcCableBrand)) throw new PublicQuoteConfigurationError("Please choose a valid DC cable brand.");
  if (included.earthingBore && config.earthingBoreCount !== 1 && config.earthingBoreCount !== 2) throw new PublicQuoteConfigurationError("Choose one or two earthing bores.");
  if (included.breakers && config.wiringPhase !== "single" && config.wiringPhase !== "three") throw new PublicQuoteConfigurationError("Choose single-phase or three-phase wiring.");
  if (included.transport && options.allowCustomTransport && config.transportOutOfCity && (!Number.isSafeInteger(config.transportationPkr) || config.transportationPkr < 0 || config.transportationPkr > 1_000_000)) throw new PublicQuoteConfigurationError("Transport must be between Rs. 0 and Rs. 1,000,000.");

  const bundledBattery = inverter.bundle
    ? byId(BATTERY_CATALOG, inverter.bundle.batteryId, "included battery")
    : null;
  if (bundledBattery && !included.inverter && included.battery) throw new PublicQuoteConfigurationError("The bundled FOX battery requires its inverter.");
  const battery = bundledBattery || byId(BATTERY_CATALOG, config.batteryId, "battery");
  if (!bundledBattery && !publicQuoteBatteries(capacity).some((item) => item.id === battery.id)) {
    throw new PublicQuoteConfigurationError("Please select a battery from the approved catalog.");
  }
  const batteryQuantity = bundledBattery ? config.inverterQuantity : config.batteryQuantity;

  const accessoryIds = Array.from(new Set(config.batteryAccessoryIds || []));
  const allowedAccessoryIds = battery.id === "battery-knox-hv-5"
    ? new Set(["battery-accessory-knox-hv-box-52ah", "battery-accessory-knox-base-wheel-52ah"])
    : battery.id === "battery-knox-hv-10"
      ? new Set(["battery-accessory-knox-hv-box-100ah", "battery-accessory-knox-base-wheel-100ah"])
      : new Set<string>();
  if (accessoryIds.some((id) => !allowedAccessoryIds.has(id))) {
    throw new PublicQuoteConfigurationError("The selected Knox HV accessories do not match the selected battery module.");
  }
  const batteryAccessories = accessoryIds.map((id) =>
    byId(BATTERY_ACCESSORY_CATALOG, id, "battery accessory"),
  );

  const panelUnitPrice = panel.watts * panel.pricePerWattPkr;
  const equipmentLines: PublicQuoteLine[] = ([
    {
      category: "Equipment",
      description: `${panel.brand} ${panel.watts}W solar panels`,
      specification: `${panel.model} · Rs. ${panel.pricePerWattPkr.toLocaleString("en-PK")}/W`,
      quantity: config.panelQuantity,
      unit: "pcs",
      unitPricePkr: panelUnitPrice,
      totalPkr: panelUnitPrice * config.panelQuantity,
    },
    {
      category: "Equipment",
      description: `${inverterDisplayName(inverter)} hybrid inverter`,
      specification: [inverter.phase === "three" ? "3-phase" : "single-phase", inverter.protection, inverter.voltageClass, inverter.bundle ? "battery bundle" : ""].filter(Boolean).join(" · "),
      quantity: config.inverterQuantity,
      unit: "pcs",
      unitPricePkr: inverter.pricePkr,
      totalPkr: inverter.pricePkr * config.inverterQuantity,
    },
    {
      category: "Equipment",
      description: `${battery.brand} ${battery.capacityKwh} kWh lithium battery`,
      specification: inverter.bundle ? "Included in FOX ESS inverter bundle" : [battery.model, battery.protection, battery.voltageClass].filter(Boolean).join(" · "),
      quantity: batteryQuantity,
      unit: "pcs",
      unitPricePkr: inverter.bundle ? 0 : battery.pricePkr,
      totalPkr: inverter.bundle ? 0 : battery.pricePkr * batteryQuantity,
    },
    ...batteryAccessories.map((accessory): PublicQuoteLine => ({
      category: "Equipment",
      description: `${accessory.brand} ${accessory.model}`,
      specification: accessory.accessoryType === "hv-box" ? "High-voltage battery control box" : "High-voltage battery base wheel",
      quantity: 1,
      unit: "pcs",
      unitPricePkr: accessory.pricePkr,
      totalPkr: accessory.pricePkr,
    })),
  ] as PublicQuoteLine[]).filter((line) => line.description.includes("solar panels") ? included.panels : line.description.includes("hybrid inverter") ? included.inverter : included.battery);

  const validateStructureQuantity = (value: number, label: string, max: number) => {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new PublicQuoteConfigurationError(`${label} must be a whole number between 0 and ${max}.`);
    }
  };
  validateStructureQuantity(config.structurePanelQuantity, "Structure panel capacity", 300);
  validateStructureQuantity(config.mixedL2StandQuantity, "L2 stand quantity", 150);
  validateStructureQuantity(config.mixedL3StandQuantity, "L3 stand quantity", 100);
  validateStructureQuantity(config.mixedElevatedPanelQuantity, "Elevated panel capacity", 300);

  let structureLabel = "";
  let configuredStructureCapacityPanels = config.structurePanelQuantity;
  const structureLines: PublicQuoteLine[] = [];
  if (!included.structure) {
    structureLabel = "Not included";
    configuredStructureCapacityPanels = 0;
  } else if (config.structureType === "elevated") {
    if (config.structurePanelQuantity < 1) throw new PublicQuoteConfigurationError("Elevated structure capacity must be at least 1 panel.");
    const total = config.structurePanelQuantity * panel.watts * 16;
    structureLabel = `Elevated structure for ${config.structurePanelQuantity} panels`;
    structureLines.push({
      category: "Structure",
      description: "Elevated structure (on-site fabrication)",
      specification: `${config.structurePanelQuantity} panels × ${panel.watts}W × Rs. 16/W`,
      quantity: config.structurePanelQuantity,
      unit: "panel capacity",
      unitPricePkr: panel.watts * 16,
      totalPkr: total,
    });
  } else if (config.structureType === "mixed") {
    configuredStructureCapacityPanels = config.mixedL2StandQuantity * 2 + config.mixedL3StandQuantity * 3 + config.mixedElevatedPanelQuantity;
    if (configuredStructureCapacityPanels < 1) throw new PublicQuoteConfigurationError("Mixed structure must include at least one stand or elevated panel.");
    structureLabel = `Mixed structure for ${configuredStructureCapacityPanels} panels`;
    if (config.mixedL2StandQuantity > 0) structureLines.push({
      category: "Structure", description: "L2 standard panel stands", specification: "2 panels per stand · Rs. 4,500 per stand",
      quantity: config.mixedL2StandQuantity, unit: "stands", unitPricePkr: 4_500, totalPkr: config.mixedL2StandQuantity * 4_500,
    });
    if (config.mixedL3StandQuantity > 0) structureLines.push({
      category: "Structure", description: "L3 standard panel stands", specification: "3 panels per stand · Rs. 7,200 per stand",
      quantity: config.mixedL3StandQuantity, unit: "stands", unitPricePkr: 7_200, totalPkr: config.mixedL3StandQuantity * 7_200,
    });
    if (config.mixedElevatedPanelQuantity > 0) structureLines.push({
      category: "Structure", description: "Elevated structure (on-site fabrication)", specification: `${config.mixedElevatedPanelQuantity} panels × ${panel.watts}W × Rs. 16/W`,
      quantity: config.mixedElevatedPanelQuantity, unit: "panel capacity", unitPricePkr: panel.watts * 16, totalPkr: config.mixedElevatedPanelQuantity * panel.watts * 16,
    });
  } else {
    if (config.structurePanelQuantity < 1) throw new PublicQuoteConfigurationError("Standard structure capacity must be at least 1 panel.");
    const standType = config.structureType === "standard-l3" ? "l3" : "l2";
    const stand = standardStandPrice(config.structurePanelQuantity, standType);
    structureLabel = `${standType.toUpperCase()} standard stands for ${config.structurePanelQuantity} panels`;
    structureLines.push({
      category: "Structure",
      description: `${standType.toUpperCase()} standard panel stands`,
      specification: `${standType === "l2" ? 2 : 3} panels per stand · rounded up for ${config.structurePanelQuantity}-panel capacity`,
      quantity: stand.standCount,
      unit: "stands",
      unitPricePkr: standType === "l2" ? 4_500 : 7_200,
      totalPkr: stand.totalPricePkr,
    });
  }
  const civilPad = calculateCivilPadBreakdown(config);
  const civilPadParts = [
    civilPad.l2Stands > 0 ? `${civilPad.l2Stands} L2 stand${civilPad.l2Stands === 1 ? "" : "s"} × 4 legs` : "",
    civilPad.l3Stands > 0 ? `${civilPad.l3Stands} L3 stand${civilPad.l3Stands === 1 ? "" : "s"} × 6 legs` : "",
  ].filter(Boolean);
  const civilPadLine: PublicQuoteLine[] =
    civilPadIncluded && included.structure && civilPad.totalLegs > 0
      ? [{
          category: "Structure",
          description: "Civil pads for structure legs",
          specification: `${civilPadParts.join(" + ")} × Rs. ${QUOTE_ITEM_PRICES.civilPadPerLeg.toLocaleString("en-PK")} per pad`,
          quantity: civilPad.totalLegs,
          unit: "pads",
          unitPricePkr: QUOTE_ITEM_PRICES.civilPadPerLeg,
          totalPkr: civilPad.totalPkr,
        }]
      : [];
  const cableLine = (description: string, specification: string, quantity: number, price: number): PublicQuoteLine => ({
    category: "Cables & protection", description, specification, quantity, unit: "meter", unitPricePkr: price, totalPkr: quantity * price,
  });
  const pricedItem = (category: PublicQuoteLine["category"], description: string, specification: string, quantity: number, unit: string, price: number): PublicQuoteLine => ({
    category, description, specification, quantity, unit, unitPricePkr: price, totalPkr: quantity * price,
  });
  const selectedLines: PublicQuoteLine[] = [
    ...(included.acCable ? [cableLine("AC cable", config.acCableBrand, config.acCableMeters, QUOTE_ITEM_PRICES.acCable)] : []),
    ...(included.dcCable ? [cableLine("DC solar cable", config.dcCableBrand, config.dcCableMeters, QUOTE_ITEM_PRICES.dcCable)] : []),
    ...(included.breakers ? [pricedItem("Cables & protection", `${config.wiringPhase === "three" ? "Three-phase" : "Single-phase"} breakers and protection`, "DB, breakers and protection", 1, "set", config.wiringPhase === "three" ? QUOTE_ITEM_PRICES.threePhaseBreakers : QUOTE_ITEM_PRICES.singlePhaseBreakers)] : []),
    ...(included.miscellaneous ? [pricedItem("Cables & protection", "Electrical miscellaneous", `${config.wiringPhase === "three" ? "Three-phase" : "Single-phase"} duct pipes, fittings and accessories`, 1, "job", QUOTE_ITEM_PRICES.miscellaneous)] : []),
    ...(included.earthingCable ? [cableLine("Earthing cable", "Panel and equipment earthing", config.earthingCableMeters, QUOTE_ITEM_PRICES.earthingCable)] : []),
    ...(included.earthingBore ? [pricedItem("Cables & protection", "Earthing bore", "Earthing bore and materials", config.earthingBoreCount, "bore", QUOTE_ITEM_PRICES.bore)] : []),
    ...(included.lightningArrester ? [pricedItem("Cables & protection", "Lightning arrester", "Copper lightning arrester", 1, "pcs", QUOTE_ITEM_PRICES.lightningArrester)] : []),
    ...(included.transport ? [pricedItem("Services", "Transportation", options.allowCustomTransport && config.transportOutOfCity ? "Out-of-city travel" : "Within-city travel", 1, "job", options.allowCustomTransport && config.transportOutOfCity ? config.transportationPkr : QUOTE_ITEM_PRICES.transport)] : []),
    ...(included.survey ? [pricedItem("Services", "Survey and design", "Survey and system design", 1, "job", QUOTE_ITEM_PRICES.survey)] : []),
  ];
  const installationLine: PublicQuoteLine = {
    category: "Services",
    description: "Installation and electrical wiring",
    specification: `${config.panelQuantity} panels × ${panel.watts}W × Rs. 4/W`,
    quantity: config.panelQuantity,
    unit: "panels",
    unitPricePkr: panel.watts * 4,
    totalPkr: config.panelQuantity * panel.watts * 4,
  };
  const lines = [...equipmentLines, ...selectedLines, ...structureLines, ...civilPadLine, ...(included.installation ? [installationLine] : [])];
  const subtotalPkr = lines.reduce((sum, item) => sum + item.totalPkr, 0);
  if (!Number.isSafeInteger(config.discountPkr) || config.discountPkr < 0) throw new PublicQuoteConfigurationError("Discount must be a positive whole rupee amount.");
  const discountPkr = options.allowDiscount ? config.discountPkr : 0;
  if (discountPkr > subtotalPkr) throw new PublicQuoteConfigurationError("Discount cannot exceed the quotation subtotal.");
  return {
    systemCapacityKw: capacity,
    configuredPanelCapacityKw: (panel.watts * config.panelQuantity) / 1_000,
    panel,
    inverter,
    battery,
    structureLabel,
    configuredStructureCapacityPanels,
    lines,
    subtotalPkr,
    discountPkr,
    totalPkr: subtotalPkr - discountPkr,
  };
}
