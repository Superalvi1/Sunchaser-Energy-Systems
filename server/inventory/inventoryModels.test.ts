import assert from "node:assert/strict";
import {
  INVENTORY_DEFAULT_TIMESTAMP,
  isNonEmptyString,
  isStockMovementType,
  isUnitOfMeasure,
  normalizeSkuCode,
  safeNumber,
  stockBalanceKeyString,
  STOCK_MOVEMENT_TYPES,
  UNITS_OF_MEASURE,
  VALUATION_METHODS,
} from "./InventoryModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("INVENTORY_DEFAULT_TIMESTAMP is deterministic", INVENTORY_DEFAULT_TIMESTAMP === "1970-01-01T00:00:00.000Z");
check("UNITS_OF_MEASURE includes each", UNITS_OF_MEASURE.includes("each"));
check("UNITS_OF_MEASURE includes kg", UNITS_OF_MEASURE.includes("kg"));
check("VALUATION_METHODS includes weighted_average", VALUATION_METHODS.includes("weighted_average"));
check("VALUATION_METHODS includes fifo", VALUATION_METHODS.includes("fifo"));
check("STOCK_MOVEMENT_TYPES includes opening_stock", STOCK_MOVEMENT_TYPES.includes("opening_stock"));
check("STOCK_MOVEMENT_TYPES includes goods_receipt", STOCK_MOVEMENT_TYPES.includes("goods_receipt"));
check("STOCK_MOVEMENT_TYPES includes reservation_release", STOCK_MOVEMENT_TYPES.includes("reservation_release"));

check("isNonEmptyString true for text", isNonEmptyString("abc"));
check("isNonEmptyString false for blank", !isNonEmptyString("   "));
check("isNonEmptyString false for number", !isNonEmptyString(42));

check("safeNumber parses integer", safeNumber("10") === 10);
check("safeNumber parses float", safeNumber("10.5") === 10.5);
check("safeNumber fallback on NaN", safeNumber("x", 7) === 7);
check("safeNumber fallback on Infinity", safeNumber(Infinity, 3) === 3);

check("normalizeSkuCode uppercases", normalizeSkuCode(" sku-1 ") === "SKU-1");
check("isUnitOfMeasure valid", isUnitOfMeasure("piece"));
check("isUnitOfMeasure invalid", !isUnitOfMeasure("ton"));
check("isStockMovementType valid", isStockMovementType("stock_in"));
check("isStockMovementType invalid", !isStockMovementType("invalid"));

check(
  "stockBalanceKeyString deterministic",
  stockBalanceKeyString({ companyId: "c1", warehouseId: "w1", binId: "b1", skuId: "s1" }) === "c1|w1|b1|s1"
);

for (const uom of UNITS_OF_MEASURE) {
  check(`UOM ${uom} recognized`, isUnitOfMeasure(uom));
}

for (const mt of STOCK_MOVEMENT_TYPES) {
  check(`movement type ${mt} recognized`, isStockMovementType(mt));
}

console.log(`\ninventoryModels.test.ts: ${pass} passed`);
