/**
 * Source-of-truth configuration extracted from the supplied SunChaser BOQ
 * screenshots. This is deliberately separate from React/UI code.
 *
 * Important: the resolver is exact-match only. It never applies a universal
 * cable, breaker, or structure default when a source quotation is missing.
 */

export type QuotationSelection = {
  systemCapacityKw: number;
  inverterBrand: string;
  inverterModel: string;
  batteryBrand: string;
  batteryModel: string;
  structureType: "elevated" | "standard";
};

export type QuotationLine = {
  category: "equipment" | "cabling" | "fixed_item" | "service";
  code: string;
  description: string;
  brandOrSpecification?: string;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
  includedInSourceTotal: boolean;
  dependency: "inverter" | "capacity" | "structure" | "common";
  sourceNote?: string;
};

export type QuotationSource = {
  id: string;
  sourceLabel: string;
  systemCapacityKw: number;
  inverter: { brand: string; model: string; quantity: number; unitPrice: number };
  battery: {
    brand: string;
    model: string;
    quantity: number;
    unitPrice: number | null;
    priceStatus: "confirmed" | "not_visible_in_source";
  };
  panels: { brand: string; model: string; watts: number; quantity: number; unitPrice: number };
  structureType: "elevated" | "standard";
  lines: QuotationLine[];
  rooftopSubtotal: number;
  discountedOffer: number;
};

const line = (
  category: QuotationLine["category"],
  code: string,
  description: string,
  unit: string,
  quantity: number,
  unitPrice: number | null,
  dependency: QuotationLine["dependency"],
  options: Partial<Pick<QuotationLine, "brandOrSpecification" | "includedInSourceTotal" | "sourceNote">> = {
    includedInSourceTotal: true,
  },
): QuotationLine => ({
  category,
  code,
  description,
  unit,
  quantity,
  unitPrice,
  totalPrice: unitPrice === null ? null : unitPrice * quantity,
  dependency,
  includedInSourceTotal: true,
  ...options,
});

const common20 = [
  line("cabling", "fireproof-4mm", "4 sq.mm, 1C s/c CU/XLPE/PVC double-insulated fire-proof cable", "job", 1, 40000, "inverter", { brandOrSpecification: "Tin coated Pakistan cable" }),
  line("cabling", "pv-6mm", "6 sq.mm PVC/PVC rated 600/1000V cable", "meter", 70, 250, "capacity", { brandOrSpecification: "GM/FAST or equivalent" }),
  line("fixed_item", "db-box-4p-1000v", "4P 1000V DC MCB, 2P 1000V DC SPD, 2P 63A AC MCB, 2P AC SPD, 2P 63A RCCB, copper busbars, neutral/earth bars, glands, ferrules and internal wiring", "job", 1, 30000, "inverter", { brandOrSpecification: "GADA/Chint 4P" }),
  line("fixed_item", "electrical-mechanical-kit", "PVC pipes, elbows, connectors, bends, clamps, junction/back boxes, sockets, PVC trunk/duct, solar DC cable joints, SS fasteners, cable ties, earthing thimbles, panel clamps, lugs, shrouds, tapes and glands", "job", 1, 15000, "capacity", { brandOrSpecification: "GM" }),
  line("fixed_item", "earthing-package", "CU/PVC earthing wire for panels/SPDs; AC/DC bore with 10 sq.mm Cu/PVC; earthing chemical, 2.5ft x 12mm copper rod, ground copper electrode, 4 sq.mm CU/PVC bare conductor and copper lightning arrester", "job", 1, 40000, "capacity", { brandOrSpecification: "Less than 5 ohms; local earthing materials" }),
  line("service", "elevated-girder", "Elevated structure: 6x200x200mm base plate, 62x125x3mm H-beam columns, 3x1.5-inch channel rafters, H-beam purlins, angle cross, 1/2x6-inch stud bolts and SS bolts", "job", 32, 10320, "structure", { brandOrSpecification: "H-beam/C-channel, Mughal mechanical work" }),
  line("service", "girder-cleaning", "Clean girders with kerosene oil; dual red-oxide and enamel paint", "job", 1, 8000, "structure", { brandOrSpecification: "Diamond/equivalent" }),
  line("service", "foundation", "Foundation work for structure pillars, including digging, epoxy filling and tarcoal paint", "job", 1, 10000, "structure", { brandOrSpecification: "Civil work" }),
  line("service", "installation", "Installation of solar panels, electrical wiring and equipment", "job", 1, 82560, "capacity"),
  line("service", "transportation", "Transportation", "job", 1, 10000, "common"),
  line("service", "project-management", "Survey, designing, testing, commissioning and execution", "job", 1, 5000, "common", { brandOrSpecification: "Project management" }),
];

