/**
 * Normalize first-party website products into CRM catalog rows.
 * Do not invent missing specifications — only copy or extract when present.
 */

import type { Product } from "../../types";
import { WEBSITE_CATALOG_SOURCE, websiteProductUrl } from "./allowlist";
import type { WebsiteRawProduct } from "./parseShopCatalog";

export type CrmProductType =
  | "panel"
  | "inverter"
  | "battery"
  | "cable"
  | "accessory"
  | "protection"
  | "structure"
  | "package";

export const WEBSITE_SOURCE_SPEC_KEY = "_sunchaserWebsite";

export interface NormalizedWebsiteProduct {
  id: string;
  name: string;
  category: string;
  productType: CrmProductType;
  brand: string;
  model: string;
  sku: string;
  price: number;
  listPrice: number;
  currency: string;
  discount: number;
  stock: number;
  images: string[];
  warrantyPeriod: string;
  specifications: Record<string, string>;
  description: string;
  availability: string;
  websiteCategory: string;
  source: typeof WEBSITE_CATALOG_SOURCE;
  sourceUrl: string;
  sourceSlug: string;
  sourceProductId: string;
  sourceActive: boolean;
  lastSyncedAt: string;
  panelWattage?: number;
  inverterKw?: number;
  inverterType?: string;
  batteryKwh?: number;
  batteryVoltage?: number;
  batteryChemistry?: string;
}

const CATEGORY_MAP: Array<{ slugs: string[]; type: CrmProductType; category: string }> = [
  { slugs: ["solar-panels", "solar-panel", "panels", "panel"], type: "panel", category: "Solar Panels" },
  { slugs: ["solar-inverter", "hybrid-solar-inverter", "inverter", "inverters"], type: "inverter", category: "Inverters" },
  { slugs: ["lithium-battery", "battery", "batteries"], type: "battery", category: "Batteries" },
  { slugs: ["solar-structure", "structure"], type: "structure", category: "Structure" },
  { slugs: ["protection", "circuit-breaker", "spd", "zero-export-device"], type: "protection", category: "Protection" },
  { slugs: ["cables", "cable", "cable-gland"], type: "cable", category: "Cables" },
  { slugs: ["package", "packages", "complete-system", "solar-system"], type: "package", category: "Packages" },
  { slugs: ["charge-controller", "energy-meter"], type: "accessory", category: "Accessories" },
];

