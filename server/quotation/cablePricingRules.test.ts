import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import {
  computeCableRunCost,
  DEFAULT_CABLE_WASTAGE_PERCENT,
  isCableRunType,
  sumCableRunCosts,
} from "./CablePricingRules.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("isCableRunType accepts dc_cable", isCableRunType("dc_cable"));
check("isCableRunType accepts ac_cable", isCableRunType("ac_cable"));
check("isCableRunType accepts earth_wire", isCableRunType("earth_wire"));
check("isCableRunType rejects unknown", !isCableRunType("fiber_optic"));

check("DEFAULT_CABLE_WASTAGE_PERCENT is 10", DEFAULT_CABLE_WASTAGE_PERCENT === 10);

check(
  "computeCableRunCost applies default 10% wastage",
  computeCableRunCost({ type: "dc_cable", lengthMeters: 100, pricePerMeter: 10 }).billedLengthMeters === 110
);
check(
  "computeCableRunCost totalCost reflects billed length * price",
  computeCableRunCost({ type: "dc_cable", lengthMeters: 100, pricePerMeter: 10 }).totalCost === 1100
);
check(
  "computeCableRunCost with zero wastage uses raw length",
  computeCableRunCost({ type: "dc_cable", lengthMeters: 100, pricePerMeter: 10, wastagePercent: 0 }).billedLengthMeters === 100
);
check(
  "computeCableRunCost adds accessoryAllowance to totalCost",
  computeCableRunCost({ type: "dc_cable", lengthMeters: 100, pricePerMeter: 10, wastagePercent: 0, accessoryAllowance: 500 }).totalCost ===
    1500
);
check(
  "computeCableRunCost custom wastagePercent is honored",
  computeCableRunCost({ type: "ac_cable", lengthMeters: 50, pricePerMeter: 20, wastagePercent: 20 }).billedLengthMeters === 60
);
check("computeCableRunCost echoes the run type", computeCableRunCost({ type: "earth_wire", lengthMeters: 10, pricePerMeter: 5 }).type === "earth_wire");

check(
  "computeCableRunCost throws for invalid type",
  (() => {
    try {
      computeCableRunCost({ type: "fiber_optic" as never, lengthMeters: 10, pricePerMeter: 5 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "cable_pricing";
    }
  })()
);
check(
  "computeCableRunCost throws for zero lengthMeters",
  (() => {
    try {
      computeCableRunCost({ type: "dc_cable", lengthMeters: 0, pricePerMeter: 5 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeCableRunCost throws for negative lengthMeters",
  (() => {
    try {
      computeCableRunCost({ type: "dc_cable", lengthMeters: -5, pricePerMeter: 5 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeCableRunCost throws for negative pricePerMeter",
  (() => {
    try {
      computeCableRunCost({ type: "dc_cable", lengthMeters: 10, pricePerMeter: -1 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeCableRunCost throws for negative wastagePercent",
  (() => {
    try {
      computeCableRunCost({ type: "dc_cable", lengthMeters: 10, pricePerMeter: 5, wastagePercent: -1 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeCableRunCost throws for negative accessoryAllowance",
  (() => {
    try {
      computeCableRunCost({ type: "dc_cable", lengthMeters: 10, pricePerMeter: 5, accessoryAllowance: -1 });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

check("sumCableRunCosts sums multiple runs", (() => {
  const dc = computeCableRunCost({ type: "dc_cable", lengthMeters: 100, pricePerMeter: 10, wastagePercent: 0 });
  const ac = computeCableRunCost({ type: "ac_cable", lengthMeters: 50, pricePerMeter: 20, wastagePercent: 0 });
  return sumCableRunCosts([dc, ac]) === 2000;
})());
check("sumCableRunCosts returns 0 for empty array", sumCableRunCosts([]) === 0);

console.log(`\nCablePricingRules tests: ${pass} passed`);
