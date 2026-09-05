/**
 * Central solar equipment brand registry.
 * Website / CRM brands always win. Global lists are fallback only.
 * Always include Other / Custom.
 * Do not live-search the internet from the quote modal.
 */

export const OTHER_CUSTOM_BRAND = "Other / Custom";

export const GLOBAL_PANEL_BRANDS = [
  "LONGi",
  "JinkoSolar",
  "JA Solar",
  "Trina Solar",
  "Canadian Solar",
  "Risen",
  "Astronergy",
  "Tongwei / TW Solar",
  "AIKO",
  "DAS Solar",
  "Qcells",
  "REC",
  "Maxeon",
  "Suntech",
  "Seraphim",
  "Yingli",
  "GCL",
] as const;

export const GLOBAL_INVERTER_BRANDS = [
  "Huawei",
  "Sungrow",
  "Solis",
  "GoodWe",
  "Growatt",
  "Deye",
  "FoxESS",
  "SolaX",
  "SAJ",
  "SMA",
  "Fronius",
  "SolarEdge",
  "Victron",
  "Sofar",
  "Kehua",
  "KSTAR",
  "Delta",
  "Sineng",
  "FIMER / ABB",
  "INVT",
  "Hoymiles",
  "APsystems",
  "Solplanet",
  "Inverex",
  "Knox",
  "Nitrox",
  "Itel",
] as const;

export const GLOBAL_BATTERY_BRANDS = [
  "Pylontech",
  "Dyness",
  "BYD",
  "Narada",
  "Huawei",
  "Sungrow",
  "GoodWe",
  "Growatt",
  "FoxESS",
  "SolaX",
  "AlphaESS",
  "Soluna",
  "Sunwoda",
  "HinaESS",
  "LG Energy Solution",
  "Tesla",
  "Enphase",
  "CATL",
  "EVE",
  "Felicity Solar",
  "Knox",
  "Inverex",
] as const;

export type EquipmentBrandKind = "panel" | "inverter" | "battery";

function normalizeBrandKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/solar\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function dedupeBrandList(brands: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of brands) {
    const brand = String(raw || "").trim();
    if (!brand) continue;
    const key = normalizeBrandKey(brand);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(brand);
  }
  return out;
}

export function globalBrandsFor(kind: EquipmentBrandKind): readonly string[] {
  if (kind === "panel") return GLOBAL_PANEL_BRANDS;
  if (kind === "inverter") return GLOBAL_INVERTER_BRANDS;
  return GLOBAL_BATTERY_BRANDS;
}

/**
 * Merge priority: website/CRM brands, then global registry, then Other / Custom.
 */
export function mergeEquipmentBrands(
  kind: EquipmentBrandKind,
  crmOrWebsiteBrands: Array<string | null | undefined>
): string[] {
  const merged = dedupeBrandList([...crmOrWebsiteBrands, ...globalBrandsFor(kind), OTHER_CUSTOM_BRAND]);
  if (!merged.includes(OTHER_CUSTOM_BRAND)) merged.push(OTHER_CUSTOM_BRAND);
  return merged;
}
