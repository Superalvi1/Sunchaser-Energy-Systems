/**
 * Deterministic default-variant planning for CEO auto-import.
 *
 * DB invariant (mp_assert_product_exactly_one_default): every product must have
 * exactly one variant with (is_default AND active). Auto-import creates one
 * variant per listing; that variant must remain the sole active default.
 * sold_out is represented via stock_status — never by deactivating the default.
 */
import { createHash } from "node:crypto";
import type { SupplierAvailability, SupplierCode } from "../suppliers/adapterTypes.ts";
import type { UpsertListingInput } from "./autoImportRepository.ts";
import type { PricedOffer } from "./priceSelect.ts";
import { selectLowestValidPrice } from "./priceSelect.ts";

export type PlannedDefaultVariant = {
  isDefault: boolean;
  active: boolean;
  stockStatus: SupplierAvailability;
  selectedSupplier: SupplierCode;
  sourceKey: string;
};

export type DefaultVariantDiagnostics = {
  identityKeyHash: string;
  variantCount: number;
  activeVariantCount: number;
  defaultVariantCount: number;
  supplierClass: SupplierCode | "mixed" | "none";
};

export class AutoImportDefaultVariantError extends Error {
  readonly code = "DEFAULT_VARIANT_REQUIRED" as const;
  readonly diagnostics: DefaultVariantDiagnostics;
  constructor(message: string, diagnostics: DefaultVariantDiagnostics) {
    super(message);
    this.name = "AutoImportDefaultVariantError";
    this.diagnostics = diagnostics;
  }
}

const SUPPLIER_TIEBREAK: SupplierCode[] = ["kamal", "alladin"];

/** Stable short hash for logs — never log raw identity keys with payload risk. */
export function hashIdentityKey(identityKey: string): string {
  return createHash("sha256").update(identityKey).digest("hex").slice(0, 16);
}

export function supplierClassOf(
  offers: Array<{ supplier: SupplierCode }>,
): DefaultVariantDiagnostics["supplierClass"] {
  const set = new Set(offers.map((o) => o.supplier));
  if (set.size === 0) return "none";
  if (set.size === 1) return [...set][0]!;
  return "mixed";
}

/**
 * Default-offer identity is the same commercial winner as website price /
 * selectedSupplier (selectLowestValidPrice). Never diverges on sold_out vs stock.
 */
export function selectDefaultOffer(offers: PricedOffer[]): {
  ok: true;
  offer: PricedOffer & { currentListedPricePkr: number };
  reason: string;
} | { ok: false; reason: string } {
  const selection = selectLowestValidPrice(offers);
  if (!selection.ok) {
    return { ok: false, reason: selection.reason };
  }
  const offer = offers.find((o) => o.sourceKey === selection.sourceKey);
  if (
    !offer ||
    typeof offer.currentListedPricePkr !== "number" ||
    !Number.isFinite(offer.currentListedPricePkr)
  ) {
    return { ok: false, reason: "commercial_offer_missing" };
  }
  return {
    ok: true,
    offer: offer as PricedOffer & { currentListedPricePkr: number },
    reason: selection.reason,
  };
}

export function buildPlannedDefaultVariant(input: {
  availability: SupplierAvailability;
  selectedSupplier: SupplierCode;
  sourceKey: string;
}): PlannedDefaultVariant {
  return {
    isDefault: true,
    active: true,
    stockStatus: input.availability,
    selectedSupplier: input.selectedSupplier,
    sourceKey: input.sourceKey,
  };
}

/** Count planned defaults for one listing (auto-import: always one variant). */
export function countPlannedDefaults(defaults: PlannedDefaultVariant[]): {
  variantCount: number;
  activeVariantCount: number;
  defaultVariantCount: number;
} {
  const variantCount = defaults.length;
  const activeVariantCount = defaults.filter((d) => d.active).length;
  const defaultVariantCount = defaults.filter((d) => d.isDefault && d.active).length;
  return { variantCount, activeVariantCount, defaultVariantCount };
}

