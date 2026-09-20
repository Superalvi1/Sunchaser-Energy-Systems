import {
  BATTERY_CATALOG,
  INVERTER_CATALOG,
  PANEL_CATALOG,
  standardStandPrice,
  type BatteryCatalogItem,
  type InverterCatalogItem,
  type PanelCatalogItem,
} from "./solarEquipmentCatalog";

export const PUBLIC_QUOTE_CAPACITIES = [6, 8, 10, 12, 15, 20] as const;
export type PublicQuoteCapacity = (typeof PUBLIC_QUOTE_CAPACITIES)[number];
export type PublicQuoteStructure = "standard-l2" | "standard-l3" | "elevated";

export type PublicQuoteConfig = {
  systemCapacityKw: number;
  panelId: string;
  panelQuantity: number;
  inverterId: string;
  batteryId: string;
  structureType: PublicQuoteStructure;
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
  lines: PublicQuoteLine[];
  totalPkr: number;
};

type FixedLine = Omit<PublicQuoteLine, "category"> & {
  category: "Cables & protection" | "Services";
};

type CapacityRule = {
  fixedLines: readonly FixedLine[];
  elevatedFixedLines?: readonly FixedLine[];
  elevatedStructurePkr: number;
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

/** Exact fixed-cost rules transcribed from the supplied capacity-specific BOQs. */
export const PUBLIC_QUOTE_CAPACITY_RULES: Readonly<Record<PublicQuoteCapacity, CapacityRule>> = {
  6: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated cable", 1, "job", 20_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 40, "meter", 250),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint; complete internal wiring", 1, "job", 15_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 10_000),
      pricedLine("Services", "Installation and electrical wiring", "Complete installation", 1, "job", 25_800),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    elevatedStructurePkr: 112_700,
    standardFoundationPkr: 10_000,
  },
  8: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated Pakistan cable", 1, "job", 20_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 30, "meter", 300),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint 4P; complete internal wiring", 1, "job", 20_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 10_000),
      pricedLine("Cables & protection", "Complete system earthing", "Less than 5 ohms; copper electrode and lightning arrester", 1, "job", 37_000),
      pricedLine("Services", "Installation and electrical wiring", "Complete installation", 1, "job", 27_720),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    elevatedStructurePkr: 184_040,
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
      pricedLine("Services", "Installation and electrical wiring", "Complete installation", 1, "job", 41_280),
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
      pricedLine("Services", "Installation and electrical wiring", "Complete installation", 1, "job", 30_960),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    elevatedStructurePkr: 173_120,
    standardFoundationPkr: 16_000,
  },
  12: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated Pakistan cable", 1, "job", 25_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 40, "meter", 250),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint; complete internal wiring", 1, "job", 18_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 13_000),
      pricedLine("Cables & protection", "Complete system earthing", "Less than 5 ohms; copper electrode and lightning arrester", 1, "job", 35_000),
      pricedLine("Services", "Installation and electrical wiring", "Complete installation", 1, "job", 49_020),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    elevatedStructurePkr: 207_280,
  },
  15: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated Pakistan cable", 1, "job", 25_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 30, "meter", 300),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint 4P; complete internal wiring", 1, "job", 20_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 10_000),
      pricedLine("Cables & protection", "Complete system earthing", "Less than 5 ohms; copper electrode and lightning arrester", 1, "job", 37_000),
      pricedLine("Services", "Installation and electrical wiring", "Complete installation", 1, "job", 46_440),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    elevatedStructurePkr: 206_320,
  },
  20: {
    fixedLines: [
      pricedLine("Cables & protection", "4 sq.mm fire-proof solar cable", "Tin-coated Pakistan cable", 1, "job", 40_000),
      pricedLine("Cables & protection", "6 sq.mm PVC/PVC solar cable", "GM/FAST or equivalent", 70, "meter", 250),
      pricedLine("Cables & protection", "DB boxes, breakers, SPDs and RCCB", "GADA/Chint; complete internal wiring", 1, "job", 30_000),
      pricedLine("Cables & protection", "Electrical and mechanical accessories", "PVC fittings, connectors, clamps, lugs and fasteners", 1, "job", 15_000),
      pricedLine("Cables & protection", "Complete system earthing", "Less than 5 ohms; copper electrode and lightning arrester", 1, "job", 40_000),
      pricedLine("Services", "Installation and electrical wiring", "Complete installation", 1, "job", 82_560),
      pricedLine("Services", "Transportation", "Within standard service area", 1, "job", 10_000),
      pricedLine("Services", "Survey, design, testing and commissioning", "Project management", 1, "job", 5_000),
    ],
    elevatedStructurePkr: 348_240,
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
  const allowed = capacityKw === 15 ? new Set([15, 16]) : new Set([capacityKw]);
  return INVERTER_CATALOG.filter((item) => allowed.has(item.capacityKw));
}

export function publicQuoteBatteries(capacityKw: number): BatteryCatalogItem[] {
  const capacities = capacityKw <= 10 ? new Set([5, 10, 16]) : capacityKw <= 12 ? new Set([10, 16]) : new Set([16]);
  return BATTERY_CATALOG.filter((item) => !item.bundleOnly && capacities.has(item.capacityKwh));
}

