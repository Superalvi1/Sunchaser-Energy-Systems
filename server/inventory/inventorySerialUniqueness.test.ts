import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { createInventoryEngine } from "./InventoryEngine.ts";
import { createInventoryRepository } from "./InventoryRepository.ts";
import {
  InventoryDuplicateSerialError,
  normalizeSerialNumber,
  serialCompanyLookupKey,
} from "./SerialBatchTracking.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const admin: RequestActor = {
  id: "admin", username: "admin", name: "Admin", email: "a@test.com", role: "Inventory Manager",
  accountStatus: "Active", emailVerified: true, onboardingCompleted: true, authMethod: "jwt",
};

const companyId = "co-serial";
const companyB = "co-other";

function setupEngine(cid: string, skuId: string, poId: string, polId: string) {
  const engine = createInventoryEngine({ repository: createInventoryRepository() });
  engine.registerSku({
    id: skuId, companyId: cid, skuCode: `SER-${skuId}`, name: "Serial SKU", description: "", unitOfMeasure: "each",
    trackSerial: true, trackBatch: false, valuationMethod: "weighted_average", reorderLevel: 0, allowNegativeStock: false, active: true,
  }, admin);
  const whId = `wh-${skuId}`;
  const binId = `bin-${skuId}`;
  engine.registerWarehouse({ id: whId, companyId: cid, code: "MAIN", name: "Main" }, admin);
  engine.registerBin({ id: binId, companyId: cid, warehouseId: whId, zoneId: "z", shelfId: "sh", code: "A01", name: "A01" }, admin);
  engine.createPurchaseOrder({
    id: poId, companyId: cid, poNumber: `PO-${skuId}`, supplierName: "V", warehouseId: whId, status: "submitted",
    lines: [{ id: polId, skuId, quantityOrdered: 10, quantityReceived: 0, unitCost: 10 }],
  }, admin);
  return { engine, whId, binId, poId, polId };
}

check("lookup key uses company and normalized serial", serialCompanyLookupKey("c1", "sn-001") === "c1|SN001");
check("formatting normalizes equivalent", normalizeSerialNumber("SN 001") === normalizeSerialNumber("sn-001"));

const { engine, whId, binId, poId, polId } = setupEngine(companyId, "sku-s", "po-s", "pol-s");

const grn1 = engine.postGoodsReceipt({
  id: "grn-a", companyId, grnNumber: "GRN-A", purchaseOrderId: poId, warehouseId: whId, binId,
  status: "draft", actorId: admin.id,
  lines: [{ id: "gl-a", purchaseOrderLineId: polId, skuId: "sku-s", quantityReceived: 1, unitCost: 10, serialNumbers: ["SN-001"] }],
}, admin);
check("first GRN serial accepted", grn1.ok === true);

let dupGrn = false;
try {
  engine.postGoodsReceipt({
    id: "grn-b", companyId, grnNumber: "GRN-B", purchaseOrderId: poId, warehouseId: whId, binId,
    status: "draft", actorId: admin.id,
    lines: [{ id: "gl-b", purchaseOrderLineId: polId, skuId: "sku-s", quantityReceived: 1, unitCost: 10, serialNumbers: ["SN 001"] }],
  }, admin);
} catch (e) {
  dupGrn = e instanceof InventoryDuplicateSerialError;
}
check("same serial different GRN rejected", dupGrn);

let dupLine = false;
try {
  engine.postGoodsReceipt({
    id: "grn-c", companyId, grnNumber: "GRN-C", purchaseOrderId: poId, warehouseId: whId, binId,
    status: "draft", actorId: admin.id,
    lines: [{ id: "gl-c", purchaseOrderLineId: polId, skuId: "sku-s", quantityReceived: 2, unitCost: 10, serialNumbers: ["SN-002", "sn_002"] }],
  }, admin);
} catch (e) {
  dupLine = e instanceof InventoryDuplicateSerialError;
}
check("same serial different receipt line formatting rejected", dupLine);

const { engine: engineB, whId: whB, binId: binB, poId: poB, polId: polB } = setupEngine(companyB, "sku-s-b", "po-b", "pol-b");

const otherCompany = engineB.postGoodsReceipt({
  id: "grn-other", companyId: companyB, grnNumber: "GRN-OTHER", purchaseOrderId: poB, warehouseId: whB, binId: binB,
  status: "draft", actorId: admin.id,
  lines: [{ id: "gl-other", purchaseOrderLineId: polB, skuId: "sku-s-b", quantityReceived: 1, unitCost: 10, serialNumbers: ["SN-001"] }],
}, admin);
check("different company same serial allowed", otherCompany.ok === true);

const repo = createInventoryRepository();
let repoDup = false;
try {
  repo.saveSerial({
    id: "s1", companyId: "c1", skuId: "sku", serialNumber: "ABC", warehouseId: "w", binId: "b", status: "available", createdAt: "1970-01-01T00:00:00.000Z",
  }, admin);
  repo.saveSerial({
    id: "s2", companyId: "c1", skuId: "sku", serialNumber: "a-b-c", warehouseId: "w", binId: "b", status: "available", createdAt: "1970-01-01T00:00:00.000Z",
  }, admin);
} catch (e) {
  repoDup = e instanceof InventoryDuplicateSerialError;
}
check("repository rejects duplicate serial formatting", repoDup);

console.log(`\ninventorySerialUniqueness.test.ts: ${pass} passed`);
