/**
 * Lowest valid current listed supplier price selection.
 * CEO purchasing discount is NEVER applied — public listed price = website price.
 *
 * Commercial selection is availability-aware: when any valid priced non-sold_out
 * offer exists, that pool wins. Otherwise the lowest valid sold_out offer wins.
 * websitePricePkr, selectedSupplier, default source and availability must all
 * come from this single winner.
 */
import type { SupplierAvailability, SupplierCode } from "../suppliers/adapterTypes.ts";

export type PricedOffer = {
  supplier: SupplierCode;
  sourceKey: string;
  canonicalUrl: string;
  title: string;
  currentListedPricePkr: number | null;
  parseStatus: string;
  availability: SupplierAvailability;
  fetchedAt: string;
};

export type PriceSelection =
  | {
      ok: true;
      pricePkr: number;
      supplier: SupplierCode;
      sourceKey: string;
      canonicalUrl: string;
      availability: SupplierAvailability;
      reason: string;
      considered: Array<{ supplier: SupplierCode; pricePkr: number }>;
    }
  | {
      ok: false;
      reason: string;
    };

export type LastValidCommercial = {
  pricePkr: number;
  observedAt: string;
  supplier: SupplierCode;
  availability: SupplierAvailability;
  sourceKey: string;
  /** True when sourceKey came from the documented legacy fallback. */
  legacyFallback?: boolean;
};

export type ResolvedCommercial = {
  pricePkr: number | null;
  supplier: SupplierCode | null;
  sourceKey: string | null;
  availability: SupplierAvailability | null;
  rolledBack: boolean;
  reason: string;
};

const SUPPLIER_TIEBREAK: SupplierCode[] = ["kamal", "alladin"];

export function isValidListedPrice(
  price: number | null | undefined,
  parseStatus: string,
): price is number {
  return (
    parseStatus === "ok" &&
    typeof price === "number" &&
    Number.isFinite(price) &&
    price > 0
  );
}

function pickDeterministicWinner(
  pool: Array<PricedOffer & { currentListedPricePkr: number }>,
): PricedOffer & { currentListedPricePkr: number } {
  let best = pool[0]!;
  for (const o of pool.slice(1)) {
    if (o.currentListedPricePkr < best.currentListedPricePkr) {
      best = o;
      continue;
    }
    if (o.currentListedPricePkr !== best.currentListedPricePkr) continue;
    if (o.sourceKey < best.sourceKey) {
      best = o;
      continue;
    }
    if (o.sourceKey > best.sourceKey) continue;
    const bi = SUPPLIER_TIEBREAK.indexOf(best.supplier);
    const oi = SUPPLIER_TIEBREAK.indexOf(o.supplier);
    if (oi >= 0 && (bi < 0 || oi < bi)) best = o;
  }
  return best;
}

/**
 * Single commercial selector for website price, supplier, default source and
 * availability. Prefer non-sold_out priced offers when any exist.
 */
export function selectLowestValidPrice(offers: PricedOffer[]): PriceSelection {
  const valid = offers.filter((o) =>
    isValidListedPrice(o.currentListedPricePkr, o.parseStatus),
  ) as Array<PricedOffer & { currentListedPricePkr: number }>;

  if (!valid.length) {
    return { ok: false, reason: "no_valid_listed_price" };
  }

  const available = valid.filter((o) => o.availability !== "sold_out");
  const pool = available.length > 0 ? available : valid;
  const best = pickDeterministicWinner(pool);

  let reason: string;
  if (available.length > 0 && valid.some((o) => o.availability === "sold_out")) {
    reason = "lowest_available_preferred_over_sold_out";
  } else if (available.length === 0) {
    reason =
      valid.length === 1
        ? `single_sold_out_${best.supplier}`
        : `lowest_sold_out_of_${valid.length}_suppliers`;
  } else if (valid.length === 1) {
    reason = `single_supplier_${best.supplier}`;
  } else {
    reason = `lowest_of_${valid.length}_suppliers`;
  }

  return {
    ok: true,
    pricePkr: best.currentListedPricePkr,
    supplier: best.supplier,
    sourceKey: best.sourceKey,
    canonicalUrl: best.canonicalUrl,
    availability: best.availability,
    reason,
    considered: pool.map((v) => ({
      supplier: v.supplier,
      pricePkr: v.currentListedPricePkr,
    })),
  };
}

/**
 * Daily customer-price rule approved by the business:
 * 1. use an exact, in-stock Kamal observation when available;
 * 2. otherwise use an exact, in-stock Alladin observation;
 * 3. fail closed when neither supplier has a valid in-stock price.
 *
 * Multiple observations from the same supplier are resolved deterministically
 * by price and source key. No markup or purchasing discount is applied.
 */
