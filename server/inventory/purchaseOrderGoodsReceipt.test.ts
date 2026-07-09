import assert from "node:assert/strict";
import { createPurchaseOrder, purchaseOrderOutstandingQty, purchaseOrderTotalOutstanding } from "./PurchaseOrder.ts";
import { createGoodsReceipt, goodsReceiptTotalQuantity, validateGoodsReceipt } from "./GoodsReceipt.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const po = createPurchaseOrder({
  id: "po-1", companyId: "c1", poNumber: "po-100", supplierName: "ACME", warehouseId: "w1", status: "submitted",
  lines: [
    { id: "l1", skuId: "s1", quantityOrdered: 100, quantityReceived: 30, unitCost: 10 },
    { id: "l2", skuId: "s2", quantityOrdered: 50, quantityReceived: 0, unitCost: 5 },
  ],
});

check("PO number uppercased", po.poNumber === "PO-100");
check("outstanding line 1", purchaseOrderOutstandingQty(po.lines[0]) === 70);
check("outstanding line 2", purchaseOrderOutstandingQty(po.lines[1]) === 50);
check("total outstanding", purchaseOrderTotalOutstanding(po) === 120);

const badPo = createPurchaseOrder({
  id: "po-2", companyId: "c1", poNumber: "po-2", supplierName: "", warehouseId: "w1", status: "draft",
  lines: [{ id: "l1", skuId: "s1", quantityOrdered: 10, quantityReceived: 0, unitCost: 1 }],
});
check("draft PO valid", badPo.status === "draft");

let poInvalid = false;
try {
  createPurchaseOrder({ id: "", companyId: "c1", poNumber: "x", warehouseId: "w1", status: "draft", lines: [] });
} catch {
  poInvalid = true;
}
check("empty PO lines throws", poInvalid);

const grn = createGoodsReceipt({
  id: "grn-1", companyId: "c1", grnNumber: "grn-001", purchaseOrderId: "po-1", warehouseId: "w1", binId: "b1",
  status: "draft", actorId: "admin",
  lines: [{ id: "gl1", purchaseOrderLineId: "l1", skuId: "s1", quantityReceived: 20, unitCost: 10 }],
});
check("GRN number uppercased", grn.grnNumber === "GRN-001");
check("GRN total qty", goodsReceiptTotalQuantity(grn) === 20);

check("validate GRN ok", validateGoodsReceipt({
  id: "g2", companyId: "c1", grnNumber: "G2", purchaseOrderId: "po-1", warehouseId: "w1", binId: "b1",
  status: "posted", actorId: "a", receivedAt: "1970-01-01T00:00:00.000Z",
  lines: [{ id: "gl", purchaseOrderLineId: "l1", skuId: "s1", quantityReceived: 1, unitCost: 1 }],
}).ok);

check("validate GRN no lines fails", !validateGoodsReceipt({
  id: "g3", companyId: "c1", grnNumber: "G3", purchaseOrderId: "po-1", warehouseId: "w1", binId: "b1",
  status: "draft", actorId: "a", receivedAt: "1970-01-01T00:00:00.000Z", lines: [],
}).ok);

console.log(`\npurchaseOrderGoodsReceipt.test.ts: ${pass} passed`);