const common8 = [
  line("cabling", "fireproof-4mm", "4 sq.mm, 1C s/c CU/XLPE/PVC double-insulated fire-proof cable", "job", 1, 20000, "inverter", { brandOrSpecification: "Tin coated Pakistan cable" }),
  line("cabling", "pv-6mm", "6 sq.mm PVC/PVC rated 600/1000V cable", "meter", 30, 300, "capacity", { brandOrSpecification: "GM/FAST or equivalent" }),
  line("fixed_item", "db-box-4p-1000v", "4P 1000V DC MCB, DC/AC SPDs, 63A AC protection, RCCB, copper busbars, neutral/earth bars, glands, ferrules and internal wiring", "job", 1, 20000, "inverter", { brandOrSpecification: "GADA/Chint 4P" }),
  line("fixed_item", "electrical-mechanical-kit", "PVC material, trunk/duct, solar DC cable joints, SS fasteners, cable ties, earthing thimbles, panel clamps, lugs, shrouds, tapes and glands", "job", 1, 10000, "capacity", { brandOrSpecification: "GM" }),
  line("fixed_item", "earthing-package", "CU/PVC earthing wire; AC/DC bore with 10 sq.mm Cu/PVC; earthing chemical, 2.5ft x 12mm copper rod, ground copper electrode, bare conductor and copper lightning arrester", "job", 1, 37000, "capacity", { brandOrSpecification: "Less than 5 ohms; local earthing materials" }),
  line("service", "elevated-girder", "Elevated structure with H-beam/C-channel members, base plates, columns, rafters, purlins, angle cross and SS bolts", "job", 12, 12320, "structure", { brandOrSpecification: "H-beam/C-channel, Mughal mechanical work" }),
  line("service", "walkway-stairs", "Walkway and stairs", "job", 1, 25000, "structure"),
  line("service", "girder-cleaning", "Clean girders with kerosene oil; dual red-oxide and enamel paint", "job", 1, 5000, "structure", { brandOrSpecification: "Diamond/equivalent" }),
  line("service", "foundation", "Foundation work for structure pillars, including digging, epoxy filling and tarcoal paint", "job", 1, 6200, "structure", { brandOrSpecification: "Civil work" }),
  line("service", "installation", "Installation of solar panels, electrical wiring and equipment", "job", 1, 27720, "capacity"),
  line("service", "transportation", "Transportation", "job", 1, 10000, "common"),
  line("service", "project-management", "Survey, designing, testing, commissioning and execution", "job", 1, 5000, "common", { brandOrSpecification: "Project management" }),
];

