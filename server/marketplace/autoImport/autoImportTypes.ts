import type { SupplierAvailability, SupplierCode } from "../suppliers/adapterTypes.ts";
import type { VariantIdentity } from "./identityNormalize.ts";

export const CEO_AUTO_IMPORT_JOB_NAME = "marketplace_ceo_auto_import";

export type AutoImportOffer = {
  supplier: SupplierCode;
  sourceKey: string;
  supplierProductId: string;
  title: string;
  brand: string | null;
  modelSku: string | null;
  category: string | null;
  productType: string | null;
  currentListedPricePkr: number | null;
  parseStatus: string;
  availability: SupplierAvailability;
  canonicalUrl: string;
  primaryImageUrl: string | null;
  description: string | null;
  fetchedAt: string;
  identity: VariantIdentity;
  groupKey: string;
  matchReason: string;
};

export type AutoImportListingRecord = {
  identityKey: string;
  productId: string;
  variantId: string;
  slug: string;
  title: string;
  brandName: string;
  categoryName: string;
  websitePricePkr: number;
  availability: SupplierAvailability;
  selectedSupplier: SupplierCode;
  sourceUrls: string[];
  matchReason: string;
  priceReason: string;
  lastSyncedAt: string;
  lastValidPricePkr: number;
  lastValidSupplier: SupplierCode;
  lastValidObservationAt: string;
  lastValidSourceKey: string | null;
  lastValidAvailability: SupplierAvailability | null;
  active: boolean;
  offers: Array<{
    supplier: SupplierCode;
    pricePkr: number | null;
    url: string;
    availability: SupplierAvailability;
    sourceKey?: string;
  }>;
};

export type AutoImportSyncHealth = {
  lastSyncAt: string | null;
  lastSyncStatus: "succeeded" | "failed" | "partial" | "never";
  lastRunId: string | null;
  kamalDiscovered: number;
  alladinDiscovered: number;
  acceptedVariants: number;
  rejectedVariants: number;
  exactMatches: number;
  conflictKeptSeparate: number;
  productsCreated: number;
  productsUpdated: number;
  lowestPriceSelections: number;
  rolledBackPrices: number;
  errors: string[];
  note: string;
};

export type AutoImportSyncResult = {
  runId: string;
  status: "succeeded" | "failed" | "partial";
  health: AutoImportSyncHealth;
  sampleLowestPrice: Array<{
    title: string;
    identityKey: string;
    selectedSupplier: SupplierCode;
    pricePkr: number;
    considered: Array<{ supplier: SupplierCode; pricePkr: number }>;
    reason: string;
  }>;
  /**
   * Explicit pipeline stages. Sync success does NOT imply public website visibility.
   * Stage E (publicWebsiteVisible) is true only when durable persist ran AND the
   * public catalogue router is configured with MARKETPLACE_CATALOGUE_SOURCE=database.
   * Persistence while source=static never publishes the storefront.
   */
  stages: {
    /** A — supplier catalogue observations fetched/normalized */
    observationFetched: boolean;
    /** B — mp_products row created/updated (durable persist path only) */
    catalogueProductCreated: boolean;
    /** C — variant website_price stored (durable persist path only) */
    variantPriceStored: boolean;
    /** D — mp_auto_import_listings upserted (durable persist path only) */
    ceoListingImported: boolean;
    /**
     * E — public catalogue router would expose these synced rows.
     * False whenever effective public source is static (fail-closed default).
     * True only when source=database AND this run performed durable writes.
     */
    publicWebsiteVisible: boolean;
  };
  /** True when this job is authorized to write website_price via CEO RPC (not storefront visibility). */
  automaticPublication: true;
  ceoDiscountApplied: false;
  legacyMappingBypassUsed: false;
};
