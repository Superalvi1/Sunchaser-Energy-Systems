import assert from "node:assert/strict";
import { createStockLedger } from "./StockLedger.ts";
import type { StockBalanceKey } from "./InventoryModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const key: StockBalanceKey = { companyId: "c1", warehouseId: "w1", binId: "b1", skuId: "s1" };

const ledger = createStockLedger();
check("ledger starts empty", ledger.length === 0);

const e1 = ledger.append({
  key,
  movementType: "opening_stock",
  quantityDelta: 100,
  quantityBefore: 0,
  unitCost: 50,
  valuationMethod: "weighted_average",
  referenceType: "opening",
  referenceId: "ref-1",
  actorId: "actor-1",
  entryId: "le-1",
});
check("first entry quantityAfter", e1.quantityAfter === 100);
check("first entry quantityBefore", e1.quantityBefore === 0);
check("first entry delta", e1.quantityDelta === 100);

const e2 = ledger.append({
  key,
  movementType: "stock_out",
  quantityDelta: -20,
  quantityBefore: 100,
  unitCost: 50,
  valuationMethod: "weighted_average",
  referenceType: "out",
  referenceId: "ref-2",
  actorId: "actor-1",
  entryId: "le-2",
});
check("second entry quantityAfter", e2.quantityAfter === 80);

check("ledger length 2", ledger.length === 2);
check("getLatestQuantity", ledger.getLatestQuantity(key) === 80);
check("verifyChain valid", ledger.verifyChain(key) === true);

const broken = createStockLedger();
broken.append({ key, movementType: "stock_in", quantityDelta: 10, quantityBefore: 0, unitCost: 1, valuationMethod: "weighted_average", referenceType: "x", referenceId: "x", actorId: "a", entryId: "x1" });
broken.append({ key, movementType: "stock_out", quantityDelta: -5, quantityBefore: 5, unitCost: 1, valuationMethod: "weighted_average", referenceType: "x", referenceId: "x", actorId: "a", entryId: "x2" });
check("verifyChain detects break", broken.verifyChain(key) === false);

check("list returns copy", ledger.list().length === 2);
check("listByBalanceKey filters", ledger.listByBalanceKey(key).length === 2);
check("listByBalanceKey other key empty", ledger.listByBalanceKey({ ...key, skuId: "other" }).length === 0);

ledger.freeze();
check("frozen ledger", ledger.isFrozen());
let frozenThrew = false;
try {
  ledger.append({ key, movementType: "stock_in", quantityDelta: 1, quantityBefore: 80, unitCost: 1, valuationMethod: "weighted_average", referenceType: "x", referenceId: "x", actorId: "a", entryId: "frozen" });
} catch {
  frozenThrew = true;
}
check("frozen ledger rejects append", frozenThrew);

check("entries are immutable", Object.isFrozen(ledger.list()[0]));

const multi = createStockLedger();
for (let i = 0; i < 10; i += 1) {
  const before = multi.getLatestQuantity(key);
  multi.append({
    key,
    movementType: "stock_in",
    quantityDelta: 5,
    quantityBefore: before,
    unitCost: 10,
    valuationMethod: "weighted_average",
    referenceType: "loop",
    referenceId: `r-${i}`,
    actorId: "a",
    entryId: `loop-${i}`,
  });
}
check("chain after 10 appends", multi.verifyChain(key));
check("quantity after 10x5", multi.getLatestQuantity(key) === 50);

console.log(`\nstockLedger.test.ts: ${pass} passed`);
