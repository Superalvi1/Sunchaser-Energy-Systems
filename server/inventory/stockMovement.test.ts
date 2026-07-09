import assert from "node:assert/strict";
import { createInventorySku } from "./InventoryItem.ts";
import {
  buildReservationMovement,
  buildReservationReleaseMovement,
  buildTransferMovements,
  movementDelta,
  validateStockMovement,
} from "./StockMovement.ts";
import type { StockBalanceKey } from "./InventoryModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const key: StockBalanceKey = { companyId: "c1", warehouseId: "w1", binId: "b1", skuId: "s1" };
const sku = createInventorySku({
  id: "s1", companyId: "c1", skuCode: "SKU-1", name: "Item", description: "", unitOfMeasure: "each",
  trackSerial: false, trackBatch: false, valuationMethod: "weighted_average", reorderLevel: 0, allowNegativeStock: false, active: true,
});

check("movementDelta stock_in positive", movementDelta("stock_in", 10) === 10);
check("movementDelta stock_out negative", movementDelta("stock_out", 10) === -10);
check("movementDelta transfer_out negative", movementDelta("transfer_out", 5) === -5);
check("movementDelta transfer_in positive", movementDelta("transfer_in", 5) === 5);
check("movementDelta adjustment signed", movementDelta("adjustment", -3) === -3);
check("movementDelta reservation negative", movementDelta("reservation", 2) === -2);
check("movementDelta reservation_release positive", movementDelta("reservation_release", 2) === 2);
check("movementDelta opening_stock positive", movementDelta("opening_stock", 1) === 1);
check("movementDelta goods_receipt positive", movementDelta("goods_receipt", 7) === 7);

const stockIn = validateStockMovement(sku, 0, {
  key, movementType: "stock_in", quantity: 50, referenceType: "in", referenceId: "r1", actorId: "a", entryId: "e1",
});
check("stock in valid", stockIn.ok === true);
if (stockIn.ok) check("stock in after qty", stockIn.quantityAfter === 50);

const stockOut = validateStockMovement(sku, 50, {
  key, movementType: "stock_out", quantity: 30, referenceType: "out", referenceId: "r2", actorId: "a", entryId: "e2",
});
check("stock out valid", stockOut.ok === true);
if (stockOut.ok) check("stock out after qty", stockOut.quantityAfter === 20);

const negDenied = validateStockMovement(sku, 10, {
  key, movementType: "stock_out", quantity: 20, referenceType: "out", referenceId: "r3", actorId: "a", entryId: "e3",
});
check("negative stock denied", !negDenied.ok && negDenied.reason === "negative_stock_not_allowed");

const negAllowed = validateStockMovement(
  createInventorySku({ ...sku, allowNegativeStock: true, skuCode: "NEG" }),
  10,
  { key, movementType: "stock_out", quantity: 20, referenceType: "out", referenceId: "r4", actorId: "a", entryId: "e4" }
);
check("negative stock allowed on sku", negAllowed.ok === true);

const zeroQty = validateStockMovement(sku, 10, {
  key, movementType: "stock_in", quantity: 0, referenceType: "in", referenceId: "r5", actorId: "a", entryId: "e5",
});
check("zero quantity rejected", !zeroQty.ok);

const serialSku = createInventorySku({ ...sku, trackSerial: true, skuCode: "SER" });
const serialFrac = validateStockMovement(serialSku, 5, {
  key, movementType: "stock_out", quantity: 0.5, referenceType: "out", referenceId: "r6", actorId: "a", entryId: "e6",
});
check("serial fractional denied", !serialFrac.ok);

const transfer = buildTransferMovements(sku, 100, {
  companyId: "c1", skuId: "s1", quantity: 25,
  from: { warehouseId: "w1", binId: "b1" },
  to: { warehouseId: "w2", binId: "b2" },
  referenceId: "t1", actorId: "a", outEntryId: "to1", inEntryId: "ti1",
});
check("transfer builds legs", !("ok" in transfer));
if (!("ok" in transfer)) {
  check("transfer out type", transfer.out.movementType === "transfer_out");
  check("transfer in type", transfer.transferIn.movementType === "transfer_in");
}

const sameLoc = buildTransferMovements(sku, 100, {
  companyId: "c1", skuId: "s1", quantity: 5,
  from: { warehouseId: "w1", binId: "b1" },
  to: { warehouseId: "w1", binId: "b1" },
  referenceId: "t2", actorId: "a", outEntryId: "to2", inEntryId: "ti2",
});
check("same location transfer denied", "ok" in sameLoc && sameLoc.reason === "transfer_source_equals_destination");

const res = buildReservationMovement({ key, quantity: 10, referenceId: "res-1", actorId: "a", entryId: "re1" });
check("reservation movement type", res.movementType === "reservation");

const rel = buildReservationReleaseMovement({ key, quantity: 10, referenceId: "res-1", actorId: "a", entryId: "re2" });
check("reservation release type", rel.movementType === "reservation_release");

const adj = validateStockMovement(sku, 50, {
  key, movementType: "adjustment", quantity: -5, referenceType: "adj", referenceId: "a1", actorId: "a", entryId: "adj1",
});
check("adjustment negative delta", adj.ok === true);

console.log(`\nstockMovement.test.ts: ${pass} passed`);