export function recommendedPanelQuantity(capacityKw: number, panelWatts: number): number {
  return Math.ceil((capacityKw * 1_000) / panelWatts);
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
    batteryId: inverter.bundle?.batteryId || battery.id,
    structureType: "standard-l2",
  };
}

export function calculatePublicQuotation(config: PublicQuoteConfig): PublicQuoteCalculation {
  if (!PUBLIC_QUOTE_CAPACITIES.includes(config.systemCapacityKw as PublicQuoteCapacity)) {
    throw new PublicQuoteConfigurationError(
      `No verified BOQ exists for ${config.systemCapacityKw} kW. Please contact Sunchaser for a manual specification.`,
    );
  }
  const capacity = config.systemCapacityKw as PublicQuoteCapacity;
  const rule = PUBLIC_QUOTE_CAPACITY_RULES[capacity];
  const panel = byId(PANEL_CATALOG, config.panelId, "solar panel");
  const inverter = byId(INVERTER_CATALOG, config.inverterId, "inverter");
  const allowedInverters = publicQuoteInverters(capacity);
  if (!allowedInverters.some((item) => item.id === inverter.id)) {
    throw new PublicQuoteConfigurationError(`${inverter.capacityKw} kW ${inverter.brand} is not approved for the ${capacity} kW tier.`);
  }
  if (!Number.isInteger(config.panelQuantity) || config.panelQuantity < 1 || config.panelQuantity > 200) {
    throw new PublicQuoteConfigurationError("Panel quantity must be a whole number between 1 and 200.");
  }

  const bundledBattery = inverter.bundle
    ? byId(BATTERY_CATALOG, inverter.bundle.batteryId, "included battery")
    : null;
  const battery = bundledBattery || byId(BATTERY_CATALOG, config.batteryId, "battery");
  if (!bundledBattery && !publicQuoteBatteries(capacity).some((item) => item.id === battery.id)) {
    throw new PublicQuoteConfigurationError(`${battery.capacityKwh} kWh ${battery.brand} is not approved for the ${capacity} kW tier.`);
  }

  const panelUnitPrice = panel.watts * panel.pricePerWattPkr;
  const equipmentLines: PublicQuoteLine[] = [
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
      description: `${inverter.brand} ${inverter.capacityKw} kW hybrid inverter`,
      specification: [inverter.phase === "three" ? "3-phase" : "single-phase", inverter.protection, inverter.voltageClass, inverter.bundle ? "battery bundle" : ""].filter(Boolean).join(" · "),
      quantity: 1,
      unit: "pcs",
      unitPricePkr: inverter.pricePkr,
      totalPkr: inverter.pricePkr,
    },
    {
      category: "Equipment",
      description: `${battery.brand} ${battery.capacityKwh} kWh lithium battery`,
      specification: inverter.bundle ? "Included in FOX ESS inverter bundle" : [battery.model, battery.protection, battery.voltageClass].filter(Boolean).join(" · "),
      quantity: 1,
      unit: "pcs",
      unitPricePkr: inverter.bundle ? 0 : battery.pricePkr,
      totalPkr: inverter.bundle ? 0 : battery.pricePkr,
    },
  ];

  let structureLabel = "Elevated structure (on-site fabrication)";
  let structurePrice = rule.elevatedStructurePkr;
  let structureQuantity = 1;
  let structureUnit = "job";
  let structureSpecification = "Capacity-specific H-beam/C-channel structure, finishing and foundation";
  if (config.structureType !== "elevated") {
    const standType = config.structureType === "standard-l3" ? "l3" : "l2";
    const stand = standardStandPrice(config.panelQuantity, standType);
    structureLabel = `${standType.toUpperCase()} standard panel stands`;
    structurePrice = stand.totalPricePkr;
    structureQuantity = stand.standCount;
    structureUnit = "stands";
    structureSpecification = `${standType === "l2" ? 2 : 3} panels per stand`;
  }
  const structureLine: PublicQuoteLine = {
    category: "Structure",
    description: structureLabel,
    specification: structureSpecification,
    quantity: structureQuantity,
    unit: structureUnit,
    unitPricePkr: structureQuantity === 1 ? structurePrice : structurePrice / structureQuantity,
    totalPkr: structurePrice,
  };
  const foundationLine: PublicQuoteLine[] =
    config.structureType !== "elevated" && rule.standardFoundationPkr
      ? [{
          category: "Structure",
          description: "Foundation work for standard structure",
          specification: "Concrete filling and civil work from source BOQ",
          quantity: 1,
          unit: "job",
          unitPricePkr: rule.standardFoundationPkr,
          totalPkr: rule.standardFoundationPkr,
        }]
      : [];
  const fixedLines = config.structureType === "elevated" && rule.elevatedFixedLines
    ? rule.elevatedFixedLines
    : rule.fixedLines;
  const lines = [...equipmentLines, ...fixedLines, structureLine, ...foundationLine];
  return {
    systemCapacityKw: capacity,
    configuredPanelCapacityKw: (panel.watts * config.panelQuantity) / 1_000,
    panel,
    inverter,
    battery,
    structureLabel,
    lines,
    totalPkr: lines.reduce((sum, item) => sum + item.totalPkr, 0),
  };
}
