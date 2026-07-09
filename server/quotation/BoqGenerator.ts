/**
 * BOQ generator — assembles a full Bill of Quantities from a system design,
 * the product catalog, and the price/cable/structure pricing rules. Pure
 * composition: no persistence, no rendering.
 */

import { isPositiveNumber, QuotationEngineError, round2 } from "./QuotationModels.ts";
import { requireActiveProduct, type ProductCatalog, type SolarProductCategory } from "./ProductCatalog.ts";
import { computeLineTotal } from "./PriceRules.ts";
import { computeCableRunCost, type CableRunType } from "./CablePricingRules.ts";
import { computeStructureCost, type RoofType, type StructureType } from "./StructurePricingRules.ts";
import { aggregateMargin, type MarginResult } from "./MarginRules.ts";

export interface BoqLineItem {
  category: SolarProductCategory | "generic";
  name: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  totalCost: number;
  totalPrice: number;
}

export interface CableRunSpec {
  type: CableRunType;
  lengthMeters: number;
  pricePerMeterCost: number;
  pricePerMeterPrice: number;
  wastagePercent?: number;
  accessoryAllowance?: number;
}

export interface SystemDesignInput {
  systemSizeKw: number;
  panelProductId: string;
  panelCount: number;
  inverterProductId: string;
  inverterCount: number;
  batteryProductId?: string;
  batteryCount?: number;
  structureType: StructureType;
  roofType: RoofType;
  structureRatePerKwCost: number;
  structureRatePerKwPrice: number;
  cableRuns: CableRunSpec[];
  /** Extra flat-fee line items (freight, net metering, survey/design, civil work). */
  extraLineProductIds?: string[];
  installCostMultiplier?: number;
}

export interface BoqResult {
  lines: BoqLineItem[];
  totalCost: number;
  totalPrice: number;
  margin: MarginResult;
}

function toBoqLine(
  category: SolarProductCategory,
  name: string,
  description: string,
  unit: string,
  quantity: number,
  unitCost: number,
  unitPrice: number
): BoqLineItem {
  return {
    category,
    name,
    description,
    unit,
    quantity,
    unitCost: round2(unitCost),
    unitPrice: round2(unitPrice),
    totalCost: round2(unitCost * quantity),
    totalPrice: computeLineTotal({ unitPrice, quantity }).lineTotal,
  };
}

