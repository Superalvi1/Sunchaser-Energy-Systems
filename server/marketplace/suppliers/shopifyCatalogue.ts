/**
 * Shopify public storefront products.json discovery + pagination.
 * Access method: shopify_storefront_products_json (public, no auth/CAPTCHA).
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
export const SHOPIFY_MAX_PAGES = 40;

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

export type CatalogueFetchDeps = {
  safeFetch?: typeof safeFetchText;
  fetchOpts?: SafeFetchOptions;
  pageLimit?: number;
  maxPages?: number;
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
  products: ShopifyRawProduct[];
};

export async function fetchShopifyCatalogue(
  supplier: SupplierCode,
  deps: CatalogueFetchDeps = {},
): Promise<DiscoveredCatalogue> {
  const cfg = SHOPIFY_SUPPLIERS[supplier];
  const safeFetch = deps.safeFetch ?? safeFetchText;
  const pageLimit = deps.pageLimit ?? SHOPIFY_PAGE_LIMIT;
  const maxPages = deps.maxPages ?? SHOPIFY_MAX_PAGES;
  const products: ShopifyRawProduct[] = [];
  let pagesFetched = 0;

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
    if (!pageData.products.length) break;
    products.push(...pageData.products);
    if (pageData.products.length < pageLimit) break;
  }

  return {
    supplier,
    accessMethod: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
    origin: cfg.origin,
    pagesFetched,
    products,
  };
}
