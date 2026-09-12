/**
 * Idempotent website → CRM product sync.
 * Never deletes. Failed / partial discovery leaves previous catalog intact.
 */

import type { Product } from "../../types";
import { WEBSITE_CATALOG_SOURCE } from "./allowlist";
import { readSettingsObject } from "../autoSizer/companyPresets";
import {
  liftWebsiteSourceFields,
  normalizeIdentityKey,
  normalizeText,
  toCrmProduct,
  withWebsiteSourceMetadata,
  WEBSITE_SOURCE_SPEC_KEY,
  type NormalizedWebsiteProduct,
} from "./normalize";

export const WEBSITE_CATALOG_SETTINGS_KEY = "websiteCatalogSync";

export interface WebsiteCatalogSyncReport {
  discovered: number;
  added: number;
  updated: number;
  unchanged: number;
  inactive: number;
  errors: string[];
  lastSyncedAt: string | null;
  lastStatus: "success" | "failed" | "idle";
  source: "next_rsc_shop";
  discoveryComplete: boolean;
  discoveryUsable: boolean;
  deactivationSafe: boolean;
  sitemapAvailable?: boolean;
  persistedCount?: number;
}

export interface WebsiteCatalogSyncResult {
  products: Product[];
  productsToPersist: Product[];
  changedProductIds: string[];
  report: WebsiteCatalogSyncReport;
}

export interface WebsiteCatalogSyncOptions {
  discoveryUsable: boolean;
  deactivationSafe: boolean;
  sitemapAvailable?: boolean;
  syncedAt: string;
  parseErrors?: string[];
  protectedSlugs?: string[];
  /** @deprecated use discoveryUsable */
  discoveryComplete?: boolean;
}

function isWebsiteProduct(product: Product): boolean {
  const lifted = liftWebsiteSourceFields(product);
  return lifted.source === WEBSITE_CATALOG_SOURCE || String(lifted.id || "").startsWith("web_");
}

function brandModelKey(brand: string, model: string): string {
  const b = normalizeIdentityKey(brand);
  const m = normalizeIdentityKey(model);
  if (!b || !m) return "";
  return `${b}::${m}`;
}

export function findExistingCatalogIndex(existing: Product[], incoming: NormalizedWebsiteProduct): number {
  const slug = incoming.sourceSlug;
  const sourceProductId = incoming.sourceProductId;
  const sku = incoming.sku;
  const bm = brandModelKey(incoming.brand, incoming.model);
  let brandModelFallback = -1;
  for (let i = 0; i < existing.length; i += 1) {
    const row = liftWebsiteSourceFields(existing[i]);
    if (row.source === WEBSITE_CATALOG_SOURCE && row.sourceSlug === slug) return i;
    if (row.source === WEBSITE_CATALOG_SOURCE && sourceProductId && row.sourceProductId === sourceProductId) return i;
    if (bm && brandModelKey(row.brand, row.model) === bm) {
      if (brandModelFallback < 0) brandModelFallback = i;
    }
    const skuMatches = sku && row.sku === sku;
    if (skuMatches && row.source === WEBSITE_CATALOG_SOURCE) return i;
    if (skuMatches && bm && brandModelKey(row.brand, row.model) === bm) return i;
  }
  return brandModelFallback;
}

function technicalSpecifications(product: Product): Record<string, string> {
  const specs = product.specifications && typeof product.specifications === "object" ? { ...product.specifications } : {};
  delete (specs as Record<string, unknown>)[WEBSITE_SOURCE_SPEC_KEY];
  return specs;
}

export function catalogFingerprint(product: Product): string {
  const lifted = liftWebsiteSourceFields(product);
  return JSON.stringify({
    name: lifted.name,
    brand: lifted.brand,
    model: lifted.model,
    sku: lifted.sku,
    price: lifted.price,
    listPrice: lifted.listPrice,
    category: lifted.category,
    warrantyPeriod: lifted.warrantyPeriod,
    images: lifted.images,
    availability: lifted.availability,
    sourceActive: lifted.sourceActive !== false,
    specifications: technicalSpecifications(lifted),
  });
}

