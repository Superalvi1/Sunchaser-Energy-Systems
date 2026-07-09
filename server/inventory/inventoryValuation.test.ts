import assert from "node:assert/strict";
import {
  applyWeightedAverageIssue,
  applyWeightedAverageReceipt,
  appendFifoLayer,
  consumeFifoLayers,
  createValuationState,
  inventoryValue,
  valuationKey,
} from "./InventoryValuation.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const base = createValuationState({ companyId: "c1", warehouseId: "w1", skuId: "s1" }, "weighted_average");
check("initial qty zero", base.quantityOnHand === 0);
check("initial avg zero", base.weightedAverageCost === 0);

const after1 = applyWeightedAverageReceipt(base, 100, 10);
check("receipt 100@10 qty", after1.quantityOnHand === 100);
check("receipt 100@10 avg", after1.weightedAverageCost === 10);

const after2 = applyWeightedAverageReceipt(after1, 50, 16);
check("receipt 50@16 qty", after2.quantityOnHand === 150);
check("receipt 50@16 avg", after2.weightedAverageCost === 12);

const after3 = applyWeightedAverageIssue(after2, 50);
check("issue 50 qty", after3.quantityOnHand === 100);
check("issue preserves avg", after3.weightedAverageCost === 12);

const after4 = applyWeightedAverageIssue(after3, 100);
check("issue all qty zero", after4.quantityOnHand === 0);
check("issue all avg zero", after4.weightedAverageCost === 0);

check("inventoryValue", inventoryValue(after2) === 1800);
check("valuationKey", valuationKey(after2) === "c1|w1|s1");

const fifoStore = appendFifoLayer({ layers: [] }, {
  id: "l1", quantity: 10, unitCost: 5, receivedAt: "1970-01-01T00:00:00.000Z", warehouseId: "w1", binId: "b1",
});
check("fifo layer appended", fifoStore.layers.length === 1);

let fifoThrows = false;
try {
  consumeFifoLayers(fifoStore, 5);
} catch (e) {
  fifoThrows = e instanceof Error && e.message.includes("not implemented");
}
check("fifo consume throws", fifoThrows);

check("zero receipt no-op", applyWeightedAverageReceipt(base, 0, 10).quantityOnHand === 0);
check("zero issue no-op", applyWeightedAverageIssue(after2, 0).quantityOnHand === 150);

for (let i = 1; i <= 5; i += 1) {
  const s = applyWeightedAverageReceipt(base, i * 10, i);
  check(`weighted avg iteration ${i}`, s.weightedAverageCost > 0);
}

console.log(`\ninventoryValuation.test.ts: ${pass} passed`);
