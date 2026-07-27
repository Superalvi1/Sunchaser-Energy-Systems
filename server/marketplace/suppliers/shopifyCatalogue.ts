/**
 * Shopify public storefront products.json discovery + pagination.
 * Access method: shopify_storefront_products_json (public, no auth/CAPTCHA).
 *
 * Pagination dedupe: supplier-scoped by `${supplier}:${productId}`.
 * Deterministic quality-aware policy — a later duplicate replaces an earlier
 * record only when it is at least as usable/complete for Phase 1 catalogue
 * purposes. Missing-id rows never replace keyed records. Whole-record
 * selection only (no field-level merge of prices/variants/availability).
 */
import type { SupplierCode } from "./adapterTypes.ts";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  SafeHttpError,
  safeFetchText,
  type SafeFetchOptions,
} from "./safeHttp.ts";
import { SHOPIFY_STOREFRONT_PRODUCTS_JSON } from "./liveCatalogueTypes.ts";

export const SHOPIFY_PAGE_LIMIT = 250;
/** Hard ceiling for exploratory/full catalogue pulls (not used for CEO auto-import HTTP). */
export const SHOPIFY_MAX_PAGES = 40;
/**
 * Auto-import must finish inside the platform request deadline.
 * Live probe (2026-07): Kamal ≈1 page / 144 products; Alladin ≈4 pages / 999 products.
 */
export const SHOPIFY_AUTO_IMPORT_MAX_PAGES = 8;
/** Cap unique products retained per supplier during CEO auto-import. */
export const SHOPIFY_AUTO_IMPORT_MAX_PRODUCTS = 1_200;
/** Cap conflict warnings retained per catalogue fetch. */
export const DEDUPE_WARNING_CAP = 25;

export type ShopifyRawProduct = {
  id: number | string;
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  body_html?: string;
  variants?: Array<{
    id?: number | string;
    title?: string;
    price?: string | number | null;
    compare_at_price?: string | number | null;
    available?: boolean;
    sku?: string | null;
  }>;
  images?: Array<{
    id?: number | string;
    src?: string;
    width?: number;
    height?: number;
    position?: number;
  }>;
};

type ShopifyRawVariant = NonNullable<ShopifyRawProduct["variants"]>[number];

export type ShopifyCataloguePage = {
  products: ShopifyRawProduct[];
};

export type ShopifySupplierConfig = {
  code: SupplierCode;
  origin: string;
  confirmPriceRecommended: boolean;
};

export const SHOPIFY_SUPPLIERS: Record<SupplierCode, ShopifySupplierConfig> = {
  kamal: {
    code: "kamal",
    origin: "https://kamalsolar.pk",
    confirmPriceRecommended: true,
  },
  alladin: {
    code: "alladin",
    origin: "https://alladin.pk",
    confirmPriceRecommended: false,
  },
};