export function selectKamalFirstInStockPrice(
  offers: PricedOffer[],
): PriceSelection {
  const validInStock = offers.filter(
    (offer) =>
      offer.availability === "in_stock" &&
      isValidListedPrice(offer.currentListedPricePkr, offer.parseStatus),
  ) as Array<PricedOffer & { currentListedPricePkr: number }>;

  const kamal = validInStock.filter((offer) => offer.supplier === "kamal");
  const alladin = validInStock.filter((offer) => offer.supplier === "alladin");
  const pool = kamal.length > 0 ? kamal : alladin;
  if (!pool.length) {
    return { ok: false, reason: "no_valid_in_stock_preferred_supplier_price" };
  }

  const best = pickDeterministicWinner(pool);
  return {
    ok: true,
    pricePkr: best.currentListedPricePkr,
    supplier: best.supplier,
    sourceKey: best.sourceKey,
    canonicalUrl: best.canonicalUrl,
    availability: best.availability,
    reason:
      best.supplier === "kamal"
        ? "kamal_first_in_stock"
        : "alladin_fallback_in_stock",
    considered: validInStock.map((offer) => ({
      supplier: offer.supplier,
      pricePkr: offer.currentListedPricePkr,
    })),
  };
}

/**
 * If incoming selection is invalid, keep last valid commercial snapshot (rollback).
 * Price, supplier, availability and default sourceKey stay internally consistent.
 */
export function resolvePriceWithRollback(
  selection: PriceSelection,
  lastValid: LastValidCommercial | null,
): ResolvedCommercial {
  if (selection.ok) {
    return {
      pricePkr: selection.pricePkr,
      rolledBack: false,
      supplier: selection.supplier,
      sourceKey: selection.sourceKey,
      availability: selection.availability,
      reason: selection.reason,
    };
  }
  if (lastValid) {
    return {
      pricePkr: lastValid.pricePkr,
      rolledBack: true,
      supplier: lastValid.supplier,
      sourceKey: lastValid.sourceKey,
      availability: lastValid.availability,
      reason: `rollback_last_valid:${selection.reason}`,
    };
  }
  return {
    pricePkr: null,
    rolledBack: false,
    supplier: null,
    sourceKey: null,
    availability: null,
    reason: selection.reason,
  };
}

export type ListingCommercialSnapshot = {
  identityKey: string;
  lastValidPricePkr: number;
  lastValidObservationAt: string;
  lastValidSupplier: SupplierCode;
  lastValidSourceKey?: string | null;
  lastValidAvailability?: SupplierAvailability | null;
  availability: SupplierAvailability;
  offers: Array<{
    supplier: SupplierCode;
    pricePkr: number | null;
    url: string;
    availability: SupplierAvailability;
    sourceKey?: string;
  }>;
};

/**
 * Return the exact stored last-valid commercial snapshot when present.
 *
 * Legacy fallback (rows without snapshot columns / null snapshot fields):
 * 1. price/supplier/observedAt from existing last_valid_* columns
 * 2. availability from lastValidAvailability, else listing.availability
 * 3. sourceKey from a matching offer's persisted `sourceKey` when present
 * 4. otherwise documented non-adapter surrogate `legacy:{supplier}:{identityKey}`
 *    — never reconstructed from supplier+URL
 */
export function lastValidCommercialFromListing(
  previous: ListingCommercialSnapshot,
): LastValidCommercial {
  const pricePkr = previous.lastValidPricePkr;
  const supplier = previous.lastValidSupplier;
  const observedAt = previous.lastValidObservationAt;
  const storedKey =
    typeof previous.lastValidSourceKey === "string"
      ? previous.lastValidSourceKey.trim()
      : "";
  const storedAvail = previous.lastValidAvailability;

  if (storedKey && storedAvail) {
    return {
      pricePkr,
      observedAt,
      supplier,
      availability: storedAvail,
      sourceKey: storedKey,
      legacyFallback: false,
    };
  }

  const offerWithKey = previous.offers.find(
    (o) =>
      o.supplier === supplier &&
      o.pricePkr === pricePkr &&
      typeof o.sourceKey === "string" &&
      o.sourceKey.trim().length > 0,
  );
  const availability = storedAvail ?? previous.availability;
  if (offerWithKey?.sourceKey) {
    return {
      pricePkr,
      observedAt,
      supplier,
      availability,
      sourceKey: offerWithKey.sourceKey.trim(),
      legacyFallback: !storedKey || !storedAvail,
    };
  }

  return {
    pricePkr,
    observedAt,
    supplier,
    availability,
    sourceKey: `legacy:${supplier}:${previous.identityKey}`,
    legacyFallback: true,
  };
}
