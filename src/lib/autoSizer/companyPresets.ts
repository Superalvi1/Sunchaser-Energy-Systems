/**
 * Company-level AutoSizer preset overlay.
 *
 * Stored on the existing generic `settings` JSON blob as `autoSizerPresets`.
 * Missing / malformed config always falls back to typed presets.
 */

import {
  AUTOSIZER_PRESET_SIZES_KW,
  type AutoSizerPresetSizeKw,
} from "./presets";

export const AUTOSIZER_SETTINGS_KEY = "autoSizerPresets";

export interface CompanyAutoSizerSizePreset {
  panelProductId?: string;
  inverterProductId?: string;
  batteryProductId?: string;
  dcCableProductId?: string;
  acCableProductId?: string;
  panelBrand?: string;
  panelWattage?: number;
  inverterBrand?: string;
  inverterCapacity?: string;
  /** Hybrid / Off-grid default. On-grid AutoSizer still emits no battery. */
  batteryOption?: string;
  dcCableSize?: string;
  acCableSize?: string;
}

export type CompanyAutoSizerPresets = Partial<
  Record<AutoSizerPresetSizeKw | `${AutoSizerPresetSizeKw}`, CompanyAutoSizerSizePreset>
>;

export interface CatalogProductLike {
  id?: string;
  brand?: string;
  model?: string;
  name?: string;
  category?: string;
  wattageCapacity?: string;
  specifications?: Record<string, unknown>;
}

function asSizeKey(raw: unknown): AutoSizerPresetSizeKw | null {
  const n = Number(raw);
  return (AUTOSIZER_PRESET_SIZES_KW as readonly number[]).includes(n)
    ? (n as AutoSizerPresetSizeKw)
    : null;
}

function cleanText(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim();
  return s ? s : undefined;
}

function cleanPositiveInt(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

function cleanSizePreset(raw: any): CompanyAutoSizerSizePreset {
  const next: CompanyAutoSizerSizePreset = {};
  const panelProductId = cleanText(raw?.panelProductId);
  const inverterProductId = cleanText(raw?.inverterProductId);
  const batteryProductId = cleanText(raw?.batteryProductId);
  const dcCableProductId = cleanText(raw?.dcCableProductId);
  const acCableProductId = cleanText(raw?.acCableProductId);
  const panelBrand = cleanText(raw?.panelBrand);
  const panelWattage = cleanPositiveInt(raw?.panelWattage);
  const inverterBrand = cleanText(raw?.inverterBrand);
  const inverterCapacity = cleanText(raw?.inverterCapacity);
  const batteryOption = cleanText(raw?.batteryOption);
  const dcCableSize = cleanText(raw?.dcCableSize);
  const acCableSize = cleanText(raw?.acCableSize);
  if (panelProductId) next.panelProductId = panelProductId;
  if (inverterProductId) next.inverterProductId = inverterProductId;
  if (batteryProductId) next.batteryProductId = batteryProductId;
  if (dcCableProductId) next.dcCableProductId = dcCableProductId;
  if (acCableProductId) next.acCableProductId = acCableProductId;
  if (panelBrand) next.panelBrand = panelBrand;
  if (panelWattage) next.panelWattage = panelWattage;
  if (inverterBrand) next.inverterBrand = inverterBrand;
  if (inverterCapacity) next.inverterCapacity = inverterCapacity;
  if (batteryOption) next.batteryOption = batteryOption;
  if (dcCableSize) next.dcCableSize = dcCableSize;
  if (acCableSize) next.acCableSize = acCableSize;
  return next;
}

export function readSettingsObject(settings: unknown): Record<string, any> {
  if (!settings) return {};
  if (Array.isArray(settings)) {
    const keyed = settings.find((s: any) => s && (s.key === "global" || s.key === AUTOSIZER_SETTINGS_KEY));
    if (keyed?.key === AUTOSIZER_SETTINGS_KEY && keyed.value && typeof keyed.value === "object") {
      return { [AUTOSIZER_SETTINGS_KEY]: keyed.value };
    }
    if (keyed?.value && typeof keyed.value === "object" && !Array.isArray(keyed.value)) {
      return keyed.value as Record<string, any>;
    }
    return {};
  }
  if (typeof settings === "object") return settings as Record<string, any>;
  return {};
}

export function parseCompanyAutoSizerPresets(settings: unknown): CompanyAutoSizerPresets {
  try {
    const blob = readSettingsObject(settings);
    const raw = blob[AUTOSIZER_SETTINGS_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: CompanyAutoSizerPresets = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const size = asSizeKey(key);
      if (!size || !value || typeof value !== "object") continue;
      out[size] = cleanSizePreset(value);
    }
    return out;
  } catch {
    return {};
  }
}

export function wattageFromCatalogProduct(product: CatalogProductLike | undefined): number | undefined {
  if (!product) return undefined;
  const specW = Number((product.specifications as any)?.wattage);
  if (Number.isFinite(specW) && specW > 0) return specW;
  const cap = String(product.wattageCapacity || product.model || product.name || "");
  const m = cap.match(/(\d{3,4})\s*W/i);
  if (m) return Number(m[1]);
  return undefined;
}

export function capacityFromCatalogProduct(product: CatalogProductLike | undefined): string | undefined {
  if (!product) return undefined;
  const cap = String(product.wattageCapacity || product.model || product.name || "");
  const m = cap.match(/(\d+(?:\.\d+)?)\s*kW/i);
  if (m) return `${m[1]}kW`;
  return cleanText(product.wattageCapacity);
}

export function findCatalogProduct(
  products: CatalogProductLike[] | null | undefined,
  id?: string
): CatalogProductLike | undefined {
  if (!id || !Array.isArray(products)) return undefined;
  return products.find((p) => p && String(p.id) === String(id));
}

export function hydrateCompanySizePreset(
  preset: CompanyAutoSizerSizePreset | undefined,
  products?: CatalogProductLike[] | null
): CompanyAutoSizerSizePreset {
  const base = cleanSizePreset(preset || {});
  const panel = findCatalogProduct(products, base.panelProductId);
  if (panel) {
    base.panelBrand = base.panelBrand || cleanText(panel.brand) || cleanText(panel.name);
    base.panelWattage = base.panelWattage || wattageFromCatalogProduct(panel);
  }
  const inverter = findCatalogProduct(products, base.inverterProductId);
  if (inverter) {
    base.inverterBrand = base.inverterBrand || cleanText(inverter.brand) || cleanText(inverter.name);
    base.inverterCapacity = base.inverterCapacity || capacityFromCatalogProduct(inverter);
  }
  const battery = findCatalogProduct(products, base.batteryProductId);
  if (battery) {
    base.batteryOption =
      base.batteryOption ||
      `${battery.brand || ""} ${battery.model || battery.name || ""}`.trim() ||
      cleanText(battery.wattageCapacity);
  }
  const dc = findCatalogProduct(products, base.dcCableProductId);
  if (dc) {
    base.dcCableSize = base.dcCableSize || cleanText(dc.model) || cleanText(dc.name);
  }
  const ac = findCatalogProduct(products, base.acCableProductId);
  if (ac) {
    base.acCableSize = base.acCableSize || cleanText(ac.model) || cleanText(ac.name);
  }
  return base;
}

export function withAutoSizerPresets(
  settings: unknown,
  presets: CompanyAutoSizerPresets
): Record<string, any> {
  const blob = readSettingsObject(settings);
  return { ...blob, [AUTOSIZER_SETTINGS_KEY]: presets };
}