const common12 = [
  line("cabling", "fireproof-4mm", "4 sq.mm, 1C s/c CU/XLPE/PVC double-insulated fire-proof cable", "job", 1, 25000, "inverter", { brandOrSpecification: "Tin coated Pakistan cable" }),
  line("cabling", "pv-6mm", "6 sq.mm PVC/PVC rated 600/1000V cable", "meter", 40, 250, "capacity", { brandOrSpecification: "GM/FAST or equivalent" }),
  line("fixed_item", "db-box-4p-1000v", "4P 1000V DC MCB, DC/AC SPDs, 63A AC protection, RCCB, copper busbars, neutral/earth bars, glands, ferrules and internal wiring", "job", 1, 18000, "inverter", { brandOrSpecification: "GADA/Chint" }),
  line("fixed_item", "electrical-mechanical-kit", "PVC material, trunk/duct, solar DC cable joints, SS fasteners, cable ties, earthing thimbles, panel clamps, lugs, shrouds, tapes and glands", "job", 1, 13000, "capacity", { brandOrSpecification: "GM" }),
  line("fixed_item", "earthing-package", "CU/PVC earthing wire; AC/DC bore with 10 sq.mm Cu/PVC; earthing chemical, 2.5ft x 12mm copper rod, ground copper electrode, bare conductor and copper lightning arrester", "job", 1, 35000, "capacity", { brandOrSpecification: "Less than 5 ohms; local earthing materials" }),
  line("service", "elevated-girder", "Elevated structure with H-beam/C-channel members, base plates, columns, rafters, purlins, angle cross and SS bolts", "job", 19, 10320, "structure", { brandOrSpecification: "H-beam/C-channel, Mughal mechanical work" }),
  line("service", "girder-cleaning", "Clean girders with kerosene oil; dual red-oxide and enamel paint", "job", 1, 5000, "structure", { brandOrSpecification: "Diamond/equivalent" }),
  line("service", "foundation", "Foundation work for structure pillars, including digging, epoxy filling and tarcoal paint", "job", 1, 6200, "structure", { brandOrSpecification: "Civil work" }),
  line("service", "installation", "Installation of solar panels, electrical wiring and equipment", "job", 1, 49020, "capacity"),
  line("service", "transportation", "Transportation", "job", 1, 10000, "common"),
  line("service", "project-management", "Survey, designing, testing, commissioning and execution", "job", 1, 5000, "common", { brandOrSpecification: "Project management" }),
];

const common15 = [
  line("cabling", "fireproof-4mm", "4 sq.mm, 1C s/c CU/XLPE/PVC double-insulated fire-proof cable", "job", 1, 25000, "inverter", { brandOrSpecification: "Tin coated Pakistan cable" }),
  line("cabling", "pv-6mm", "6 sq.mm PVC/PVC rated 600/1000V cable", "meter", 30, 300, "capacity", { brandOrSpecification: "GM/FAST or equivalent" }),
  line("fixed_item", "db-box-4p-1000v", "4P 1000V DC MCB, DC/AC SPDs, 63A AC protection, RCCB, copper busbars, neutral/earth bars, glands, ferrules and internal wiring", "job", 1, 20000, "inverter", { brandOrSpecification: "GADA/Chint 4P" }),
  line("fixed_item", "electrical-mechanical-kit", "PVC material, trunk/duct, solar DC cable joints, SS fasteners, cable ties, earthing thimbles, panel clamps, lugs, shrouds, tapes and glands", "job", 1, 10000, "capacity", { brandOrSpecification: "GM" }),
  line("fixed_item", "earthing-package", "CU/PVC earthing wire; AC/DC bore with 10 sq.mm Cu/PVC; earthing chemical, 2.5ft x 12mm copper rod, ground copper electrode, bare conductor and copper lightning arrester", "job", 1, 37000, "capacity", { brandOrSpecification: "Less than 5 ohms; local earthing materials" }),
  line("service", "elevated-girder", "Elevated structure with H-beam/C-channel members, base plates, columns, rafters, purlins, angle cross and SS bolts", "job", 16, 10320, "structure", { brandOrSpecification: "H-beam/C-channel, Mughal mechanical work" }),
  line("service", "walkway-stairs", "Walkway and stairs", "job", 1, 30000, "structure"),
  line("service", "girder-cleaning", "Clean girders with kerosene oil; dual red-oxide and enamel paint", "job", 1, 5000, "structure", { brandOrSpecification: "Diamond/equivalent" }),
  line("service", "foundation", "Foundation work for structure pillars, including digging, epoxy filling and tarcoal paint", "job", 1, 6200, "structure", { brandOrSpecification: "Civil work" }),
  line("service", "installation", "Installation of solar panels, electrical wiring and equipment", "job", 1, 46440, "capacity"),
  line("service", "transportation", "Transportation", "job", 1, 10000, "common"),
  line("service", "project-management", "Survey, designing, testing, commissioning and execution", "job", 1, 5000, "common", { brandOrSpecification: "Project management" }),
];