export function normalizeText(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeIdentityKey(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function firstNumber(patterns: RegExp[], text: string): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const num = Number(match[1]);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return undefined;
}

export function extractKnownSpecs(title: string, specs: Record<string, unknown>, categorySlug: string) {
  const specText = Object.entries(specs || {})
    .map(([k, v]) => `${k} ${v}`)
    .join(" ");
  const hay = `${title} ${specText} ${categorySlug}`;
  const panelWattage = firstNumber([/(\d+(?:\.\d+)?)\s*w(?:att)?s?\b/i], hay);
  const inverterKw = firstNumber([/(\d+(?:\.\d+)?)\s*kw\b/i], hay);
  const batteryKwh = firstNumber([/(\d+(?:\.\d+)?)\s*kwh\b/i], hay);
  const batteryVoltage = firstNumber([/(\d+(?:\.\d+)?)\s*v(?:olts?)?\b/i], hay);
  const chemistryMatch = hay.match(/\b(lifepo4|li-ion|lithium|nmc|lfp)\b/i);
  const ipMatch = hay.match(/\bip\s*(\d{2})\b/i);
  const mpptMatch = hay.match(/\b(\d+)\s*mppt/i);
  const inverterTypeMatch = hay.match(/\b(hybrid|off[-\s]?grid|on[-\s]?grid)\b/i);
  return {
    panelWattage,
    inverterKw,
    batteryKwh,
    batteryVoltage,
    batteryChemistry: chemistryMatch ? chemistryMatch[1] : undefined,
    ipRating: ipMatch ? `IP${ipMatch[1]}` : undefined,
    mppt: mpptMatch ? mpptMatch[1] : undefined,
    inverterType: inverterTypeMatch ? inverterTypeMatch[1] : undefined,
  };
}

export function resolveWebsiteProductType(
  categorySlug: string,
  title: string,
  tags?: string
): { type: CrmProductType; category: string } {
  const slug = normalizeIdentityKey(categorySlug);
  const hay = `${categorySlug} ${title} ${tags || ""}`.toLowerCase();
  if (/\b(complete\s+system|solar\s+package|system\s+package)\b/.test(hay)) {
    return { type: "package", category: "Packages" };
  }
  for (const row of CATEGORY_MAP) {
    if (row.slugs.some((s) => normalizeIdentityKey(s) === slug)) return { type: row.type, category: row.category };
  }
  if (/\bcable|\bgland|\bwire/.test(hay)) return { type: "cable", category: "Cables" };
  if (/\bpanel|\bmodule/.test(hay)) return { type: "panel", category: "Solar Panels" };
  if (/\binverter/.test(hay)) return { type: "inverter", category: "Inverters" };
  if (/\bbatter/.test(hay)) return { type: "battery", category: "Batteries" };
  if (/\bstructure|\bmount/.test(hay)) return { type: "structure", category: "Structure" };
  if (/\bprotect|\bbreaker|\bspd/.test(hay)) return { type: "protection", category: "Protection" };
  return { type: "accessory", category: "Accessories" };
}

function modelFromTitle(title: string, brand: string): string {
  const trimmed = normalizeText(title);
  const brandNorm = normalizeText(brand);
  if (brandNorm && trimmed.toLowerCase().startsWith(brandNorm.toLowerCase())) {
    return normalizeText(trimmed.slice(brandNorm.length).replace(/^[\s\-–]+/, "")) || trimmed;
  }
  return trimmed;
}

export function websiteCatalogProductId(slug: string): string {
  const clean = normalizeText(slug).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `web_${clean}`.slice(0, 120);
}

export function normalizeWebsiteProduct(raw: WebsiteRawProduct, syncedAt: string): NormalizedWebsiteProduct {
  const slug = normalizeText(raw.slug);
  const title = normalizeText(raw.title);
  const brand = normalizeText(raw.brand);
  const mapped = resolveWebsiteProductType(raw.categorySlug || "", title, raw.tags);
  const specsIn = raw.specifications && typeof raw.specifications === "object" ? raw.specifications : {};
  const extracted = extractKnownSpecs(title, specsIn, raw.categorySlug || "");
  const images = [
    ...((raw.image && [raw.image]) || []),
    ...((Array.isArray(raw.images) && raw.images) || []),
  ]
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .filter((url, i, arr) => arr.indexOf(url) === i);

  const specifications: Record<string, string> = {};
  for (const [key, value] of Object.entries(specsIn)) {
    if (key.startsWith("_")) continue;
    const text = normalizeText(value);
    if (text) specifications[key] = text;
  }
  if (raw.description) specifications.description = normalizeText(raw.description);
  if (extracted.panelWattage) specifications.panelWattage = String(extracted.panelWattage);
  if (extracted.inverterKw) specifications.inverterKw = String(extracted.inverterKw);
  if (extracted.batteryKwh) specifications.batteryKwh = String(extracted.batteryKwh);
  if (extracted.batteryVoltage) specifications.batteryVoltage = String(extracted.batteryVoltage);
  if (extracted.batteryChemistry) specifications.batteryChemistry = extracted.batteryChemistry;
  if (extracted.ipRating) specifications.ipRating = extracted.ipRating;
  if (extracted.mppt) specifications.mppt = extracted.mppt;
  if (extracted.inverterType) specifications.inverterType = extracted.inverterType;

  const sku = normalizeText(raw.sku) || `SC-WEB-${slug.slice(-12).toUpperCase()}`;
  const price = Number.isFinite(Number(raw.price)) ? Number(raw.price) : 0;
  const listPrice = Number.isFinite(Number(raw.originalPrice)) ? Number(raw.originalPrice) : 0;
  const availability = normalizeText(raw.stockStatus) || "unknown";
  const sourceBlob = {
    source: WEBSITE_CATALOG_SOURCE,
    sourceUrl: websiteProductUrl(slug),
    sourceSlug: slug,
    sourceProductId: sku,
    lastSyncedAt: syncedAt,
    sourceActive: true,
    websiteCategory: raw.categorySlug || "",
    currency: "PKR",
    listPrice,
    availability,
    productType: mapped.type,
  };
  specifications[WEBSITE_SOURCE_SPEC_KEY] = JSON.stringify(sourceBlob);

  return {
    id: websiteCatalogProductId(slug),
    name: title,
    category: mapped.category,
    productType: mapped.type,
    brand,
    model: modelFromTitle(title, brand),
    sku,
    price,
    listPrice,
    currency: "PKR",
    discount: 0,
    stock: 0,
    images,
    warrantyPeriod: normalizeText(raw.warranty),
    specifications,
    description: normalizeText(raw.description),
    availability,
    websiteCategory: raw.categorySlug || "",
    source: WEBSITE_CATALOG_SOURCE,
    sourceUrl: websiteProductUrl(slug),
    sourceSlug: slug,
    sourceProductId: sku,
    sourceActive: true,
    lastSyncedAt: syncedAt,
    panelWattage: mapped.type === "panel" ? extracted.panelWattage : undefined,
    inverterKw: mapped.type === "inverter" ? extracted.inverterKw : undefined,
    inverterType: mapped.type === "inverter" ? extracted.inverterType : undefined,
    batteryKwh: mapped.type === "battery" ? extracted.batteryKwh : undefined,
    batteryVoltage: mapped.type === "battery" ? extracted.batteryVoltage : undefined,
    batteryChemistry: mapped.type === "battery" ? extracted.batteryChemistry : undefined,
  };
}

export type WebsiteSourceMetadata = {
  source?: string;
  sourceUrl?: string;
  sourceSlug?: string;
  sourceProductId?: string;
  lastSyncedAt?: string;
  sourceActive?: boolean;
  websiteCategory?: string;
  currency?: string;
  listPrice?: number;
  availability?: string;
  productType?: Product["productType"];
};

export function readWebsiteSourceBlob(product: Partial<Product> | null | undefined): WebsiteSourceMetadata {
  const specs = product?.specifications && typeof product.specifications === "object" ? product.specifications : {};
  const raw = (specs as Record<string, unknown>)[WEBSITE_SOURCE_SPEC_KEY];
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? (parsed as WebsiteSourceMetadata) : {};
  } catch {
    return {};
  }
}

