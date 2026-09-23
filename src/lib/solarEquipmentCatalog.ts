/** Approved Sunchaser selling catalog used by interactive client proposals. */

export type PanelCatalogItem = {
  id: string;
  brand: string;
  model: string;
  watts: number;
  pricePerWattPkr: number;
};

export type InverterCatalogItem = {
  id: string;
  brand: string;
  model?: string;
  capacityKw: number;
  phase: "single" | "three" | "unspecified";
  quoteTiersKw?: readonly number[];
  protection?: string;
  voltageClass?: "HV" | "LV";
  pricePkr: number;
  bundle?: {
    batteryId: string;
    batteryLabel: string;
    totalBundlePricePkr: number;
  };
};

export type BatteryCatalogItem = {
  id: string;
  brand: string;
  model: string;
  capacityKwh: number;
  protection?: string;
  voltageClass?: "HV" | "LV";
  pricePkr: number;
  bundleOnly?: boolean;
};

export type BatteryAccessoryCatalogItem = {
  id: string;
  brand: string;
  model: string;
  accessoryType: "hv-box" | "base-wheel";
  pricePkr: number;
};

export const PANEL_CATALOG: readonly PanelCatalogItem[] = [
  { id: "panel-aiko-abc-640", brand: "AIKO", model: "ABC Technology", watts: 640, pricePerWattPkr: 42.25 },
  { id: "panel-aiko-abc-645", brand: "AIKO", model: "ABC Technology", watts: 645, pricePerWattPkr: 43 },
  { id: "panel-aiko-770", brand: "AIKO", model: "Tier 1 A+", watts: 770, pricePerWattPkr: 43.5 },
  { id: "panel-longi-x10-645", brand: "LONGi", model: "X10", watts: 645, pricePerWattPkr: 42.8 },
  { id: "panel-jinko-x20-645", brand: "Jinko", model: "X20 Tiger Neo", watts: 645, pricePerWattPkr: 40.5 },
  { id: "panel-canadian-585", brand: "Canadian Solar", model: "Tier 1", watts: 585, pricePerWattPkr: 41.5 },
  { id: "panel-canadian-620", brand: "Canadian Solar", model: "Tier 1", watts: 620, pricePerWattPkr: 41.5 },
  { id: "panel-canadian-625-20bb", brand: "Canadian Solar", model: "20BB", watts: 625, pricePerWattPkr: 42 },
  { id: "panel-coretech-585", brand: "CoreTech", model: "Tier 1", watts: 585, pricePerWattPkr: 37.5 },
  { id: "panel-renesola-585", brand: "ReneSola", model: "Tier 1", watts: 585, pricePerWattPkr: 37.5 },
  { id: "panel-tcl-615", brand: "TCL", model: "Tier 1", watts: 615, pricePerWattPkr: 37.5 },
  { id: "panel-ja-585", brand: "JA Solar", model: "Tier 1", watts: 585, pricePerWattPkr: 38.5 },
  { id: "panel-ja-625", brand: "JA Solar", model: "Tier 1", watts: 625, pricePerWattPkr: 39 },
  { id: "panel-cora-dawn-abc-650", brand: "Cora Dawn", model: "ABC Technology", watts: 650, pricePerWattPkr: 37.5 },
  { id: "panel-astronergy-605", brand: "Astronergy", model: "Tier 1", watts: 605, pricePerWattPkr: 38.5 },
  { id: "panel-astronergy-620", brand: "Astronergy", model: "Tier 1", watts: 620, pricePerWattPkr: 39 },
  { id: "panel-trina-725-bf", brand: "Trina Solar", model: "BF", watts: 725, pricePerWattPkr: 39.5 },
] as const;

