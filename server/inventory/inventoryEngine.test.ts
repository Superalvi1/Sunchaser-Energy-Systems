import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { createInventoryEngine } from "./InventoryEngine.ts";
import { InventoryPermissionError } from "./InventoryPermissions.ts";

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

const sales: RequestActor = { ...admin, id: "sales", role: "Sales Executive" };
const companyId = "co-1";

function setup() {
  const engine = createInventoryEngine({ eventIdPrefix: "test" });
  engine.registerSku({
    id: "sku-1", companyId, skuCode: "PANEL-1", name: "Panel", description: "", unitOfMeasure: "each",
    trackSerial: true, trackBatch: true, valuationMethod: "weighted_average", reorderLevel: 0, allowNegativeStock: false, active: true,
  }, admin);

  engine.registerWarehouse({ id: "wh-1", companyId, code: "MAIN", name: "Main" }, admin);
  engine.registerWarehouse({ id: "wh-2", companyId, code: "SEC", name: "Secondary" }, admin);
  engine.registerBin({ id: "bin-1", companyId, warehouseId: "wh-1", zoneId: "z1", shelfId: "sh-1", code: "A01", name: "A01" }, admin);
  engine.registerBin({ id: "bin-2", companyId, warehouseId: "wh-2", zoneId: "z2", shelfId: "sh-2", code: "B01", name: "B01" }, admin);

  return engine;
}

const key = { companyId, warehouseId: "wh-1", binId: "bin-1", skuId: "sku-1" };

// --- Registration ---
const engine = setup();
check("engine created", engine.repository.listSkus(companyId, admin).length === 1);

let salesWriteDenied = false;
try {
  engine.stockIn(key, 10, sales, { entryId: "x" });
} catch (e) {
  salesWriteDenied = e instanceof InventoryPermissionError;
}
check("sales cannot stock in", salesWriteDenied);

// --- Opening stock ---
const open = engine.openingStock(key, 100, 25, admin, "open-1");
check("opening stock ok", open.ok === true);
if (open.ok) check("opening balance", engine.getBalance(key) === 100);

// --- Stock in / out ---
const stockIn = engine.stockIn(key, 50, admin, { unitCost: 30, entryId: "in-1" });
check("stock in ok", stockIn.ok === true);
check("balance after in", engine.getBalance(key) === 150);

const stockOut = engine.stockOut(key, 40, admin, { entryId: "out-1" });
check("stock out ok", stockOut.ok === true);
check("balance after out", engine.getBalance(key) === 110);

const negOut = engine.stockOut(key, 200, admin, { entryId: "out-neg" });
check("negative stock blocked", !negOut.ok);

// --- Adjustment ---
const adj = engine.adjustStock(key, -10, admin, "adj-1");
check("adjustment ok", adj.ok === true);
check("balance after adj", engine.getBalance(key) === 100);

// --- Reservation ---
const res = engine.reserve(key, 20, admin, "order-1", "res-1");
check("reservation ok", res.ok === true);
check("balance after reserve", engine.getBalance(key) === 80);

const rel = engine.releaseReservation(key, 20, admin, "order-1", "rel-1");
check("release ok", rel.ok === true);
check("balance after release", engine.getBalance(key) === 100);

// --- Transfer ---
const xfer = engine.transfer({
  companyId, skuId: "sku-1", quantity: 30,
  from: { warehouseId: "wh-1", binId: "bin-1" },
  to: { warehouseId: "wh-2", binId: "bin-2" },
  referenceId: "xfer-1", actorId: admin.id, outEntryId: "xo-1", inEntryId: "xi-1",
}, admin);
check("transfer ok", xfer.ok === true);
check("source balance after transfer", engine.getBalance(key) === 70);
check("dest balance after transfer", engine.getBalance({ companyId, warehouseId: "wh-2", binId: "bin-2", skuId: "sku-1" }) === 30);

// --- Valuation ---
const val = engine.repository.getValuation(companyId, "wh-1", "sku-1");
check("valuation exists", val !== null);
if (val) check("weighted avg > 0", val.weightedAverageCost > 0);

// --- Ledger ---
check("ledger entries created", engine.repository.getLedger().length >= 8);
check("ledger chain valid", engine.repository.getLedger().verifyChain(key));

// --- Events ---
const events = engine.repository.listEvents();
check("events emitted", events.length >= 5);
check("movement event exists", events.some((e) => e.type === "movement.posted"));
check("transfer event exists", events.some((e) => e.type === "transfer.completed"));

// --- PO + GRN flow ---
engine.createPurchaseOrder({
  id: "po-1", companyId, poNumber: "PO-500", supplierName: "Vendor", warehouseId: "wh-1", status: "submitted",
  lines: [{ id: "pol-1", skuId: "sku-1", quantityOrdered: 50, quantityReceived: 0, unitCost: 20 }],
}, admin);

const grnResult = engine.postGoodsReceipt({
  id: "grn-1", companyId, grnNumber: "GRN-500", purchaseOrderId: "po-1", warehouseId: "wh-1", binId: "bin-1",
  status: "draft", actorId: admin.id,
  lines: [{
    id: "grl-1", purchaseOrderLineId: "pol-1", skuId: "sku-1", quantityReceived: 50, unitCost: 20,
    batchNumber: "LOT-2025", serialNumbers: ["SN-001", "SN-002"],
  }],
}, admin);

check("GRN posted", grnResult.ok === true);
if (grnResult.ok) {
  check("GRN entries", grnResult.entries.length === 1);
  check("balance increased by GRN", engine.getBalance(key) === 120);
  check("serials registered", engine.repository.listSerials("sku-1", admin).length === 2);
  check("batch registered", engine.repository.listBatches("sku-1", admin).length === 1);
  const po = engine.repository.getPurchaseOrder("po-1", admin);
  check("PO fully received", po?.status === "received");
}

const grnOver = engine.postGoodsReceipt({
  id: "grn-2", companyId, grnNumber: "GRN-501", purchaseOrderId: "po-1", warehouseId: "wh-1", binId: "bin-1",
  status: "draft", actorId: admin.id,
  lines: [{ id: "grl-2", purchaseOrderLineId: "pol-1", skuId: "sku-1", quantityReceived: 1, unitCost: 20 }],
}, admin);
check("GRN over-receive blocked", !grnOver.ok);

// --- FIFO architecture ---
const fifoEngine = createInventoryEngine();
fifoEngine.registerSku({
  id: "fifo-sku", companyId, skuCode: "FIFO-1", name: "Fifo Item", description: "", unitOfMeasure: "each",
  trackSerial: false, trackBatch: false, valuationMethod: "fifo", reorderLevel: 0, allowNegativeStock: false, active: true,
}, admin);
fifoEngine.registerBin({ id: "fb1", companyId, warehouseId: "wh-1", zoneId: "z", shelfId: "s", code: "F1", name: "F1" }, admin);
fifoEngine.stockIn({ companyId, warehouseId: "wh-1", binId: "fb1", skuId: "fifo-sku" }, 10, admin, { unitCost: 5, entryId: "fifo-in" });
check("fifo layers stored", fifoEngine.getFifoLayers().layers.length === 1);

// --- Multi-warehouse company scope ---
check("two warehouses", engine.repository.listWarehouses(companyId, admin).length === 2);

// --- Deterministic entry before/after ---
if (open.ok) {
  check("ledger before zero", open.entry.quantityBefore === 0);
  check("ledger after matches", open.entry.quantityAfter === open.quantityAfter);
}

console.log(`\ninventoryEngine.test.ts: ${pass} passed`);
