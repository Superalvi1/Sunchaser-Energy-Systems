import assert from "node:assert/strict";
import { createBinLocation, binLocationPath, validateBinLocation, validateShelf } from "./BinLocation.ts";
import { createWarehouse, validateWarehouse, validateWarehouseZone } from "./Warehouse.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const companyId = "co-1";
const warehouseId = "wh-1";
const zoneId = "zone-a";

check("valid warehouse passes", validateWarehouse({ id: warehouseId, companyId, code: "main", name: "Main WH" }).ok);
check("warehouse missing id fails", !validateWarehouse({ id: "", companyId, code: "x", name: "x" }).ok);
check("warehouse missing company fails", !validateWarehouse({ id: warehouseId, companyId: "", code: "x", name: "x" }).ok);
check("warehouse missing code fails", !validateWarehouse({ id: warehouseId, companyId, code: "", name: "x" }).ok);
check("warehouse missing name fails", !validateWarehouse({ id: warehouseId, companyId, code: "x", name: "" }).ok);

const wh = createWarehouse({ id: warehouseId, companyId, code: "main", name: "Main", address: "Addr" });
check("warehouse code uppercased", wh.code === "MAIN");
check("warehouse active default true", wh.active === true);
check("warehouse zones default empty", wh.zones.length === 0);

const zone = { id: "z1", companyId, warehouseId, code: "a1", name: "Zone A", active: true };
check("valid zone passes", validateWarehouseZone(zone, warehouseId, companyId).length === 0);
check("zone warehouse mismatch fails", validateWarehouseZone({ ...zone, warehouseId: "other" }, warehouseId, companyId).length > 0);
check("zone company mismatch fails", validateWarehouseZone({ ...zone, companyId: "other" }, warehouseId, companyId).length > 0);
check("zone missing code fails", validateWarehouseZone({ ...zone, code: "" }, warehouseId, companyId).length > 0);

const whWithZone = createWarehouse({ id: "wh-2", companyId, code: "sec", name: "Secondary", zones: [{ ...zone, warehouseId: "wh-2" }] });
check("warehouse with zone", whWithZone.zones.length === 1);
check("zone code uppercased", whWithZone.zones[0].code === "A1");

const shelf = { id: "sh-1", companyId, warehouseId, zoneId, code: "s1", name: "Shelf 1", active: true };
check("valid shelf", validateShelf(shelf).length === 0);
check("shelf missing id", validateShelf({ ...shelf, id: "" }).length > 0);
check("shelf missing warehouse", validateShelf({ ...shelf, warehouseId: "" }).length > 0);
check("shelf missing zone", validateShelf({ ...shelf, zoneId: "" }).length > 0);

const binInput = {
  id: "bin-1",
  companyId,
  warehouseId,
  zoneId,
  shelfId: "sh-1",
  code: "b01",
  name: "Bin 01",
};
check("valid bin", validateBinLocation(binInput).ok);
check("bin missing shelf fails", !validateBinLocation({ ...binInput, shelfId: "" }).ok);
check("bin missing code fails", !validateBinLocation({ ...binInput, code: "" }).ok);

const bin = createBinLocation(binInput);
check("bin code uppercased", bin.code === "B01");
check("bin active default", bin.active === true);
check("bin name defaults to code when omitted", createBinLocation({ id: "bin-2", companyId, warehouseId, zoneId, shelfId: "sh-1", code: "b02" }).name === "b02");

check(
  "binLocationPath",
  binLocationPath(bin, "A1", "S1") === "A1/S1/B01"
);

const binBarcode = createBinLocation({ ...binInput, id: "bin-3", code: "b03", barcode: " BIN-QR " });
check("bin barcode trimmed", binBarcode.barcode === "BIN-QR");

console.log(`\nwarehouseBin.test.ts: ${pass} passed`);
