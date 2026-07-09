import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { createInventoryRepository } from "./InventoryRepository.ts";
import { InventoryPermissionError } from "./InventoryPermissions.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const admin: RequestActor = {
  id: "admin", username: "admin", name: "Admin", email: "a@test.com", role: "Admin",
  accountStatus: "Active", emailVerified: true, onboardingCompleted: true, authMethod: "jwt",
};

const sales: RequestActor = { ...admin, id: "sales", role: "Sales Executive" };
const repo = createInventoryRepository();

const skuInput = {
  id: "sku-1", companyId: "co-1", skuCode: "SKU-A", name: "Item A", description: "",
  unitOfMeasure: "each" as const, trackSerial: false, trackBatch: false,
  valuationMethod: "weighted_average" as const, reorderLevel: 5, allowNegativeStock: false, active: true,
};

check("admin saves sku", repo.saveSku(skuInput, admin).id === "sku-1");
check("admin gets sku", repo.getSku("sku-1", admin)?.skuCode === "SKU-A");
check("admin lists skus", repo.listSkus("co-1", admin).length === 1);

let salesDenied = false;
try {
  repo.getSku("sku-1", sales);
} catch (e) {
  salesDenied = e instanceof InventoryPermissionError;
}
check("sales cannot read sku", salesDenied);

repo.saveWarehouse({ id: "wh-1", companyId: "co-1", code: "MAIN", name: "Main" }, admin);
check("warehouse saved", repo.getWarehouse("wh-1", admin)?.code === "MAIN");
check("list warehouses", repo.listWarehouses("co-1", admin).length === 1);

repo.saveShelf({ id: "sh-1", companyId: "co-1", warehouseId: "wh-1", zoneId: "z1", code: "S1", name: "S1", active: true }, admin);
check("list shelves", repo.listShelves("wh-1", admin).length === 1);

repo.saveBin({ id: "bin-1", companyId: "co-1", warehouseId: "wh-1", zoneId: "z1", shelfId: "sh-1", code: "B01", name: "Bin" }, admin);
check("bin saved", repo.getBin("bin-1", admin)?.code === "B01");

const key = { companyId: "co-1", warehouseId: "wh-1", binId: "bin-1", skuId: "sku-1" };
repo.setBalance(key, 100);
check("balance get/set", repo.getBalance(key) === 100);

const entry = repo.getLedger().append({
  key, movementType: "stock_in", quantityDelta: 100, quantityBefore: 0, unitCost: 10,
  valuationMethod: "weighted_average", referenceType: "test", referenceId: "r1", actorId: "admin", entryId: "le-1",
});
check("ledger append", repo.getLedger().length === 1);
check("appendLedgerEntry", repo.appendLedgerEntry(entry).id === "le-1");

const val = repo.setValuation({
  companyId: "co-1", warehouseId: "wh-1", skuId: "sku-1", method: "weighted_average", quantityOnHand: 100, weightedAverageCost: 10,
});
check("valuation set/get", repo.getValuation("co-1", "wh-1", "sku-1")?.weightedAverageCost === 10);

repo.pushEvent({
  id: "ev-1", type: "sku.created", companyId: "co-1", actorId: "admin", entityType: "sku", entityId: "sku-1", payload: {},
});
check("events listed", repo.listEvents().length === 1);
check("events filtered", repo.listEvents("sku-1").length === 1);

repo.savePurchaseOrder({
  id: "po-1", companyId: "co-1", poNumber: "PO-001", supplierName: "Sup", warehouseId: "wh-1", status: "draft",
  lines: [{ id: "pol-1", skuId: "sku-1", quantityOrdered: 50, quantityReceived: 0, unitCost: 12 }],
}, admin);
check("PO saved", repo.getPurchaseOrder("po-1", admin)?.poNumber === "PO-001");

console.log(`\ninventoryRepository.test.ts: ${pass} passed`);
