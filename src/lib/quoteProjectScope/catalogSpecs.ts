import type { Product } from "../../types";
import { UNAVAILABLE_SPEC } from "./types";

/** Read a catalog specification. Never invents a value. */
export function readCatalogSpec(
  product: Product | null | undefined,
  keys: string[]
): string {
  if (!product) return "";
  const specs = (product.specifications || {}) as Record<string, unknown>;
  const bag: Record<string, unknown> = {
    ...specs,
    wattageCapacity: (product as { wattageCapacity?: string }).wattageCapacity,
    warrantyPeriod: product.warrantyPeriod,
    brand: product.brand,
    model: product.model,
    name: product.name,
    availability: product.availability,
    price: product.price,
  };
  for (const key of keys) {
    const value = bag[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function displaySpec(value: string | null | undefined): string {
  const text = String(value || "").trim();
  return text || UNAVAILABLE_SPEC;
}

export function catalogRate(product: Product | null | undefined): { rate: number; source: "catalog" | "website" | "none" } {
  const price = Number(product?.price);
  if (!product || !Number.isFinite(price) || price <= 0) return { rate: 0, source: "none" };
  return { rate: price, source: product.source ? "website" : "catalog" };
}

export function panelCatalogFields(product: Product | null | undefined) {
  return {
    technology: displaySpec(readCatalogSpec(product, ["technology", "cellTechnology", "type"])),
    efficiency: displaySpec(readCatalogSpec(product, ["efficiency", "moduleEfficiency"])),
    productWarranty: displaySpec(readCatalogSpec(product, ["productWarranty", "warrantyPeriod"])),
    performanceWarranty: displaySpec(readCatalogSpec(product, ["performanceWarranty", "linearWarranty"])),
  };
}

export function inverterCatalogFields(product: Product | null | undefined) {
  return {
    topology: displaySpec(readCatalogSpec(product, ["topology", "inverterType"])),
    phase: displaySpec(readCatalogSpec(product, ["phase", "phases"])),
    maxEfficiency: displaySpec(readCatalogSpec(product, ["maxEfficiency", "efficiency"])),
    europeanEfficiency: displaySpec(readCatalogSpec(product, ["europeanEfficiency", "euroEfficiency"])),
    mpptCount: displaySpec(readCatalogSpec(product, ["mpptCount", "mppt"])),
    maxPvInputVoltage: displaySpec(readCatalogSpec(product, ["maxPvInputVoltage", "maxDcVoltage"])),
    mpptVoltageRange: displaySpec(readCatalogSpec(product, ["mpptVoltageRange"])),
    maxInputCurrent: displaySpec(readCatalogSpec(product, ["maxInputCurrent"])),
    shortCircuitCurrent: displaySpec(readCatalogSpec(product, ["isc", "shortCircuitCurrent"])),
    ratedAcCurrent: displaySpec(readCatalogSpec(product, ["ratedAcCurrent"])),
    maxAcCurrent: displaySpec(readCatalogSpec(product, ["maxAcCurrent"])),
    ipRating: displaySpec(readCatalogSpec(product, ["ipRating", "ip"])),
    cooling: displaySpec(readCatalogSpec(product, ["cooling"])),
    operatingTemperature: displaySpec(readCatalogSpec(product, ["operatingTemperature"])),
    communication: displaySpec(readCatalogSpec(product, ["communication", "comms"])),
    warranty: displaySpec(readCatalogSpec(product, ["warrantyPeriod", "warranty"])),
    protection: displaySpec(readCatalogSpec(product, ["protection"])),
  };
}

export function batteryCatalogFields(product: Product | null | undefined) {
  return {
    chemistry: displaySpec(readCatalogSpec(product, ["chemistry", "cellChemistry"])),
    nominalKwh: displaySpec(readCatalogSpec(product, ["nominalKwh", "capacityKwh", "wattageCapacity"])),
    usableKwh: displaySpec(readCatalogSpec(product, ["usableKwh"])),
    nominalVoltage: displaySpec(readCatalogSpec(product, ["nominalVoltage", "voltage"])),
    operatingVoltageRange: displaySpec(readCatalogSpec(product, ["operatingVoltageRange"])),
    ahCapacity: displaySpec(readCatalogSpec(product, ["ah", "ampHours"])),
    dod: displaySpec(readCatalogSpec(product, ["dod", "depthOfDischarge"])),
    cycleLife: displaySpec(readCatalogSpec(product, ["cycleLife", "cycles"])),
    chargeCurrent: displaySpec(readCatalogSpec(product, ["continuousChargeCurrent"])),
    dischargeCurrent: displaySpec(readCatalogSpec(product, ["continuousDischargeCurrent"])),
    peakDischarge: displaySpec(readCatalogSpec(product, ["peakDischargeCurrent"])),
    bms: displaySpec(readCatalogSpec(product, ["bms"])),
    communication: displaySpec(readCatalogSpec(product, ["communication", "comms"])),
    parallelUnits: displaySpec(readCatalogSpec(product, ["parallelUnits"])),
    ipRating: displaySpec(readCatalogSpec(product, ["ipRating", "ip"])),
    mount: displaySpec(readCatalogSpec(product, ["mount", "mounting"])),
    warrantyYears: displaySpec(readCatalogSpec(product, ["warrantyPeriod", "warrantyYears"])),
    warrantyCycles: displaySpec(readCatalogSpec(product, ["warrantyCycles"])),
  };
}
