/**
 * Phase 1 live catalogue observation contracts.
 * Preview-only — never writes website_price / never auto-publishes.
 */
import type {
  SupplierAvailability,
  SupplierCode,
  SupplierParseStatus,
} from "./adapterTypes.ts";

/** Documented authorized access method for both Kamal and Alladin. */
export const SHOPIFY_STOREFRONT_PRODUCTS_JSON =
  "shopify_storefront_products_json" as const;

export const LIVE_CATALOGUE_JOB_NAME = "marketplace_supplier_live_preview";

export const SUPPLIER_MONITOR_USER_AGENT =
  "SunchaserSupplierMonitor/1.0 (+https://sunchaserenergy.co; supplier-catalogue-monitor)";

export type CatalogueProductObservation = {
  supplier: SupplierCode;
  supplierProductId: string;
  sourceKey: string;
  title: string;
  brand: string | null;
  modelSku: string | null;
  category: string | null;
  currentListedPricePkr: number | null;
  compareAtPricePkr: number | null;
  availability: SupplierAvailability;
  parseStatus: SupplierParseStatus;
  confirmPriceRecommended: boolean;
  canonicalUrl: string;
  primaryImageUrl: string | null;
  additionalImageUrls: string[];
  description: string | null;
  fetchedAt: string;
  /** Sanitized evidence — never full page bodies or secrets. */
  rawEvidence: Record<string, unknown>;
};

export type LiveSupplierPreviewStatus = {
  supplier: SupplierCode;
  enabled: boolean;
  accessMethod: string | null;
  ok: boolean;
  failureClass?: string;
  message?: string;
  discovered: number;
  accepted: number;
  excluded: number;
  matched: number;
  unmatched: number;
  validPrices: number;
  invalidPrices: number;
  imagesFound: number;
  warnings: string[];
};

export type LiveCataloguePreviewResult = {
  runId: string;
  status: "succeeded" | "failed" | "partial";
  suppliers: LiveSupplierPreviewStatus[];
  productsDiscovered: number;
  relevantProductsAccepted: number;
  productsExcluded: number;
  matchedProducts: number;
  unmatchedProducts: number;
  invalidPrices: number;
  imageUrlsFound: number;
  warnings: string[];
  errors: string[];
  /** Phase 1 hard-lock */
  productionReady: false;
  publishedCount: 0;
  sample: Array<{
    supplier: SupplierCode;
    title: string;
    brand: string | null;
    category: string | null;
    currentListedPricePkr: number | null;
    compareAtPricePkr: number | null;
    availability: SupplierAvailability;
    confirmPriceRecommended: boolean;
    canonicalUrl: string;
    primaryImageUrl: string | null;
    matched: boolean;
  }>;
  note: string;
};