const makeSource = (source: Omit<QuotationSource, "lines"> & { lines: QuotationLine[] }): QuotationSource => source;

export const quotationSourceCatalog: readonly QuotationSource[] = [
  makeSource({ id: "q-8kw-goodwe-ip66", sourceLabel: "8kW Hybrid Solar System screenshot", systemCapacityKw: 8, inverter: { brand: "GoodWe", model: "IP66", quantity: 1, unitPrice: 305000 }, battery: { brand: "GoodWe", model: "IP66 16kWh", quantity: 1, unitPrice: 725000, priceStatus: "confirmed" }, panels: { brand: "Aiko", model: "770W", watts: 770, quantity: 12, unitPrice: 33495 }, structureType: "elevated", lines: common8, rooftopSubtotal: 1754700, discountedOffer: 1750000 }),
  makeSource({ id: "q-12kw-goodwe-sp-longi", sourceLabel: "12kW Hybrid Solar System screenshot - LONGi X10", systemCapacityKw: 12, inverter: { brand: "GoodWe", model: "SP", quantity: 1, unitPrice: 425000 }, battery: { brand: "GoodWe", model: "5kWh", quantity: 2, unitPrice: 254000, priceStatus: "confirmed" }, panels: { brand: "LONGi", model: "X10 645W", watts: 645, quantity: 19, unitPrice: 27606 }, structureType: "elevated", lines: common12, rooftopSubtotal: 1829814.5, discountedOffer: 1829814.5 }),
  makeSource({ id: "q-12kw-goodwe-sp-jinko", sourceLabel: "12kW Hybrid Solar System screenshot - Jinko X20 Tiger Neo", systemCapacityKw: 12, inverter: { brand: "GoodWe", model: "SP", quantity: 1, unitPrice: 425000 }, battery: { brand: "GoodWe", model: "5kWh", quantity: 2, unitPrice: 254000, priceStatus: "confirmed" }, panels: { brand: "Jinko", model: "X20 Tiger Neo 645W", watts: 645, quantity: 19, unitPrice: 26122.5 }, structureType: "elevated", lines: common12, rooftopSubtotal: 1801628, discountedOffer: 1801628 }),
  makeSource({ id: "q-15kw-goodwe-3p-ip66", sourceLabel: "15kW Hybrid Solar System screenshot", systemCapacityKw: 15, inverter: { brand: "GoodWe", model: "3P IP66", quantity: 1, unitPrice: 575000 }, battery: { brand: "Dyness", model: "16kWh", quantity: 1, unitPrice: 600000, priceStatus: "confirmed" }, panels: { brand: "Jinko x20", model: "645W", watts: 645, quantity: 24, unitPrice: 25800 }, structureType: "elevated", lines: common15, rooftopSubtotal: 2162960, discountedOffer: 2160000 }),
  makeSource({ id: "q-20kw-goodwe-lv-ip65-goodwe-battery", sourceLabel: "20kW Hybrid Solar System screenshot - GoodWe battery (updated catalog rate)", systemCapacityKw: 20, inverter: { brand: "GoodWe", model: "LV IP65", quantity: 1, unitPrice: 745000 }, battery: { brand: "GoodWe", model: "IP66 16kWh", quantity: 1, unitPrice: 725000, priceStatus: "confirmed" }, panels: { brand: "LONGi", model: "X10 645W", watts: 645, quantity: 32, unitPrice: 27735 }, structureType: "elevated", lines: common20, rooftopSubtotal: 2945820, discountedOffer: 2940000 }),
  makeSource({ id: "q-20kw-goodwe-lv-ip65-dyness", sourceLabel: "20kW Hybrid Solar System screenshot - Dyness Brick Max", systemCapacityKw: 20, inverter: { brand: "GoodWe", model: "LV IP65", quantity: 1, unitPrice: 745000 }, battery: { brand: "Dyness", model: "Brick Max", quantity: 1, unitPrice: 600000, priceStatus: "confirmed" }, panels: { brand: "Longi x10", model: "645W", watts: 645, quantity: 32, unitPrice: 27735 }, structureType: "elevated", lines: common20, rooftopSubtotal: 2820820, discountedOffer: 2800000 }),
  makeSource({ id: "q-20kw-fox-12kw-ip66-bundle", sourceLabel: "20kW Hybrid Solar System screenshot - FOX ESS corrected bundle", systemCapacityKw: 20, inverter: { brand: "FOX ESS", model: "12kW IP66 HV + 10.2kWh battery bundle", quantity: 2, unitPrice: 970000 }, battery: { brand: "FOX ESS", model: "10.2kWh IP66 HV (included)", quantity: 2, unitPrice: 0, priceStatus: "confirmed" }, panels: { brand: "LONGi", model: "X10 645W", watts: 645, quantity: 32, unitPrice: 27735 }, structureType: "elevated", lines: common20, rooftopSubtotal: 3415820, discountedOffer: 3400000 }),
];

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

