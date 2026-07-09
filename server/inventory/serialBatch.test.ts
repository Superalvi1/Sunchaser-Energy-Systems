import assert from "node:assert/strict";
import {
  adjustBatchQuantity,
  issueSerial,
  normalizeBatchNumber,
  normalizeSerialNumber,
  releaseSerialReservation,
  reserveSerial,
  validateBatchRecord,
  validateSerialNumberRecord,
} from "./SerialBatchTracking.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const serialBase = {
  id: "sn-1", companyId: "c1", skuId: "s1", serialNumber: " sn-abc ", warehouseId: "w1", binId: "b1", status: "available" as const,
};

check("validate serial ok", validateSerialNumberRecord(serialBase).ok);
check("serial missing id fails", !validateSerialNumberRecord({ ...serialBase, id: "" }).ok);
check("serial missing number fails", !validateSerialNumberRecord({ ...serialBase, serialNumber: "" }).ok);
check("normalize serial uppercase", normalizeSerialNumber(" abc123 ") === "ABC123");
check("normalize serial collapses spaces", normalizeSerialNumber("SN 001") === "SN001");
check("normalize serial strips separators", normalizeSerialNumber("sn-001") === "SN001");

const serial = validateSerialNumberRecord(serialBase);
if (serial.ok) {
  check("serial normalized", serial.record.serialNumber === "SNABC");
  const reserved = reserveSerial(serial.record);
  check("reserve serial", reserved.status === "reserved");
  const released = releaseSerialReservation(reserved);
  check("release serial", released.status === "available");
  const issued = issueSerial(serial.record);
  check("issue serial", issued.status === "issued");
}

let reserveBad = false;
try {
  reserveSerial({ id: "x", companyId: "c1", skuId: "s1", serialNumber: "X", warehouseId: "w1", binId: "b1", status: "issued", createdAt: "1970-01-01T00:00:00.000Z" });
} catch {
  reserveBad = true;
}
check("cannot reserve issued serial", reserveBad);

const batchBase = {
  id: "bt-1", companyId: "c1", skuId: "s1", batchNumber: " lot-a ", quantityOnHand: 100,
  status: "available" as const, warehouseId: "w1", binId: "b1",
};

check("validate batch ok", validateBatchRecord(batchBase).ok);
check("batch missing number fails", !validateBatchRecord({ ...batchBase, batchNumber: "" }).ok);
check("batch negative qty fails", !validateBatchRecord({ ...batchBase, quantityOnHand: -1 }).ok);
check("normalize batch", normalizeBatchNumber(" lot-b ") === "LOT-B");

const batch = validateBatchRecord(batchBase);
if (batch.ok) {
  const reduced = adjustBatchQuantity(batch.record, -30);
  check("batch reduce qty", reduced.quantityOnHand === 70);
  const depleted = adjustBatchQuantity({ ...reduced, quantityOnHand: 70 }, -70);
  check("batch depleted status", depleted.status === "depleted");
}

let batchNeg = false;
try {
  adjustBatchQuantity(batch.ok ? batch.record : batchBase as never, -200);
} catch {
  batchNeg = true;
}
check("batch cannot go negative", batchNeg);

console.log(`\nserialBatch.test.ts: ${pass} passed`);
