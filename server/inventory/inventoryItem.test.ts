import assert from "node:assert/strict";
import { createInventorySku, validateInventorySku } from "./InventoryItem.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function baseSku(overrides: Record<string, unknown> = {}) {
  return {
    id: "sku-1",
    companyId: "co-1",
    skuCode: "PANEL-400W",
    name: "Solar Panel 400W",
    description: "Test panel",
    unitOfMeasure: "each" as const,
    trackSerial: false,
    trackBatch: false,
    valuationMethod: "weighted_average" as const,
    reorderLevel: 10,
    allowNegativeStock: false,
    active: true,
    ...overrides,
  };
}

check("valid SKU passes", validateInventorySku(baseSku()).ok === true);
check("missing id fails", validateInventorySku(baseSku({ id: "" })).ok === false);
check("missing companyId fails", validateInventorySku(baseSku({ companyId: "" })).ok === false);
check("missing skuCode fails", validateInventorySku(baseSku({ skuCode: "" })).ok === false);
check("missing name fails", validateInventorySku(baseSku({ name: "" })).ok === false);
check("invalid uom fails", validateInventorySku(baseSku({ unitOfMeasure: "invalid" })).ok === false);
check("invalid valuation fails", validateInventorySku(baseSku({ valuationMethod: "lifo" })).ok === false);
check("negative reorder fails", validateInventorySku(baseSku({ reorderLevel: -1 })).ok === false);

const created = createInventorySku(baseSku());
check("createInventorySku normalizes code", created.skuCode === "PANEL-400W");
check("createInventorySku trims name", created.name === "Solar Panel 400W");
check("createInventorySku default active", created.active === true);
check("createInventorySku serial flag", created.trackSerial === false);
check("createInventorySku batch flag", created.trackBatch === false);
check("createInventorySku allowNegative default false", created.allowNegativeStock === false);

const serialSku = createInventorySku(baseSku({ trackSerial: true, skuCode: "inv-serial" }));
check("serial tracked SKU", serialSku.trackSerial === true);

const batchSku = createInventorySku(baseSku({ trackBatch: true, skuCode: "inv-batch" }));
check("batch tracked SKU", batchSku.trackBatch === true);

const fifoSku = createInventorySku(baseSku({ valuationMethod: "fifo", skuCode: "inv-fifo" }));
check("fifo valuation SKU", fifoSku.valuationMethod === "fifo");

const negSku = createInventorySku(baseSku({ allowNegativeStock: true, skuCode: "inv-neg" }));
check("allow negative stock", negSku.allowNegativeStock === true);

const barcodeSku = createInventorySku(baseSku({ barcode: " 1234567890123 ", skuCode: "inv-bar" }));
check("barcode trimmed", barcodeSku.barcode === "1234567890123");

check("inactive SKU allowed", createInventorySku(baseSku({ active: false, skuCode: "inv-inactive" })).active === false);

for (const uom of ["each", "piece", "box", "kg", "meter"] as const) {
  const r = validateInventorySku(baseSku({ unitOfMeasure: uom, skuCode: `uom-${uom}` }));
  check(`uom ${uom} valid`, r.ok === true);
}

console.log(`\ninventoryItem.test.ts: ${pass} passed`);