export function buildProductsJsonUrl(
  origin: string,
  page: number,
  limit = SHOPIFY_PAGE_LIMIT,
): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/products.json?limit=${limit}&page=${page}`;
}

export function parseShopifyProductsJson(body: string): ShopifyCataloguePage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new SafeHttpError("HTTP_ERROR", "Invalid JSON catalogue payload.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new SafeHttpError("HTTP_ERROR", "Catalogue payload is not an object.");
  }
  const products = (parsed as { products?: unknown }).products;
  if (!Array.isArray(products)) {
    throw new SafeHttpError("HTTP_ERROR", "Catalogue missing products array.");
  }
  return { products: products as ShopifyRawProduct[] };
}

export function supplierProductSourceKey(
  supplier: SupplierCode,
  productId: string | number,
): string {
  return `${supplier}:${String(productId)}`;
}

function hasUsableProductId(product: ShopifyRawProduct): boolean {
  return product.id != null && String(product.id).trim().length > 0;
}

/**
 * Usable current listed price — mirrors catalogueNormalize.parseMoneyPkr `ok`.
 * Never treats compare_at_price as the current price.
 */
export function isUsableListedPrice(raw: unknown): boolean {
  if (raw == null || raw === "") return false;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0;
  }
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const cleaned = trimmed.replace(/,/g, "").replace(/[^\d.-]/g, "").trim();
  if (!cleaned) return false;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0;
}

function pickPrimaryVariantForQuality(
  product: ShopifyRawProduct,
): ShopifyRawVariant | null {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!variants.length) return null;
  const available = variants.find((v) => v && v.available === true);
  return available ?? variants[0] ?? null;
}

function stripHtmlBrief(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countUsableImages(product: ShopifyRawProduct): number {
  const images = Array.isArray(product.images) ? product.images : [];
  let n = 0;
  for (const im of images) {
    const src = typeof im?.src === "string" ? im.src.trim() : "";
    if (src) n += 1;
  }
  return n;
}

export type ShopifyAvailabilitySignal = "in_stock" | "sold_out" | "unknown";

/**
 * Completeness rank for Phase 1 catalogue dedupe.
 * Compared lexicographically left→right; higher is better.
 * Mandatory axes (variants, current price) come first so incomplete
 * duplicates cannot displace complete ones solely by appearing later.
 */
export type ShopifyProductQuality = {
  rank: readonly [
    usableVariants: number,
    usableCurrentPrice: number,
    usableTitle: number,
    availabilityEvidence: number,
    hasHandle: number,
    hasPrimaryImage: number,
    hasDescription: number,
    hasModelOrVendor: number,
    hasValidCompareAt: number,
    additionalImageCount: number,
    variantCount: number,
  ];
  usableVariants: boolean;
  usableCurrentPrice: boolean;
  currentPriceRaw: string | null;
  availability: ShopifyAvailabilitySignal;
};

export function scoreShopifyProductQuality(
  product: ShopifyRawProduct,
): ShopifyProductQuality {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const usableVariants = variants.length > 0;
  const variant = pickPrimaryVariantForQuality(product);
  const usableCurrentPrice = variant
    ? isUsableListedPrice(variant.price)
    : false;
  // Compare-at is informational completeness only — never a current-price substitute.
  const hasValidCompareAt =
    variant != null && isUsableListedPrice(variant.compare_at_price) ? 1 : 0;

  let availability: ShopifyAvailabilitySignal = "unknown";
  if (variant?.available === true) availability = "in_stock";
  else if (variant?.available === false) availability = "sold_out";

  const title = typeof product.title === "string" ? product.title.trim() : "";
  const usableTitle = title.length > 0 ? 1 : 0;
  const availabilityEvidence =
    availability === "in_stock" || availability === "sold_out" ? 1 : 0;
  const handle =
    typeof product.handle === "string" ? product.handle.trim() : "";
  const hasHandle = handle.length > 0 ? 1 : 0;
  const imageCount = countUsableImages(product);
  const hasPrimaryImage = imageCount > 0 ? 1 : 0;
  const additionalImageCount = Math.min(Math.max(imageCount - 1, 0), 8);
  const description = stripHtmlBrief(
    typeof product.body_html === "string" ? product.body_html : "",
  );
  const hasDescription = description.length > 0 ? 1 : 0;
  const sku =
    variant?.sku != null && String(variant.sku).trim()
      ? String(variant.sku).trim()
      : "";
  const vendor =
    typeof product.vendor === "string" ? product.vendor.trim() : "";
  const hasModelOrVendor = sku || vendor ? 1 : 0;
  const variantCount = Math.min(variants.length, 20);

  return {
    rank: [
      usableVariants ? 1 : 0,
      usableCurrentPrice ? 1 : 0,
      usableTitle,
      availabilityEvidence,
      hasHandle,
      hasPrimaryImage,
      hasDescription,
      hasModelOrVendor,
      hasValidCompareAt,
      additionalImageCount,
      variantCount,
    ],
    usableVariants,
    usableCurrentPrice,
    currentPriceRaw:
      usableCurrentPrice && variant?.price != null
        ? String(variant.price)
        : null,
    availability,
  };
}

/** Positive when `a` is strictly better than `b`; 0 when equivalent. */
export function compareShopifyProductQuality(
  a: ShopifyProductQuality,
  b: ShopifyProductQuality,
): number {
  for (let i = 0; i < a.rank.length; i++) {
    const diff = a.rank[i]! - b.rank[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

export type DedupeResult = {
  products: ShopifyRawProduct[];
  /** Times a sourceKey was seen after the first keep. */
  duplicateCount: number;
  /** Bounded warnings for material conflicts (no raw bodies). */
  warnings: string[];
};

function maybePushWarning(warnings: string[], message: string): void {
  if (warnings.length < DEDUPE_WARNING_CAP) warnings.push(message);
}

/**
 * Deduplicate across pages for a single supplier.
 *
 * Policy (documented + tested):
 * 1. Key = `${supplier}:${shopifyProductId}` (supplier-scoped; Kamal≠Alladin).
 * 2. Quality-aware selection: later duplicate replaces earlier only when its
 *    completeness rank is >= the kept record (mandatory: usable variants and
 *    usable current listed price outweigh later arrival).
 * 3. Equivalent quality → deterministic tie-break: later successfully keyed
 *    record wins (whole record; no field-level merge).
 * 4. Missing product id never replaces a keyed entry.
 * 5. Material price/availability conflicts emit a bounded sanitized warning
 *    (no raw supplier bodies). Compare-at is never treated as current price.
 */
export function dedupeShopifyProducts(
  supplier: SupplierCode,
  products: ShopifyRawProduct[],
): DedupeResult {
  const byKey = new Map<string, ShopifyRawProduct>();
  const qualityByKey = new Map<string, ShopifyProductQuality>();
  let duplicateCount = 0;
  const warnings: string[] = [];

  for (const product of products) {
    if (!hasUsableProductId(product)) {
      // Malformed — cannot key; skip without displacing anything.
      continue;
    }
    const key = supplierProductSourceKey(supplier, product.id);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, product);
      qualityByKey.set(key, scoreShopifyProductQuality(product));
      continue;
    }

    duplicateCount += 1;
    const existingQ = qualityByKey.get(key)!;
    const candidateQ = scoreShopifyProductQuality(product);
    const cmp = compareShopifyProductQuality(candidateQ, existingQ);

    const priceConflict =
      existingQ.usableCurrentPrice &&
      candidateQ.usableCurrentPrice &&
      existingQ.currentPriceRaw != null &&
      candidateQ.currentPriceRaw != null &&
      existingQ.currentPriceRaw !== candidateQ.currentPriceRaw;
    const availabilityConflict =
      existingQ.availability !== "unknown" &&
      candidateQ.availability !== "unknown" &&
      existingQ.availability !== candidateQ.availability;

    // Prefer candidate when strictly better, or when quality is equivalent
    // (deterministic later-successfully-keyed-record tie-break).
    const preferCandidate = cmp >= 0;
    if (preferCandidate) {
      byKey.set(key, product);
      qualityByKey.set(key, candidateQ);
    }

    if (priceConflict) {
      maybePushWarning(
        warnings,
        `${supplier}: duplicate ${key} price conflict ${existingQ.currentPriceRaw} vs ${candidateQ.currentPriceRaw}; keeping ${preferCandidate ? "later" : "earlier"} ${cmp === 0 ? "equivalent-quality" : "higher-quality"} instance.`,
      );
    }
    if (availabilityConflict) {
      maybePushWarning(
        warnings,
        `${supplier}: duplicate ${key} availability conflict ${existingQ.availability} vs ${candidateQ.availability}; keeping ${preferCandidate ? "later" : "earlier"} ${cmp === 0 ? "equivalent-quality" : "higher-quality"} instance.`,
      );
    }
  }

  return {
    products: [...byKey.values()],
    duplicateCount,
    warnings,
  };
}

export type CatalogueFetchDeps = {
  safeFetch?: typeof safeFetchText;
  fetchOpts?: SafeFetchOptions;
  pageLimit?: number;
  maxPages?: number;
  /** Stop after this many unique products (post-page collection, pre-dedupe cap). */
  maxProducts?: number;
  /** Optional page provider for fixture-based tests (page is 1-indexed). */
  pageProvider?: (
    supplier: SupplierCode,
    page: number,
  ) => Promise<string | ShopifyCataloguePage>;
};

export type DiscoveredCatalogue = {
  supplier: SupplierCode;
  accessMethod: typeof SHOPIFY_STOREFRONT_PRODUCTS_JSON;
  origin: string;
  pagesFetched: number;
  /** Unique products after supplier-scoped dedupe. */
  products: ShopifyRawProduct[];
  /** Raw rows seen across pages before dedupe. */
  rawProductRows: number;
  duplicateCount: number;
  dedupeWarnings: string[];
  /** Why pagination stopped (sanitized; no bodies). */
  stopReason:
    | "empty_page"
    | "short_page"
    | "max_pages"
    | "max_products"
    | "repeated_page";
};

function pageFingerprint(products: ShopifyRawProduct[]): string {
  return products
    .map((p) => (p?.id != null ? String(p.id) : ""))
    .filter(Boolean)
    .join(",");
}

export async function fetchShopifyCatalogue(
  supplier: SupplierCode,
  deps: CatalogueFetchDeps = {},
): Promise<DiscoveredCatalogue> {
  const cfg = SHOPIFY_SUPPLIERS[supplier];
  const safeFetch = deps.safeFetch ?? safeFetchText;
  const pageLimit = deps.pageLimit ?? SHOPIFY_PAGE_LIMIT;
  const maxPages = deps.maxPages ?? SHOPIFY_MAX_PAGES;
  const maxProducts = deps.maxProducts ?? Number.POSITIVE_INFINITY;
  const collected: ShopifyRawProduct[] = [];
  let pagesFetched = 0;
  let stopReason: DiscoveredCatalogue["stopReason"] = "max_pages";
  const seenFingerprints = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    let pageData: ShopifyCataloguePage;
    if (deps.pageProvider) {
      const provided = await deps.pageProvider(supplier, page);
      pageData =
        typeof provided === "string"
          ? parseShopifyProductsJson(provided)
          : provided;
    } else {
      const url = buildProductsJsonUrl(cfg.origin, page, pageLimit);
      const res = await safeFetch(url, {
        timeoutMs: DEFAULT_RESPONSE_TIMEOUT_MS,
        maxBytes: DEFAULT_MAX_RESPONSE_BYTES,
        ...deps.fetchOpts,
      });
      pageData = parseShopifyProductsJson(res.body);
    }
    pagesFetched += 1;
    if (!pageData.products.length) {
      stopReason = "empty_page";
      break;
    }

    const fingerprint = pageFingerprint(pageData.products);
    if (fingerprint && seenFingerprints.has(fingerprint)) {
      stopReason = "repeated_page";
      break;
    }
    if (fingerprint) seenFingerprints.add(fingerprint);

    collected.push(...pageData.products);
    if (pageData.products.length < pageLimit) {
      stopReason = "short_page";
      break;
    }
    if (collected.length >= maxProducts) {
      stopReason = "max_products";
      break;
    }
  }

  const capped =
    Number.isFinite(maxProducts) && collected.length > maxProducts
      ? collected.slice(0, maxProducts)
      : collected;
  const deduped = dedupeShopifyProducts(supplier, capped);

  return {
    supplier,
    accessMethod: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    origin: cfg.origin,
    pagesFetched,
    products: deduped.products,
    rawProductRows: collected.length,
    duplicateCount: deduped.duplicateCount,
    dedupeWarnings: deduped.warnings,
    stopReason,
  };
}