export const BATTERY_CATALOG: readonly BatteryCatalogItem[] = [
  { id: "battery-invent-5", brand: "Invent", model: "Lithium", capacityKwh: 5, pricePkr: 185_000 },
  { id: "battery-ses-5", brand: "SES", model: "Lithium", capacityKwh: 5, pricePkr: 210_000 },
  { id: "battery-hystorix-5", brand: "Hystorix", model: "Lithium", capacityKwh: 5, pricePkr: 220_000 },
  { id: "battery-dyness-5", brand: "Dyness", model: "Lithium", capacityKwh: 5, pricePkr: 225_000 },
  { id: "battery-soluna-5", brand: "Soluna", model: "Lithium", capacityKwh: 5, pricePkr: 225_000 },
  { id: "battery-itel-5", brand: "itel", model: "Lithium", capacityKwh: 5, pricePkr: 228_000 },
  { id: "battery-pytes-5", brand: "Pytes", model: "51V Lithium", capacityKwh: 5, voltageClass: "LV", pricePkr: 230_000 },
  { id: "battery-ey-power-5", brand: "EY Power", model: "Lithium", capacityKwh: 5, pricePkr: 230_000 },
  { id: "battery-pylontech-5", brand: "Pylontech", model: "Lithium", capacityKwh: 5, pricePkr: 245_000 },
  { id: "battery-goodwe-5", brand: "GoodWe", model: "Lithium", capacityKwh: 5, pricePkr: 255_000 },
  { id: "battery-dyness-powerhaus-5", brand: "Dyness", model: "PowerHaus C5-M", capacityKwh: 5, protection: "IP66", pricePkr: 260_000 },
  { id: "battery-knox-powerwall-3-0", brand: "Knox", model: "Powerwall 3.0", capacityKwh: 2.56, pricePkr: 130_000 },
  { id: "battery-knox-powerwall-4-15", brand: "Knox", model: "Powerwall 4.15", capacityKwh: 3.84, pricePkr: 133_000 },
  { id: "battery-knox-powerwall-6-0", brand: "Knox", model: "Powerwall 6.0", capacityKwh: 5.12, pricePkr: 225_000 },
  { id: "battery-knox-powerwall-6-11", brand: "Knox", model: "Powerwall 6.11", capacityKwh: 5.12, pricePkr: 230_000 },
  { id: "battery-knox-powerbase-10", brand: "Knox", model: "Powerbase 10", capacityKwh: 10.24, pricePkr: 430_000 },
  { id: "battery-knox-powerbase-16", brand: "Knox", model: "Powerbase 16", capacityKwh: 16.08, pricePkr: 570_000 },
  { id: "battery-knox-powerbase-32", brand: "Knox", model: "Powerbase 32", capacityKwh: 32.15, pricePkr: 1_090_000 },
  { id: "battery-knox-powerstack-5-hv", brand: "Knox", model: "PowerStack 5-HV", capacityKwh: 5.32, voltageClass: "HV", pricePkr: 556_000 },
  { id: "battery-knox-powerstack-10-hv", brand: "Knox", model: "PowerStack 10-HV", capacityKwh: 10.64, voltageClass: "HV", pricePkr: 867_000 },
  { id: "battery-knox-hv-5", brand: "Knox", model: "HV Battery 5-HV", capacityKwh: 5.32, voltageClass: "HV", pricePkr: 300_000 },
  { id: "battery-knox-hv-10", brand: "Knox", model: "HV Battery 10-HV", capacityKwh: 10.64, voltageClass: "HV", pricePkr: 562_000 },
  { id: "battery-dyness-10-ip65", brand: "Dyness", model: "Lithium", capacityKwh: 10, protection: "IP65", pricePkr: 500_000 },
  { id: "battery-renesola-16", brand: "ReneSola", model: "Lithium", capacityKwh: 16, pricePkr: 550_000 },
  { id: "battery-ses-16", brand: "SES", model: "Lithium", capacityKwh: 16, pricePkr: 550_000 },
  { id: "battery-dyness-powerbrick-max-16-08", brand: "Dyness", model: "PowerBrick MAX", capacityKwh: 16.08, voltageClass: "LV", pricePkr: 585_000 },
  { id: "battery-soluna-venus-16", brand: "Soluna", model: "Venus", capacityKwh: 16, protection: "IP66", pricePkr: 625_000 },
  { id: "battery-pylontech-16", brand: "Pylontech", model: "Lithium", capacityKwh: 16, pricePkr: 635_000 },
  { id: "battery-dyness-16-ip66", brand: "Dyness", model: "Lithium", capacityKwh: 16, protection: "IP66", pricePkr: 635_000 },
  { id: "battery-inverex-16", brand: "Inverex", model: "Lithium", capacityKwh: 16, pricePkr: 700_000 },
  { id: "battery-goodwe-16-ip66", brand: "GoodWe", model: "Lithium", capacityKwh: 16, protection: "IP66", pricePkr: 725_000 },
  { id: "battery-ses-35", brand: "SES", model: "Lithium", capacityKwh: 35, pricePkr: 1_175_000 },
  { id: "battery-fox-10-2-ip66-hv", brand: "FOX ESS", model: "High Voltage", capacityKwh: 10.2, protection: "IP66", voltageClass: "HV", pricePkr: 0, bundleOnly: true },
] as const;

