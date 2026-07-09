import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import {
  applyQuantityTierPricing,
  computeLineTotal,
  resolveApplicableTier,
  sortTiersDescending,
  sumLineTotals,
  type QuantityTierRule,
} from "./PriceRules.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("computeLineTotal multiplies unitPrice by quantity", computeLineTotal({ unitPrice: 100, quantity: 3 }).lineTotal === 300);
check("computeLineTotal handles fractional unitPrice", computeLineTotal({ unitPrice: 99.99, quantity: 2 }).lineTotal === 199.98);
check("computeLineTotal echoes unitPrice and quantity", (() => {
  const r = computeLineTotal({ unitPrice: 50, quantity: 4 });
  return r.unitPrice === 50 && r.quantity === 4;
})());
check(
  "computeLineTotal throws for negative unitPrice",
  (() => {
    try {
      computeLineTotal({ unitPrice: -1, quantity: 1 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "price_rules";
    }
  })()
);
check(
  "computeLineTotal throws for zero quantity",
  (() => {
    try {
      computeLineTotal({ unitPrice: 10, quantity: 0 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeLineTotal throws for negative quantity",
  (() => {
    try {
      computeLineTotal({ unitPrice: 10, quantity: -2 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

const tiers: QuantityTierRule[] = [
  { minQuantity: 10, discountPercent: 5 },
  { minQuantity: 20, discountPercent: 10 },
  { minQuantity: 50, discountPercent: 15 },
];

check("sortTiersDescending orders by minQuantity descending", sortTiersDescending(tiers)[0].minQuantity === 50);
check("sortTiersDescending does not mutate the input array", (() => {
  const copy = [...tiers];
  sortTiersDescending(tiers);
  return tiers[0].minQuantity === copy[0].minQuantity;
})());

check("resolveApplicableTier returns null below the lowest tier", resolveApplicableTier(tiers, 5) === null);
check("resolveApplicableTier returns the lowest tier at its threshold", resolveApplicableTier(tiers, 10)?.discountPercent === 5);
check("resolveApplicableTier returns the middle tier between thresholds", resolveApplicableTier(tiers, 25)?.discountPercent === 10);
check("resolveApplicableTier returns the highest qualifying tier", resolveApplicableTier(tiers, 100)?.discountPercent === 15);
check("resolveApplicableTier returns null for empty tier list", resolveApplicableTier([], 100) === null);

check("applyQuantityTierPricing: no tier applies below threshold", applyQuantityTierPricing(100, 5, tiers).appliedTier === null);
check("applyQuantityTierPricing: unmodified price when no tier applies", applyQuantityTierPricing(100, 5, tiers).effectiveUnitPrice === 100);
check("applyQuantityTierPricing: applies 5% discount at 10 units", applyQuantityTierPricing(100, 10, tiers).effectiveUnitPrice === 95);
check("applyQuantityTierPricing: applies 15% discount at 50 units", applyQuantityTierPricing(100, 50, tiers).effectiveUnitPrice === 85);
check("applyQuantityTierPricing: lineTotal reflects discounted price", applyQuantityTierPricing(100, 50, tiers).lineTotal === 4250);
check(
  "applyQuantityTierPricing throws for negative baseUnitPrice",
  (() => {
    try {
      applyQuantityTierPricing(-1, 10, tiers);
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "applyQuantityTierPricing throws for zero quantity",
  (() => {
    try {
      applyQuantityTierPricing(100, 0, tiers);
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

check("sumLineTotals sums an array of lines", sumLineTotals([{ lineTotal: 100 }, { lineTotal: 50.5 }]) === 150.5);
check("sumLineTotals returns 0 for empty array", sumLineTotals([]) === 0);
check("sumLineTotals coerces non-numeric lineTotal safely", sumLineTotals([{ lineTotal: "garbage" as unknown as number }]) === 0);

console.log(`\nPriceRules tests: ${pass} passed`);
