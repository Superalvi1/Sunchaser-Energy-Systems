/**
 * Lowest valid current listed supplier price selection.
 * CEO purchasing discount is NEVER applied — public listed price = website price.
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

export function selectLowestValidPrice(offers: PricedOffer[]): PriceSelection {
  const valid = offers.filter((o) =>
    isValidListedPrice(o.currentListedPricePkr, o.parseStatus),
  ) as Array<PricedOffer & { currentListedPricePkr: number }>;

  if (!valid.length) {
    return { ok: false, reason: "no_valid_listed_price" };
  }

  let best = valid[0]!;
  for (const o of valid.slice(1)) {
    if (o.currentListedPricePkr < best.currentListedPricePkr) {
      best = o;
      continue;
    }
    if (o.currentListedPricePkr === best.currentListedPricePkr) {
      const bi = SUPPLIER_TIEBREAK.indexOf(best.supplier);
      const oi = SUPPLIER_TIEBREAK.indexOf(o.supplier);
      if (oi >= 0 && (bi < 0 || oi < bi)) best = o;
    }
  }

  const reason =
    valid.length === 1
      ? `single_supplier_${best.supplier}`
      : `lowest_of_${valid.length}_suppliers`;

  return {
    ok: true,
    pricePkr: best.currentListedPricePkr,
    supplier: best.supplier,
    sourceKey: best.sourceKey,
    canonicalUrl: best.canonicalUrl,
    availability: best.availability,
    reason,
    considered: valid.map((v) => ({
      supplier: v.supplier,
      pricePkr: v.currentListedPricePkr,
    })),
  };
}

/**
 * If incoming selection is invalid, keep last valid observation (rollback).
 */
export function resolvePriceWithRollback(
  selection: PriceSelection,
  lastValid: { pricePkr: number; observedAt: string; supplier: SupplierCode } | null,
): {
  pricePkr: number | null;
  rolledBack: boolean;
  supplier: SupplierCode | null;
  reason: string;
} {
  if (selection.ok) {
    return {
      pricePkr: selection.pricePkr,
      rolledBack: false,
      supplier: selection.supplier,
      reason: selection.reason,
    };
  }
  if (lastValid) {
    return {
      pricePkr: lastValid.pricePkr,
      rolledBack: true,
      supplier: lastValid.supplier,
      reason: `rollback_last_valid:${selection.reason}`,
    };
  }
  return {
    pricePkr: null,
    rolledBack: false,
    supplier: null,
    reason: selection.reason,
  };
}
