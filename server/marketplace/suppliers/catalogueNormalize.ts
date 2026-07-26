/**
 * Normalize Shopify storefront products into catalogue observations.
 */
import type { SupplierAvailability, SupplierParseStatus } from "./adapterTypes.ts";
import { classifySupplierCategory } from "./categoryFilter.ts";
import type { CatalogueProductObservation } from "./liveCatalogueTypes.ts";
import { SHOPIFY_STOREFRONT_PRODUCTS_JSON } from "./liveCatalogueTypes.ts";
import { normalizeSupplierImageUrl } from "./safeHttp.ts";
import {
  SHOPIFY_SUPPLIERS,
  type ShopifyRawProduct,
  type ShopifySupplierConfig,
} from "./shopifyCatalogue.ts";

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.slice(0, 800);
}

export function parseMoneyPkr(raw: unknown): {
  value: number | null;
  status: SupplierParseStatus;
} {
  if (raw == null || raw === "") {
    return { value: null, status: "missing" };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { value: null, status: "malformed" };
    if (raw <= 0) return { value: raw, status: "malformed" };
    return { value: raw, status: "ok" };
  }
  if (typeof raw !== "string") {
    return { value: null, status: "malformed" };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, status: "missing" };
  const cleaned = trimmed.replace(/,/g, "").replace(/[^\d.-]/g, "").trim();
  // Non-empty raw that yields no numeric content is malformed (e.g. "N/A").
  if (!cleaned) return { value: null, status: "malformed" };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, status: "malformed" };
  if (n <= 0) return { value: n, status: "malformed" };
  return { value: n, status: "ok" };
}

function availabilityOf(variant: {
  available?: boolean;
}): SupplierAvailability {
  if (variant.available === true) return "in_stock";
  if (variant.available === false) return "sold_out";
  return "unknown";
}

function pickPrimaryVariant(product: ShopifyRawProduct) {
  const variants = product.variants || [];
  if (!variants.length) return null;
  // Prefer first available variant; never use compare_at as current.
  const available = variants.find((v) => v.available === true);
  return available ?? variants[0];
}

export type NormalizeResult =
  | { ok: true; observation: CatalogueProductObservation }
  | { ok: false; reason: string; productId?: string; title?: string };

export function normalizeShopifyProduct(
  product: ShopifyRawProduct,
  cfg: ShopifySupplierConfig,
  fetchedAt: string,
): NormalizeResult {
  const id = product.id != null ? String(product.id) : "";
  if (!id) {
    return { ok: false, reason: "missing_product_id", title: product.title };
  }

  const categoryDecision = classifySupplierCategory({
    title: product.title,
    productType: product.product_type,
    tags: product.tags,
    vendor: product.vendor,
  });
  if (!categoryDecision.accepted) {
    return {
      ok: false,
      reason: categoryDecision.reason,
      productId: id,
      title: product.title,
    };
  }

  const variant = pickPrimaryVariant(product);
  if (!variant) {
    return {
      ok: false,
      reason: "missing_variant",
      productId: id,
      title: product.title,
    };
  }

  const priceParsed = parseMoneyPkr(variant.price);
  // Never treat compare-at / struck-through as current price.
  const compareParsed = parseMoneyPkr(variant.compare_at_price);
  const compareAt =
    compareParsed.status === "ok" ? compareParsed.value : null;

  let parseStatus: SupplierParseStatus = priceParsed.status;
  let current = priceParsed.value;
  // Suspicious: compare-at lower than current, or absurd values
  if (
    parseStatus === "ok" &&
    current != null &&
    (current > 50_000_000 || (compareAt != null && compareAt > 0 && compareAt < current))
  ) {
    parseStatus = "malformed";
  }

  const handle = String(product.handle || "").trim();
  const canonicalUrl = handle
    ? `${cfg.origin}/products/${handle}`
    : `${cfg.origin}/products/${id}`;

  const imageUrls: string[] = [];
  for (const im of product.images || []) {
    const normalized = normalizeSupplierImageUrl(im?.src);
    if (normalized && !imageUrls.includes(normalized)) {
      imageUrls.push(normalized);
    }
  }
  // Cap additional images retained in evidence
  const primaryImageUrl = imageUrls[0] ?? null;
  const additionalImageUrls = imageUrls.slice(1, 8);

  const sku =
    variant.sku != null && String(variant.sku).trim()
      ? String(variant.sku).trim()
      : null;

  const description = stripHtml(product.body_html);
  const tags = Array.isArray(product.tags)
    ? product.tags.slice(0, 12)
    : typeof product.tags === "string"
      ? product.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];

  const observation: CatalogueProductObservation = {
    supplier: cfg.code,
    supplierProductId: id,
    sourceKey: `${cfg.code}:${id}`,
    title: String(product.title || "").trim() || `product-${id}`,
    brand: product.vendor ? String(product.vendor).trim() : null,
    modelSku: sku,
    category: categoryDecision.normalizedCategory,
    currentListedPricePkr: current,
    compareAtPricePkr: compareAt,
    availability: availabilityOf(variant),
    parseStatus,
    confirmPriceRecommended: cfg.confirmPriceRecommended,
    canonicalUrl,
    primaryImageUrl,
    additionalImageUrls,
    description,
    fetchedAt,
    rawEvidence: {
      source: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
      supplierProductId: id,
      supplierVariantId: variant.id != null ? String(variant.id) : null,
      handle: handle || null,
      productType: product.product_type || null,
      tags,
      variantTitle: variant.title || null,
      listedPriceRaw: variant.price ?? null,
      compareAtPriceRaw: variant.compare_at_price ?? null,
      available: variant.available ?? null,
      imageCount: imageUrls.length,
      // Explicitly do not store full body_html page bodies.
      descriptionChars: description?.length ?? 0,
    },
  };

  return { ok: true, observation };
}

export function normalizeCatalogueProducts(
  supplier: keyof typeof SHOPIFY_SUPPLIERS,
  products: ShopifyRawProduct[],
  fetchedAt = new Date().toISOString(),
): {
  accepted: CatalogueProductObservation[];
  excluded: Array<{ productId?: string; title?: string; reason: string }>;
} {
  const cfg = SHOPIFY_SUPPLIERS[supplier];
  const accepted: CatalogueProductObservation[] = [];
  const excluded: Array<{ productId?: string; title?: string; reason: string }> =
    [];
  for (const product of products) {
    const result = normalizeShopifyProduct(product, cfg, fetchedAt);
    if (result.ok) accepted.push(result.observation);
    else
      excluded.push({
        productId: result.productId,
        title: result.title,
        reason: result.reason,
      });
  }
  return { accepted, excluded };
}
