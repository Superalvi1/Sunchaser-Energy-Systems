/** Deterministic Sunchaser selling prices. Arithmetic only — never AI. */

export const SUNCHASER_PANEL_UNIT_PRICE_PKR: Record<number, number> = {
  645: 27_735,
};

export type CatalogStructure = "standard" | "elevated";

export type CatalogPackage = {
  id: string;
  capacityKw: number;
  structure: CatalogStructure;
  batteryKwh: number;
  pricePkr: number;
  label: string;
};

export const SUNCHASER_PACKAGE_PRICES: readonly CatalogPackage[] = [
  { id: "pkg-6-std-5", capacityKw: 6, structure: "standard", batteryKwh: 5, pricePkr: 820_000, label: "6 kW standard · 5 kWh battery" },
  { id: "pkg-6-elev-5", capacityKw: 6, structure: "elevated", batteryKwh: 5, pricePkr: 900_000, label: "6 kW elevated · 5 kWh battery" },
  { id: "pkg-8-elev-5", capacityKw: 8, structure: "elevated", batteryKwh: 5, pricePkr: 1_080_000, label: "8 kW elevated · 5 kWh battery" },
  { id: "pkg-10-std-5", capacityKw: 10, structure: "standard", batteryKwh: 5, pricePkr: 1_215_000, label: "10 kW standard · 5 kWh battery" },
  { id: "pkg-10-elev-5", capacityKw: 10, structure: "elevated", batteryKwh: 5, pricePkr: 1_325_000, label: "10 kW elevated · 5 kWh battery" },
  { id: "pkg-10-std-16", capacityKw: 10, structure: "standard", batteryKwh: 16, pricePkr: 1_575_000, label: "10 kW standard · 16 kWh battery" },
  { id: "pkg-10-elev-16", capacityKw: 10, structure: "elevated", batteryKwh: 16, pricePkr: 1_690_000, label: "10 kW elevated · 16 kWh battery" },
];

export function catalogPanelUnitPrice(wattage: number): number {
  return SUNCHASER_PANEL_UNIT_PRICE_PKR[wattage] || 0;
}

export function catalogPackagePrice(
  capacityKw: number,
  structure: CatalogStructure,
  batteryKwh: number
): number | null {
  const match = SUNCHASER_PACKAGE_PRICES.find(
    (item) =>
      item.capacityKw === capacityKw &&
      item.structure === structure &&
      item.batteryKwh === batteryKwh
  );
  return match ? match.pricePkr : null;
}

export function catalogOptionAdjustment(packagePrice: number, basePrice: number): number {
  return Math.round(packagePrice - basePrice);
}

export function snapshotOriginalQuotation(quote: any) {
  return {
    id: String(quote?.id || ""),
    status: String(quote?.status || ""),
    systemSizekW: Number(quote?.systemSizekW || 0),
    panelCount: Number(quote?.panelCount || 0),
    panelWattage: Number(quote?.panelWattage || 0),
    netTotal: Number(quote?.netTotal ?? quote?.netCost ?? quote?.totalCost ?? 0),
    inverterType: String(quote?.inverterType || quote?.inverterCapacity || ""),
    batteryOption: String(quote?.batteryOption || quote?.batteryCapacity || ""),
    structureType: String(quote?.structureType || quote?.selectedStructure || ""),
  };
}
