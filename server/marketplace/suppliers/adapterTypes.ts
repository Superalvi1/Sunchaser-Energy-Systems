/**
 * Adapter-neutral supplier observation contract (WS4).
 * Phase 1 live access uses authorized Shopify storefront products.json
 * (`shopify_storefront_products_json`) and remains preview/publication-gated.
 */

export type SupplierCode = "kamal" | "alladin";

export type SupplierAvailability =
  | "in_stock"
  | "sold_out"
  | "backorder"
  | "unknown";

export type SupplierParseStatus = "ok" | "malformed" | "missing";

export type AdapterFailureClass =
  | "timeout"
  | "unauthorized"
  | "not_configured"
  | "parse_error"
  | "transport_error"
  | "disabled";

/** Structured identity evidence — never invent selectors/credentials. */
export type SupplierIdentityEvidence = {
  supplierProductId?: string;
  supplierVariantId?: string | null;
  supplierSku?: string | null;
  normalizedExactModel?: string;
  supplierUrl?: string | null;
  notes?: string[];
};

export type NormalizedSupplierObservation = {
  supplierCode: SupplierCode;
  mappingId: string;
  productId: string;
  variantId: string;
  observedAt: string;
  supplierPublicPrice: number | null;
  currency: string;
  availability: SupplierAvailability;
  parseStatus: SupplierParseStatus;
  evidence: SupplierIdentityEvidence & Record<string, unknown>;
};

export type AdapterFetchResult =
  | { ok: true; observation: NormalizedSupplierObservation }
  | {
      ok: false;
      failureClass: AdapterFailureClass;
      message: string;
      mappingId: string;
      supplierCode: SupplierCode;
      productId: string;
      variantId: string;
    };

export type SupplierMappingRow = {
  id: string;
  supplierId: string;
  supplierCode: SupplierCode;
  productId: string;
  variantId: string;
  supplierProductId: string;
  supplierVariantId: string | null;
  supplierSku: string | null;
  normalizedExactModel: string;
  matchConfidence: "exact" | "likely" | "uncertain" | "conflict";
  matchLocked: boolean;
  active: boolean;
  supplierUrl: string | null;
  matchEvidence: Record<string, unknown>;
};

export type SupplierAdapter = {
  readonly code: SupplierCode;
  /** Live adapters must return false until authorized access is configured. */
  isLiveEnabled(env?: NodeJS.ProcessEnv): boolean;
  fetchObservation(
    mapping: SupplierMappingRow,
    opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
  ): Promise<AdapterFetchResult>;
};

export const WS4_JOB_NAME = "marketplace_supplier_price_check";

export const EVIDENCE_BLOCKER_VARIANT_IDS = [
  "mpvar_ws1_inverex_nitrox_10kw_hybrid",
  "mpvar_ws1_pylontech_us5000_4_8kwh",
  "mpvar_ws1_inverex_lv2_6_lithium",
  "mpvar_ws1_fronus_meta_10kw_ongrid",
] as const;
