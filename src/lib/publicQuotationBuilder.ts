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
export type PublicQuoteStructure = "standard-l2" | "standard-l3" | "elevated" | "mixed";

export type PublicQuoteConfig = {
  systemCapacityKw: number;
  panelId: string;
  panelQuantity: number;
  inverterId: string;
  inverterQuantity: number;
  batteryId: string;
  batteryQuantity: number;
  structureType: PublicQuoteStructure;
  structurePanelQuantity: number;
  mixedL2StandQuantity: number;
  mixedL3StandQuantity: number;
  mixedElevatedPanelQuantity: number;
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

/** Exact fixed-cost rules transcribed from the supplied capacity-specific BOQs. */
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
  const allowed = capacityKw === 15 ? new Set([15, 16]) : new Set([capacityKw]);
  return INVERTER_CATALOG.filter((item) => allowed.has(item.capacityKw));
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
    structureType: "standard-l2",
    structurePanelQuantity: recommendedPanelQuantity(capacityKw, panel.watts),
    mixedL2StandQuantity: Math.ceil(recommendedPanelQuantity(capacityKw, panel.watts) / 2),
    mixedL3StandQuantity: 0,
    mixedElevatedPanelQuantity: 0,
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
  if (!Number.isInteger(config.inverterQuantity) || config.inverterQuantity < 1 || config.inverterQuantity > 10) {
    throw new PublicQuoteConfigurationError("Inverter quantity must be a whole number between 1 and 10.");
  }
  if (!Number.isInteger(config.batteryQuantity) || config.batteryQuantity < 1 || config.batteryQuantity > 20) {
    throw new PublicQuoteConfigurationError("Battery quantity must be a whole number between 1 and 20.");
  }

  const bundledBattery = inverter.bundle
    ? byId(BATTERY_CATALOG, inverter.bundle.batteryId, "included battery")
    : null;
  const battery = bundledBattery || byId(BATTERY_CATALOG, config.batteryId, "battery");
  if (!bundledBattery && !publicQuoteBatteries(capacity).some((item) => item.id === battery.id)) {
    throw new PublicQuoteConfigurationError("Please select a battery from the approved catalog.");
  }
  const batteryQuantity = bundledBattery ? config.inverterQuantity : config.batteryQuantity;

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
  ];

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
  if (config.structureType === "elevated") {
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
  const foundationLine: PublicQuoteLine[] =
    (config.structureType === "standard-l2" || config.structureType === "standard-l3") && rule.standardFoundationPkr
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
  const installationLine: PublicQuoteLine = {
    category: "Services",
    description: "Installation and electrical wiring",
    specification: `${config.panelQuantity} panels × ${panel.watts}W × Rs. 4/W`,
    quantity: config.panelQuantity,
    unit: "panels",
    unitPricePkr: panel.watts * 4,
    totalPkr: config.panelQuantity * panel.watts * 4,
  };
  const lines = [...equipmentLines, ...fixedLines, ...structureLines, ...foundationLine, installationLine];
  return {
    systemCapacityKw: capacity,
    configuredPanelCapacityKw: (panel.watts * config.panelQuantity) / 1_000,
    panel,
    inverter,
    battery,
    structureLabel,
    configuredStructureCapacityPanels,
    lines,
    totalPkr: lines.reduce((sum, item) => sum + item.totalPkr, 0),
  };
}