export function withWebsiteSourceMetadata(product: Product, patch: WebsiteSourceMetadata = {}): Product {
  const current = {
    source: product.source,
    sourceUrl: product.sourceUrl,
    sourceSlug: product.sourceSlug,
    sourceProductId: product.sourceProductId,
    lastSyncedAt: product.lastSyncedAt,
    sourceActive: product.sourceActive,
    websiteCategory: product.websiteCategory,
    currency: product.currency,
    listPrice: product.listPrice,
    availability: product.availability,
    productType: product.productType,
    ...readWebsiteSourceBlob(product),
    ...patch,
  };
  const next: Product = {
    ...product,
    source: current.source,
    sourceUrl: current.sourceUrl,
    sourceSlug: current.sourceSlug,
    sourceProductId: current.sourceProductId,
    lastSyncedAt: current.lastSyncedAt,
    sourceActive: current.sourceActive,
    websiteCategory: current.websiteCategory,
    currency: current.currency,
    listPrice: current.listPrice,
    availability: current.availability,
    productType: current.productType,
    specifications: {
      ...(typeof product.specifications === "object" && product.specifications ? product.specifications : {}),
      [WEBSITE_SOURCE_SPEC_KEY]: JSON.stringify({
        source: current.source || WEBSITE_CATALOG_SOURCE,
        sourceUrl: current.sourceUrl || "",
        sourceSlug: current.sourceSlug || "",
        sourceProductId: current.sourceProductId || "",
        lastSyncedAt: current.lastSyncedAt || "",
        sourceActive: current.sourceActive !== false,
        websiteCategory: current.websiteCategory || "",
        currency: current.currency || "PKR",
        listPrice: current.listPrice ?? 0,
        availability: current.availability || "",
        productType: current.productType,
      }),
    },
  };
  return next;
}

export function toCrmProduct(normalized: NormalizedWebsiteProduct, existing?: Partial<Product>): Product {
  const existingStock = Number(existing?.stock);
  const product: Product = {
    id: existing?.id || normalized.id,
    name: normalized.name,
    category: normalized.category,
    brand: normalized.brand,
    model: normalized.model,
    sku: normalized.sku,
    price: normalized.price,
    discount: existing?.discount ?? normalized.discount,
    stock: Number.isFinite(existingStock) ? existingStock : 0,
    images: normalized.images,
    warrantyPeriod: normalized.warrantyPeriod || existing?.warrantyPeriod || "",
    specifications: {
      ...(typeof existing?.specifications === "object" && existing.specifications ? existing.specifications : {}),
      ...normalized.specifications,
    },
    installationRequired: existing?.installationRequired ?? false,
    serviceRequired: existing?.serviceRequired ?? false,
    source: normalized.source,
    sourceUrl: normalized.sourceUrl,
    sourceSlug: normalized.sourceSlug,
    sourceProductId: normalized.sourceProductId,
    lastSyncedAt: normalized.lastSyncedAt,
    sourceActive: true,
    websiteCategory: normalized.websiteCategory,
    currency: normalized.currency,
    listPrice: normalized.listPrice,
    availability: normalized.availability,
    productType: normalized.productType,
  };
  return withWebsiteSourceMetadata(product, {
    source: normalized.source,
    sourceUrl: normalized.sourceUrl,
    sourceSlug: normalized.sourceSlug,
    sourceProductId: normalized.sourceProductId,
    lastSyncedAt: normalized.lastSyncedAt,
    sourceActive: true,
    websiteCategory: normalized.websiteCategory,
    currency: normalized.currency,
    listPrice: normalized.listPrice,
    availability: normalized.availability,
    productType: normalized.productType,
  });
}

export function liftWebsiteSourceFields(product: Product): Product {
  const blob = readWebsiteSourceBlob(product);
  if (!blob || Object.keys(blob).length === 0) return product;
  return {
    ...product,
    source: product.source || blob.source,
    sourceUrl: product.sourceUrl || blob.sourceUrl,
    sourceSlug: product.sourceSlug || blob.sourceSlug,
    sourceProductId: product.sourceProductId || blob.sourceProductId,
    lastSyncedAt: product.lastSyncedAt || blob.lastSyncedAt,
    sourceActive: blob.sourceActive ?? product.sourceActive,
    websiteCategory: product.websiteCategory || blob.websiteCategory,
    currency: product.currency || blob.currency,
    listPrice: product.listPrice ?? blob.listPrice,
    availability: product.availability || blob.availability,
    productType: product.productType || blob.productType,
  };
}