export const BATTERY_ACCESSORY_CATALOG: readonly BatteryAccessoryCatalogItem[] = [
  { id: "battery-accessory-knox-hv-box-52ah", brand: "Knox", model: "HV Box 52Ah", accessoryType: "hv-box", pricePkr: 215_000 },
  { id: "battery-accessory-knox-hv-box-100ah", brand: "Knox", model: "HV Box 100Ah", accessoryType: "hv-box", pricePkr: 255_000 },
  { id: "battery-accessory-knox-base-wheel-52ah", brand: "Knox", model: "Base wheel 52Ah", accessoryType: "base-wheel", pricePkr: 51_000 },
  { id: "battery-accessory-knox-base-wheel-100ah", brand: "Knox", model: "Base wheel 100Ah", accessoryType: "base-wheel", pricePkr: 60_000 },
] as const;

export const INVERTER_CATALOG: readonly InverterCatalogItem[] = [
  { id: "inverter-knox-krypton-eco-5000", brand: "Knox", model: "Krypton ECO 5000 WiFi", capacityKw: 4.2, phase: "single", quoteTiersKw: [6], pricePkr: 98_000 },
  { id: "inverter-knox-krypton-6500", brand: "Knox", model: "Krypton 6500", capacityKw: 4.5, phase: "single", quoteTiersKw: [6], pricePkr: 118_000 },
  { id: "inverter-itel-6", brand: "itel", capacityKw: 6, phase: "single", pricePkr: 140_000 },
  { id: "inverter-knox-krypton-eco-6600", brand: "Knox", model: "Krypton ECO 6600 WiFi", capacityKw: 6.2, phase: "single", quoteTiersKw: [6], pricePkr: 104_000 },
  { id: "inverter-knox-krypton-9000", brand: "Knox", model: "Krypton 9000", capacityKw: 6.2, phase: "single", quoteTiersKw: [6], pricePkr: 138_000 },
  { id: "inverter-knox-krypton-9055", brand: "Knox", model: "Krypton 9055", capacityKw: 6.5, phase: "single", quoteTiersKw: [6], pricePkr: 160_000 },
  { id: "inverter-knox-xenon-12066-ip66", brand: "Knox", model: "Xenon 12066", capacityKw: 6.6, phase: "single", quoteTiersKw: [6], protection: "IP66", pricePkr: 200_000 },
  { id: "inverter-knox-zapher-6-6", brand: "Knox", model: "Zapher", capacityKw: 6.6, phase: "single", quoteTiersKw: [6], pricePkr: 195_000 },
  { id: "inverter-coretech-6-ip66", brand: "CoreTech", capacityKw: 6, phase: "single", protection: "IP66", pricePkr: 178_000 },
  { id: "inverter-saj-6-ip66", brand: "SAJ", capacityKw: 6, phase: "single", protection: "IP66", pricePkr: 185_000 },
  { id: "inverter-goodwe-6", brand: "GoodWe", capacityKw: 6, phase: "single", pricePkr: 205_000 },
  { id: "inverter-solis-6", brand: "Solis", capacityKw: 6, phase: "single", pricePkr: 215_000 },
  { id: "inverter-itel-8", brand: "itel", capacityKw: 8, phase: "single", pricePkr: 190_000 },
  { id: "inverter-knox-krypton-11008", brand: "Knox", model: "Krypton 11008", capacityKw: 8, phase: "single", quoteTiersKw: [8], pricePkr: 174_000 },
  { id: "inverter-knox-krypton-12002", brand: "Knox", model: "Krypton 12002", capacityKw: 8.5, phase: "single", quoteTiersKw: [8], pricePkr: 245_000 },
  { id: "inverter-coretech-8-ip66", brand: "CoreTech", capacityKw: 8, phase: "single", protection: "IP66", pricePkr: 225_000 },
  { id: "inverter-saj-8-ip65", brand: "SAJ", capacityKw: 8, phase: "single", protection: "IP65", pricePkr: 275_000 },
  { id: "inverter-goodwe-8-ip66", brand: "GoodWe", capacityKw: 8, phase: "single", protection: "IP66", pricePkr: 305_000 },
  { id: "inverter-solis-8", brand: "Solis", capacityKw: 8, phase: "single", pricePkr: 315_000 },
  { id: "inverter-coretech-10-ip66", brand: "CoreTech", capacityKw: 10, phase: "single", protection: "IP66", pricePkr: 275_000 },
  { id: "inverter-knox-zapher-9-2", brand: "Knox", model: "Zapher", capacityKw: 9.2, phase: "single", quoteTiersKw: [10], pricePkr: 295_000 },
  { id: "inverter-knox-krypton-13002", brand: "Knox", model: "Krypton 13002", capacityKw: 10, phase: "single", quoteTiersKw: [10], pricePkr: 255_000 },
  { id: "inverter-saj-10-ip65", brand: "SAJ", capacityKw: 10, phase: "single", protection: "IP65", pricePkr: 330_000 },
  { id: "inverter-goodwe-10", brand: "GoodWe", capacityKw: 10, phase: "single", pricePkr: 375_000 },
  { id: "inverter-solis-10", brand: "Solis", capacityKw: 10, phase: "single", pricePkr: 378_000 },
  { id: "inverter-growatt-10-3p", brand: "Growatt", capacityKw: 10, phase: "three", pricePkr: 430_000 },
  { id: "inverter-inverex-10", brand: "Inverex", capacityKw: 10, phase: "single", pricePkr: 430_000 },
  { id: "inverter-itel-12", brand: "itel", capacityKw: 12, phase: "single", pricePkr: 275_000 },
  { id: "inverter-knox-zapher-11-2", brand: "Knox", model: "Zapher", capacityKw: 11.2, phase: "single", quoteTiersKw: [12], pricePkr: 330_000 },
  { id: "inverter-knox-krypton-15002", brand: "Knox", model: "Krypton 15002", capacityKw: 11.5, phase: "single", quoteTiersKw: [12], pricePkr: 265_000 },
  { id: "inverter-knox-zapher-12-3p", brand: "Knox", model: "Zapher", capacityKw: 12, phase: "three", quoteTiersKw: [12], pricePkr: 480_000 },
  { id: "inverter-saj-12-sp-ip65", brand: "SAJ", capacityKw: 12, phase: "single", protection: "IP65", pricePkr: 370_000 },
  { id: "inverter-goodwe-12-sp", brand: "GoodWe", capacityKw: 12, phase: "single", pricePkr: 420_000 },
  { id: "inverter-goodwe-12-3p", brand: "GoodWe", capacityKw: 12, phase: "three", pricePkr: 480_000 },
  { id: "inverter-saj-12-3p-ip66", brand: "SAJ", capacityKw: 12, phase: "three", protection: "IP66", pricePkr: 480_000 },
  { id: "inverter-fox-12-ip66-hv-bundle", brand: "FOX ESS", capacityKw: 12, phase: "single", protection: "IP66", voltageClass: "HV", pricePkr: 970_000, bundle: { batteryId: "battery-fox-10-2-ip66-hv", batteryLabel: "FOX ESS 10.2 kWh IP66 high-voltage battery (included)", totalBundlePricePkr: 970_000 } },
  { id: "inverter-goodwe-15-3p", brand: "GoodWe", capacityKw: 15, phase: "three", pricePkr: 570_000 },
  { id: "inverter-knox-zapher-15-3p", brand: "Knox", model: "Zapher", capacityKw: 15, phase: "three", quoteTiersKw: [15], pricePkr: 580_000 },
  { id: "inverter-saj-16-3p-ip66", brand: "SAJ", capacityKw: 16, phase: "three", protection: "IP66", pricePkr: 585_000 },
  { id: "inverter-saj-20-3p-ip66", brand: "SAJ", capacityKw: 20, phase: "three", protection: "IP66", pricePkr: 715_000 },
  { id: "inverter-knox-zapher-20-3p", brand: "Knox", model: "Zapher", capacityKw: 20, phase: "three", quoteTiersKw: [20], pricePkr: 740_000 },
  { id: "inverter-goodwe-20-lv", brand: "GoodWe", capacityKw: 20, phase: "three", voltageClass: "LV", pricePkr: 745_000 },
  { id: "inverter-goodwe-30-hv", brand: "GoodWe", capacityKw: 30, phase: "three", voltageClass: "HV", pricePkr: 1_120_000 },
  { id: "inverter-knox-zapher-30-3p", brand: "Knox", model: "Zapher", capacityKw: 30, phase: "three", pricePkr: 955_000 },
  { id: "inverter-goodwe-50-hv", brand: "GoodWe", capacityKw: 50, phase: "three", voltageClass: "HV", pricePkr: 1_420_000 },
  { id: "inverter-knox-zapher-50-3p", brand: "Knox", model: "Zapher", capacityKw: 50, phase: "three", pricePkr: 1_280_000 },
  { id: "inverter-goodwe-100-hv", brand: "GoodWe", capacityKw: 100, phase: "three", voltageClass: "HV", pricePkr: 2_050_000 },
] as const;