export class QuotationConfigurationError extends Error {
  readonly code: "NO_MATCHING_QUOTATION" | "INCOMPLETE_SOURCE_DATA";

  constructor(code: "NO_MATCHING_QUOTATION" | "INCOMPLETE_SOURCE_DATA", message: string) {
    super(message);
    this.name = "QuotationConfigurationError";
    this.code = code;
  }
}

export function resolveQuotationSource(selection: QuotationSelection): QuotationSource {
  const match = quotationSourceCatalog.find((source) =>
    source.systemCapacityKw === selection.systemCapacityKw &&
    normalize(source.inverter.brand) === normalize(selection.inverterBrand) &&
    normalize(source.inverter.model) === normalize(selection.inverterModel) &&
    normalize(source.battery.brand) === normalize(selection.batteryBrand) &&
    normalize(source.battery.model) === normalize(selection.batteryModel) &&
    source.structureType === selection.structureType,
  );

  if (!match) {
    throw new QuotationConfigurationError(
      "NO_MATCHING_QUOTATION",
      `No source quotation matches ${selection.systemCapacityKw}kW / ${selection.inverterBrand} ${selection.inverterModel} / ${selection.batteryBrand} ${selection.batteryModel}. Manual cabling and fixed-item specification is required; no default was applied.`,
    );
  }

  if (match.battery.priceStatus !== "confirmed") {
    throw new QuotationConfigurationError(
      "INCOMPLETE_SOURCE_DATA",
      `The source quotation ${match.id} does not show a confirmed battery price. Specify the battery price manually before generating a commercial quote.`,
    );
  }

  return match;
}

export function resolveQuotationComponents(selection: QuotationSelection) {
  const source = resolveQuotationSource(selection);
  return {
    sourceQuotationId: source.id,
    inverter: source.inverter,
    battery: source.battery,
    panels: source.panels,
    requiredCabling: source.lines.filter((item) => item.category === "cabling"),
    requiredFixedItems: source.lines.filter((item) => item.category === "fixed_item"),
    requiredServices: source.lines.filter((item) => item.category === "service"),
    rooftopSubtotal: source.rooftopSubtotal,
    discountedOffer: source.discountedOffer,
  };
}