/**
 * Normalize to exactly one active default after grouping/dedup/rejection.
 * - Zero defaults among active candidates → promote lowest sourceKey active
 * - Multiple defaults → keep lowest sourceKey
 * - Inactive-only pool → null (do not fabricate)
 */
export function normalizeToSingleActiveDefault(
  candidates: PlannedDefaultVariant[],
): PlannedDefaultVariant | null {
  const activeDefaults = candidates.filter((c) => c.isDefault && c.active);
  const activeAny = candidates.filter((c) => c.active);
  const pool = activeDefaults.length > 0 ? activeDefaults : activeAny;
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => {
    if (a.sourceKey < b.sourceKey) return -1;
    if (a.sourceKey > b.sourceKey) return 1;
    const ai = SUPPLIER_TIEBREAK.indexOf(a.selectedSupplier);
    const bi = SUPPLIER_TIEBREAK.indexOf(b.selectedSupplier);
    return ai - bi;
  });
  const winner = sorted[0]!;
  return {
    isDefault: true,
    active: true,
    stockStatus: winner.stockStatus,
    selectedSupplier: winner.selectedSupplier,
    sourceKey: winner.sourceKey,
  };
}

export type ValidatedListingPlan = UpsertListingInput & {
  defaultVariant: PlannedDefaultVariant;
};

function diagnosticsFor(
  listing: Pick<UpsertListingInput, "identityKey" | "selectedSupplier" | "offers">,
  counts: ReturnType<typeof countPlannedDefaults>,
): DefaultVariantDiagnostics {
  return {
    identityKeyHash: hashIdentityKey(listing.identityKey),
    variantCount: counts.variantCount,
    activeVariantCount: counts.activeVariantCount,
    defaultVariantCount: counts.defaultVariantCount,
    supplierClass:
      listing.offers.length > 0
        ? supplierClassOf(listing.offers)
        : listing.selectedSupplier,
  };
}

/**
 * Fail closed before commitBatch: every listing must plan exactly one active
 * default variant. Throws AutoImportDefaultVariantError with sanitized diagnostics.
 */
export function assertBatchDefaultVariantInvariant(
  listings: ValidatedListingPlan[],
): void {
  for (const listing of listings) {
    const defaults = [listing.defaultVariant];
    const counts = countPlannedDefaults(defaults);
    const diagnostics = diagnosticsFor(listing, counts);
    if (
      counts.variantCount !== 1 ||
      counts.activeVariantCount !== 1 ||
      counts.defaultVariantCount !== 1 ||
      listing.defaultVariant.isDefault !== true ||
      listing.defaultVariant.active !== true
    ) {
      throw new AutoImportDefaultVariantError(
        `DEFAULT_VARIANT_REQUIRED: planned product ${diagnostics.identityKeyHash} must have exactly one active default variant (variants=${counts.variantCount}, active=${counts.activeVariantCount}, defaults=${counts.defaultVariantCount}, supplier=${diagnostics.supplierClass})`,
        diagnostics,
      );
    }
  }
}

/** Attach / normalize defaultVariant on each planned listing (post-dedup). */
export function attachDefaultVariants(
  listings: UpsertListingInput[],
): ValidatedListingPlan[] {
  return listings.map((listing) => {
    const existing = listing.defaultVariant;
    const built =
      existing ??
      buildPlannedDefaultVariant({
        availability: listing.availability,
        selectedSupplier: listing.selectedSupplier,
        sourceKey: listing.defaultSourceKey ?? listing.identityKey,
      });
    const normalized = normalizeToSingleActiveDefault([built]);
    if (!normalized) {
      throw new AutoImportDefaultVariantError(
        `DEFAULT_VARIANT_REQUIRED: no active valid variant for ${hashIdentityKey(listing.identityKey)}`,
        {
          identityKeyHash: hashIdentityKey(listing.identityKey),
          variantCount: 0,
          activeVariantCount: 0,
          defaultVariantCount: 0,
          supplierClass:
            listing.offers.length > 0
              ? supplierClassOf(listing.offers)
              : listing.selectedSupplier,
        },
      );
    }
    return { ...listing, defaultVariant: normalized };
  });
}