export const STANDARD_STAND_RATES_PKR = {
  l2: { panelsPerStand: 2, ratePerStand: 4_500 },
  l3: { panelsPerStand: 3, ratePerStand: 7_200 },
} as const;

/** Capacity-specific elevated structure totals extracted from the supplied BOQs. */
export const ELEVATED_STRUCTURE_PRICES_PKR: Readonly<Record<number, number>> = {
  8: 184_040,
  12: 207_280,
  15: 206_320,
  20: 348_240,
};

export function panelUnitPricePkr(item: PanelCatalogItem): number {
  return item.watts * item.pricePerWattPkr;
}

export function inverterDisplayName(item: InverterCatalogItem): string {
  return [item.brand, item.model, `${item.capacityKw}kW`].filter(Boolean).join(" ");
}

export function compatibleInverters(systemCapacityKw: number): InverterCatalogItem[] {
  const capacity = Number(systemCapacityKw);
  if (!Number.isFinite(capacity) || capacity <= 0) return [];
  const allowed = capacity === 15 ? new Set([15, 16]) : new Set([capacity]);
  return INVERTER_CATALOG.filter(
    (item) => item.quoteTiersKw?.includes(capacity) || allowed.has(item.capacityKw),
  );
}

export function compatibleBatteries(systemCapacityKw: number): BatteryCatalogItem[] {
  const capacity = Number(systemCapacityKw);
  if (!Number.isFinite(capacity) || capacity <= 0) return [];
  return BATTERY_CATALOG.filter((item) => {
    if (item.bundleOnly) return true;
    if (capacity <= 20) return item.capacityKwh <= 16.1;
    return item.capacityKwh >= 16;
  });
}

export function standardStandPrice(
  panelCount: number,
  standType: keyof typeof STANDARD_STAND_RATES_PKR,
) {
  const rule = STANDARD_STAND_RATES_PKR[standType];
  const standCount = Math.ceil(Math.max(0, panelCount) / rule.panelsPerStand);
  return { standCount, totalPricePkr: standCount * rule.ratePerStand };
}
