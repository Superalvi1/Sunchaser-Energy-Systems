import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import {
  aggregateMargin,
  computeMargin,
  computeSellPriceForMargin,
  defaultCanViewMargin,
  toMarginSafeView,
} from "./MarginRules.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("computeMargin computes grossProfit", computeMargin({ totalCost: 700, totalPrice: 1000 }).grossProfit === 300);
check("computeMargin computes marginPercent", computeMargin({ totalCost: 700, totalPrice: 1000 }).marginPercent === 30);
check("computeMargin handles zero price without dividing by zero", computeMargin({ totalCost: 0, totalPrice: 0 }).marginPercent === 0);
check("computeMargin handles cost exceeding price (negative margin)", computeMargin({ totalCost: 1200, totalPrice: 1000 }).grossProfit === -200);
check("computeMargin negative margin percent is negative", computeMargin({ totalCost: 1200, totalPrice: 1000 }).marginPercent < 0);
check(
  "computeMargin throws for negative totalCost",
  (() => {
    try {
      computeMargin({ totalCost: -1, totalPrice: 100 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "margin_rules";
    }
  })()
);
check(
  "computeMargin throws for negative totalPrice",
  (() => {
    try {
      computeMargin({ totalCost: 100, totalPrice: -1 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

check("computeSellPriceForMargin: 0% margin returns cost unchanged", computeSellPriceForMargin(1000, 0) === 1000);
check("computeSellPriceForMargin: 20% margin on cost 800 yields 1000", computeSellPriceForMargin(800, 20) === 1000);
check(
  "computeSellPriceForMargin throws for negative cost",
  (() => {
    try {
      computeSellPriceForMargin(-1, 10);
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeSellPriceForMargin throws for margin >= 100",
  (() => {
    try {
      computeSellPriceForMargin(100, 100);
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeSellPriceForMargin throws for negative margin",
  (() => {
    try {
      computeSellPriceForMargin(100, -5);
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

check("defaultCanViewMargin true for Super Admin allauddin", defaultCanViewMargin("Super Admin", "allauddin"));
check("defaultCanViewMargin is case-insensitive on username", defaultCanViewMargin("Super Admin", "ALLAUDDIN"));
check("defaultCanViewMargin false for other Super Admin usernames", !defaultCanViewMargin("Super Admin", "someone-else"));
check("defaultCanViewMargin false for non-Super-Admin role", !defaultCanViewMargin("Sales Manager", "allauddin"));

const margin = computeMargin({ totalCost: 700, totalPrice: 1000 });

check("toMarginSafeView reveals cost fields for a privileged viewer", (() => {
  const view = toMarginSafeView(margin, "Super Admin", "allauddin");
  return view.totalCost === 700 && view.grossProfit === 300 && view.marginPercent === 30;
})());
check("toMarginSafeView hides cost fields for a non-privileged viewer", (() => {
  const view = toMarginSafeView(margin, "Sales Manager", "someone");
  return view.totalCost === undefined && view.grossProfit === undefined && view.marginPercent === undefined;
})());
check("toMarginSafeView always includes totalPrice regardless of privilege", (() => {
  const view = toMarginSafeView(margin, "Sales Manager", "someone");
  return view.totalPrice === 1000;
})());
check("toMarginSafeView honors a custom visibility predicate", (() => {
  const view = toMarginSafeView(margin, "Anyone", "anyone", () => true);
  return view.totalCost === 700;
})());
check("toMarginSafeView custom predicate can also deny", (() => {
  const view = toMarginSafeView(margin, "Super Admin", "allauddin", () => false);
  return view.totalCost === undefined;
})());

check("aggregateMargin sums multiple lines into one margin result", (() => {
  const result = aggregateMargin([
    { cost: 100, price: 150 },
    { cost: 200, price: 250 },
  ]);
  return result.totalCost === 300 && result.totalPrice === 400 && result.grossProfit === 100;
})());
check("aggregateMargin returns zeroed result for empty lines", (() => {
  const result = aggregateMargin([]);
  return result.totalCost === 0 && result.totalPrice === 0 && result.marginPercent === 0;
})());

console.log(`\nMarginRules tests: ${pass} passed`);