export function applyWebsiteCatalogSync(
  existingProducts: Product[] | null | undefined,
  discovered: NormalizedWebsiteProduct[],
  options: WebsiteCatalogSyncOptions
): WebsiteCatalogSyncResult {
  const existing = (existingProducts || []).map((p) => liftWebsiteSourceFields({ ...p }));
  const errors = [...(options.parseErrors || [])];
  const discoveryUsable = options.discoveryUsable ?? options.discoveryComplete ?? discovered.length > 0;
  const deactivationSafe = Boolean(options.deactivationSafe);
  const emptyReport = (status: WebsiteCatalogSyncReport["lastStatus"]): WebsiteCatalogSyncResult => ({
    products: existing,
    productsToPersist: [],
    changedProductIds: [],
    report: {
      discovered: discovered.length,
      added: 0,
      updated: 0,
      unchanged: existing.length,
      inactive: 0,
      errors,
      lastSyncedAt: existing.find((p) => p.lastSyncedAt)?.lastSyncedAt || null,
      lastStatus: status,
      source: "next_rsc_shop",
      discoveryComplete: discoveryUsable,
      discoveryUsable,
      deactivationSafe,
      sitemapAvailable: options.sitemapAvailable,
    },
  });

  if (!discoveryUsable) {
    errors.push("Website catalog discovery did not complete. Previous catalog left intact.");
    return emptyReport("failed");
  }

  const next = existing.slice();
  const persistIds = new Set<string>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const protectedSlugs = new Set((options.protectedSlugs || []).filter(Boolean));

  for (const incoming of discovered) {
    try {
      const index = findExistingCatalogIndex(next, incoming);
      if (index >= 0) {
        const prev = next[index];
        const merged = toCrmProduct(incoming, prev);
        const wasInactive = prev.sourceActive === false;
        if (!wasInactive && catalogFingerprint(prev) === catalogFingerprint(merged)) {
          next[index] = prev;
          unchanged += 1;
        } else {
          next[index] = merged;
          persistIds.add(merged.id);
          updated += 1;
        }
      } else {
        const created = toCrmProduct(incoming);
        next.unshift(created);
        persistIds.add(created.id);
        added += 1;
      }
    } catch (err: any) {
      errors.push(`${incoming.sourceSlug}: ${err?.message || "normalize failed"}`);
      if (incoming.sourceSlug) protectedSlugs.add(incoming.sourceSlug);
    }
  }

  let inactive = 0;
  if (deactivationSafe && discovered.length > 0) {
    const discoveredSlugs = new Set(discovered.map((p) => p.sourceSlug));
    for (let i = 0; i < next.length; i += 1) {
      const row = liftWebsiteSourceFields(next[i]);
      if (!isWebsiteProduct(row)) continue;
      const slug = row.sourceSlug || "";
      if (slug && (discoveredSlugs.has(slug) || protectedSlugs.has(slug))) continue;
      if (row.sourceActive === false) continue;
      const inactivated = withWebsiteSourceMetadata(row, { sourceActive: false });
      next[i] = inactivated;
      persistIds.add(inactivated.id);
      inactive += 1;
    }
  }

  const productsToPersist = next.filter((p) => persistIds.has(p.id));
  return {
    products: next,
    productsToPersist,
    changedProductIds: [...persistIds],
    report: {
      discovered: discovered.length,
      added,
      updated,
      unchanged,
      inactive,
      errors,
      lastSyncedAt: options.syncedAt,
      lastStatus: discoveryUsable ? "success" : "failed",
      source: "next_rsc_shop",
      discoveryComplete: discoveryUsable,
      discoveryUsable,
      deactivationSafe,
      sitemapAvailable: options.sitemapAvailable,
    },
  };
}

export function emptyWebsiteCatalogReport(): WebsiteCatalogSyncReport {
  return {
    discovered: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    inactive: 0,
    errors: [],
    lastSyncedAt: null,
    lastStatus: "idle",
    source: "next_rsc_shop",
    discoveryComplete: false,
    discoveryUsable: false,
    deactivationSafe: false,
  };
}

export function patchLatestSettingsWithWebsiteCatalogSync(
  latestSettings: unknown,
  report: WebsiteCatalogSyncReport
): Record<string, any> {
  const latest = readSettingsObject(latestSettings);
  return { ...latest, [WEBSITE_CATALOG_SETTINGS_KEY]: report };
}

export function resolveWebsiteCatalogSyncBaseline(
  localProducts: Product[] | null | undefined,
  localSettings: unknown,
  supabaseActive: boolean,
  latestState?: { products?: Product[] | null; settings?: unknown } | null
): { products: Product[]; settings: unknown } {
  const local = Array.isArray(localProducts) ? localProducts.map((p) => liftWebsiteSourceFields({ ...p })) : [];
  if (!supabaseActive || !latestState) return { products: local, settings: localSettings };
  return {
    products: Array.isArray(latestState.products)
      ? latestState.products.map((p) => liftWebsiteSourceFields({ ...p }))
      : local,
    settings: latestState.settings ?? localSettings,
  };
}

export function applyWebsiteCatalogPersistenceFailure(
  report: WebsiteCatalogSyncReport,
  errorMessage: string,
  extra?: { persistedCount?: number; attemptedCount?: number }
): WebsiteCatalogSyncReport {
  const errors = [...(report.errors || [])];
  errors.push(errorMessage);
  if (extra?.attemptedCount != null && extra.persistedCount != null && extra.persistedCount < extra.attemptedCount) {
    errors.push(`Partial persistence: ${extra.persistedCount}/${extra.attemptedCount} website catalog rows wrote before failure.`);
  }
  return {
    ...report,
    lastStatus: "failed",
    errors,
    persistedCount: extra?.persistedCount,
  };
}

export function isSelectableCatalogProduct(product: Product | null | undefined): boolean {
  if (!product?.id) return false;
  const lifted = liftWebsiteSourceFields(product);
  if (lifted.sourceActive === false) return false;
  if ((lifted as any).deletedAt || (lifted as any).isDeleted) return false;
  return true;
}

export function websiteSyncedFirst(products: Product[] | null | undefined): Product[] {
  const list = (products || []).map((p) => liftWebsiteSourceFields(p)).filter(isSelectableCatalogProduct);
  const website: Product[] = [];
  const other: Product[] = [];
  for (const product of list) {
    if (product.source === WEBSITE_CATALOG_SOURCE) website.push(product);
    else other.push(product);
  }
  return [...website, ...other];
}

export function productsForType(products: Product[] | null | undefined, type: NormalizedWebsiteProduct["productType"]): Product[] {
  return websiteSyncedFirst(products).filter((p) => {
    if (p.productType === type) return true;
    const cat = normalizeText(p.category).toLowerCase();
    if (type === "panel") return /panel/.test(cat);
    if (type === "inverter") return /inverter/.test(cat);
    if (type === "battery") return /batter/.test(cat);
    if (type === "package") return /package|system/.test(cat);
    if (type === "structure") return /structure/.test(cat);
    if (type === "cable") return /cable/.test(cat);
    if (type === "protection") return /protect|breaker|spd/.test(cat);
    return /accessor|meter|controller/.test(cat);
  });
}

export function productsForBrand(products: Product[] | null | undefined, brand: string): Product[] {
  const key = normalizeIdentityKey(brand);
  if (!key) return products || [];
  return (products || []).filter((p) => normalizeIdentityKey(p.brand) === key);
}