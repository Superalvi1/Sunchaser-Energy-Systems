/**
 * Idempotent website → CRM product sync.
 * Never deletes. Failed discovery leaves the previous catalog intact.
 */

import type { Product } from "../../types";
import { WEBSITE_CATALOG_SOURCE } from "./allowlist";
import { liftWebsiteSourceFields, normalizeIdentityKey, normalizeText, toCrmProduct, type NormalizedWebsiteProduct } from "./normalize";

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
}

export interface WebsiteCatalogSyncResult {
  products: Product[];
  report: WebsiteCatalogSyncReport;
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

function findExistingIndex(existing: Product[], incoming: NormalizedWebsiteProduct): number {
  const slug = incoming.sourceSlug;
  const sku = incoming.sourceProductId;
  const bm = brandModelKey(incoming.brand, incoming.model);
  let fallback = -1;
  for (let i = 0; i < existing.length; i += 1) {
    const row = liftWebsiteSourceFields(existing[i]);
    if (row.source === WEBSITE_CATALOG_SOURCE && row.sourceSlug === slug) return i;
    if (row.source === WEBSITE_CATALOG_SOURCE && sku && row.sourceProductId === sku) return i;
    if (sku && row.sku === sku) return i;
    if (fallback < 0 && bm && brandModelKey(row.brand, row.model) === bm) fallback = i;
  }
  return fallback;
}

function catalogFingerprint(product: Product): string {
  return JSON.stringify({
    name: product.name,
    brand: product.brand,
    model: product.model,
    sku: product.sku,
    price: product.price,
    listPrice: product.listPrice,
    category: product.category,
    warrantyPeriod: product.warrantyPeriod,
    images: product.images,
    availability: product.availability,
    sourceActive: product.sourceActive !== false,
    specifications: product.specifications,
  });
}

export function applyWebsiteCatalogSync(
  existingProducts: Product[] | null | undefined,
  discovered: NormalizedWebsiteProduct[],
  options: { discoveryComplete: boolean; syncedAt: string; parseErrors?: string[] }
): WebsiteCatalogSyncResult {
  const existing = (existingProducts || []).map((p) => liftWebsiteSourceFields({ ...p }));
  const errors = [...(options.parseErrors || [])];
  const emptyReport = (status: WebsiteCatalogSyncReport["lastStatus"], extra?: Partial<WebsiteCatalogSyncReport>): WebsiteCatalogSyncResult => ({
    products: existing,
    report: {
      discovered: discovered.length,
      added: 0,
      updated: 0,
      unchanged: existing.length,
      inactive: 0,
      errors,
      lastSyncedAt: existing.some((p) => p.lastSyncedAt) ? existing.find((p) => p.lastSyncedAt)?.lastSyncedAt || null : null,
      lastStatus: status,
      source: "next_rsc_shop",
      discoveryComplete: options.discoveryComplete,
      ...extra,
    },
  });

  if (!options.discoveryComplete) {
    errors.push("Website catalog discovery did not complete. Previous catalog left intact.");
    return emptyReport("failed");
  }

  const next = existing.slice();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const incoming of discovered) {
    try {
      const index = findExistingIndex(next, incoming);
      if (index >= 0) {
        const prev = next[index];
        const merged = toCrmProduct(incoming, prev);
        if (catalogFingerprint(prev) === catalogFingerprint(merged)) {
          next[index] = { ...merged, sourceActive: true };
          unchanged += 1;
        } else {
          next[index] = merged;
          updated += 1;
        }
      } else {
        next.unshift(toCrmProduct(incoming));
        added += 1;
      }
    } catch (err: any) {
      errors.push(`${incoming.sourceSlug}: ${err?.message || "normalize failed"}`);
    }
  }

  let inactive = 0;
  if (options.discoveryComplete && discovered.length > 0) {
    const discoveredSlugs = new Set(discovered.map((p) => p.sourceSlug));
    for (let i = 0; i < next.length; i += 1) {
      const row = liftWebsiteSourceFields(next[i]);
      if (!isWebsiteProduct(row)) continue;
      const slug = row.sourceSlug || "";
      if (slug && discoveredSlugs.has(slug)) continue;
      if (row.sourceActive === false) continue;
      next[i] = { ...row, sourceActive: false };
      inactive += 1;
    }
  }

  return {
    products: next,
    report: {
      discovered: discovered.length,
      added,
      updated,
      unchanged,
      inactive,
      errors,
      lastSyncedAt: options.syncedAt,
      lastStatus: errors.length && added + updated === 0 ? "failed" : "success",
      source: "next_rsc_shop",
      discoveryComplete: true,
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