export function generateBoq(catalog: ProductCatalog, design: SystemDesignInput): BoqResult {
  if (!isPositiveNumber(design.systemSizeKw)) {
    throw new QuotationEngineError("boq_generation", "systemSizeKw must be a positive number.");
  }
  if (!isPositiveNumber(design.panelCount)) {
    throw new QuotationEngineError("boq_generation", "panelCount must be a positive number.");
  }
  if (!isPositiveNumber(design.inverterCount)) {
    throw new QuotationEngineError("boq_generation", "inverterCount must be a positive number.");
  }
  if (design.batteryProductId && !isPositiveNumber(design.batteryCount ?? 0)) {
    throw new QuotationEngineError("boq_generation", "batteryCount must be a positive number when batteryProductId is set.");
  }

  const lines: BoqLineItem[] = [];
  const installCostMultiplier = design.installCostMultiplier ?? 1;

  // Panels
  const panel = requireActiveProduct(catalog, design.panelProductId);
  lines.push(
    toBoqLine("panel", panel.name, `${panel.brand} ${panel.name}`, panel.unit, design.panelCount, panel.unitCost, panel.unitPrice)
  );

  // Inverter(s)
  const inverter = requireActiveProduct(catalog, design.inverterProductId);
  lines.push(
    toBoqLine(
      "inverter",
      inverter.name,
      `${inverter.brand} ${inverter.name}`,
      inverter.unit,
      design.inverterCount,
      inverter.unitCost,
      inverter.unitPrice
    )
  );

  // Battery (optional)
  if (design.batteryProductId) {
    const battery = requireActiveProduct(catalog, design.batteryProductId);
    lines.push(
      toBoqLine(
        "battery",
        battery.name,
        `${battery.brand} ${battery.name}`,
        battery.unit,
        design.batteryCount ?? 1,
        battery.unitCost,
        battery.unitPrice
      )
    );
  }

  // Structure — cost/price scaled by site-complexity multiplier when provided.
  const structureCost = computeStructureCost({
    structureType: design.structureType,
    systemSizeKw: design.systemSizeKw,
    ratePerKw: design.structureRatePerKwCost,
    roofType: design.roofType,
  });
  const structurePrice = computeStructureCost({
    structureType: design.structureType,
    systemSizeKw: design.systemSizeKw,
    ratePerKw: design.structureRatePerKwPrice,
    roofType: design.roofType,
  });
  lines.push({
    category: "structure",
    name: `${design.structureType} mounting structure`,
    description: `${design.structureType} structure for ${design.roofType.replace(/_/g, " ")} roof`,
    unit: "kw",
    quantity: design.systemSizeKw,
    unitCost: round2(structureCost.totalCost / design.systemSizeKw),
    unitPrice: round2(structurePrice.totalCost / design.systemSizeKw),
    totalCost: round2(structureCost.totalCost * installCostMultiplier),
    totalPrice: round2(structurePrice.totalCost * installCostMultiplier),
  });

  // Cable runs
  for (const run of design.cableRuns) {
    const costRun = computeCableRunCost({
      type: run.type,
      lengthMeters: run.lengthMeters,
      pricePerMeter: run.pricePerMeterCost,
      wastagePercent: run.wastagePercent,
      accessoryAllowance: run.accessoryAllowance,
    });
    const priceRun = computeCableRunCost({
      type: run.type,
      lengthMeters: run.lengthMeters,
      pricePerMeter: run.pricePerMeterPrice,
      wastagePercent: run.wastagePercent,
      accessoryAllowance: run.accessoryAllowance,
    });
    lines.push({
      category: run.type,
      name: run.type.replace(/_/g, " "),
      description: `${run.lengthMeters}m run (+${costRun.wastagePercent}% wastage)`,
      unit: "meter",
      quantity: costRun.billedLengthMeters,
      unitCost: run.pricePerMeterCost,
      unitPrice: run.pricePerMeterPrice,
      totalCost: costRun.totalCost,
      totalPrice: priceRun.totalCost,
    });
  }

  // Extra flat-fee product lines (freight, net metering, survey/design, civil work, etc.)
  for (const productId of design.extraLineProductIds ?? []) {
    const product = requireActiveProduct(catalog, productId);
    lines.push(toBoqLine(product.category, product.name, product.name, product.unit, 1, product.unitCost, product.unitPrice));
  }

  const totalCost = round2(lines.reduce((sum, l) => sum + l.totalCost, 0));
  const totalPrice = round2(lines.reduce((sum, l) => sum + l.totalPrice, 0));
  const margin = aggregateMargin(lines.map((l) => ({ cost: l.totalCost, price: l.totalPrice })));

  return { lines, totalCost, totalPrice, margin };
}

/** Convenience helper — total across just the cable-related lines. */
export function totalCableCost(boq: BoqResult): number {
  const cableCategories = new Set<string>(["dc_cable", "ac_cable", "earth_wire"]);
  return round2(boq.lines.filter((l) => cableCategories.has(l.category)).reduce((sum, l) => sum + l.totalCost, 0));
}

/** Convenience helper — apply a percent discount to the total price only (cost is unaffected). */
export function applyDiscountToBoq(boq: BoqResult, discountPercent: number): BoqResult {
  if (discountPercent < 0 || discountPercent > 100) {
    throw new QuotationEngineError("boq_generation", "discountPercent must be in [0, 100].");
  }
  const discountedPrice = round2(boq.totalPrice * (1 - discountPercent / 100));
  return {
    ...boq,
    totalPrice: discountedPrice,
    margin: aggregateMargin([{ cost: boq.totalCost, price: discountedPrice }]),
  };
}

// Re-exported for callers assembling extra line product ids without importing
// the category type from two places.
export type { SolarProductCategory };
