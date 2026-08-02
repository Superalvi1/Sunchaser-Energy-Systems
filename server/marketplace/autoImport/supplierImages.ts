/**
 * Sanitize and collect supplier product images for CEO auto-import.
 * Images come only from the commercially selected offer (never cross-supplier mix).
 */
import { createHash } from "node:crypto";
import type { SupplierCode } from "../suppliers/adapterTypes.ts";
import {
  normalizeSupplierImageUrl,
  SUPPLIER_IMAGE_HOSTS,
} from "../suppliers/safeHttp.ts";

export type PlannedProductImage = {
  url: string;
  sortOrder: number;
  isPrimary: boolean;
  /** Selected commercial offer identity (never cross-offer mix). */
  sourceKey: string;
};

const MAX_IMAGES_PER_PRODUCT = 8;

/** Re-export allowlist for catalogue / storefront documentation. */
export const APPROVED_SUPPLIER_IMAGE_HOSTS = SUPPLIER_IMAGE_HOSTS;

export function sanitizeSupplierImageUrl(
  raw: string | null | undefined,
): string | null {
  return normalizeSupplierImageUrl(raw);
}

/**
 * Build deterministic image list for the winning commercial offer only.
 */
export function collectSelectedOfferImages(input: {
  selectedSourceKey: string;
  selectedSupplier: SupplierCode;
  offers: Array<{
    sourceKey: string;
    supplier: SupplierCode;
    primaryImageUrl?: string | null;
    additionalImageUrls?: string[];
  }>;
}): PlannedProductImage[] {
  const primary =
    input.offers.find((o) => o.sourceKey === input.selectedSourceKey) ??
    input.offers.find((o) => o.supplier === input.selectedSupplier) ??
    input.offers[0];
  if (!primary) return [];

  const seen = new Set<string>();
  const urls: string[] = [];
  const push = (raw: string | null | undefined) => {
    const url = sanitizeSupplierImageUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  push(primary.primaryImageUrl ?? null);
  for (const extra of primary.additionalImageUrls ?? []) {
    push(extra);
    if (urls.length >= MAX_IMAGES_PER_PRODUCT) break;
  }

  return urls.slice(0, MAX_IMAGES_PER_PRODUCT).map((url, index) => ({
    url,
    sortOrder: index,
    isPrimary: index === 0,
    sourceKey: primary.sourceKey,
  }));
}

/** Deterministic storage_path for remote CDN rows (required by mp_media). */
export function supplierCdnStoragePath(
  supplier: SupplierCode,
  sourceUrl: string,
): string {
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32);
  return `supplier-cdn/${supplier}/${hash}`;
}
