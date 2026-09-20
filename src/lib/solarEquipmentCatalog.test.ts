import assert from "node:assert/strict";
import {
  BATTERY_CATALOG,
  INVERTER_CATALOG,
  PANEL_CATALOG,
  compatibleBatteries,
  ELEVATED_STRUCTURE_PRICES_PKR,
  panelUnitPricePkr,
  standardStandPrice,
} from "./solarEquipmentCatalog.ts";

const goodwe8 = INVERTER_CATALOG.filter(
  (item) => item.brand === "GoodWe" && item.capacityKw === 8
);
assert.deepEqual(goodwe8.map((item) => item.pricePkr), [305_000]);
assert.equal(INVERTER_CATALOG.some((item) => item.pricePkr === 310_000), false);

const goodwe16 = BATTERY_CATALOG.filter(
  (item) => item.brand === "GoodWe" && item.capacityKwh === 16
);
assert.deepEqual(goodwe16.map((item) => item.pricePkr), [725_000]);
assert.equal(BATTERY_CATALOG.some((item) => item.pricePkr === 735_000), false);

assert.equal(
  PANEL_CATALOG.some((item) => /longi.*jinko|jinko.*longi/i.test(`${item.brand} ${item.model}`)),
  false
);
const canadian625 = PANEL_CATALOG.find((item) => item.id === "panel-canadian-625-20bb");
assert.ok(canadian625);
assert.equal(panelUnitPricePkr(canadian625), 625 * 42);
const trina725 = PANEL_CATALOG.find((item) => item.id === "panel-trina-725-bf");
assert.ok(trina725);
assert.equal(panelUnitPricePkr(trina725), 725 * 39.5);

const fox = INVERTER_CATALOG.find((item) => item.id === "inverter-fox-12-ip66-hv-bundle");
assert.equal(fox?.pricePkr, 970_000);
assert.equal(fox?.protection, "IP66");
assert.equal(fox?.bundle?.batteryId, "battery-fox-10-2-ip66-hv");
assert.equal(fox?.bundle?.totalBundlePricePkr, 970_000);

const sixKwBatterySizes = new Set(compatibleBatteries(6).map((item) => item.capacityKwh));
assert.equal(sixKwBatterySizes.has(10), true);
assert.equal(sixKwBatterySizes.has(16), true);

assert.deepEqual(standardStandPrice(16, "l2"), {
  standCount: 8,
  totalPricePkr: 36_000,
});
assert.deepEqual(standardStandPrice(16, "l3"), {
  standCount: 6,
  totalPricePkr: 43_200,
});
assert.equal(ELEVATED_STRUCTURE_PRICES_PKR[12], 207_280);
assert.equal(ELEVATED_STRUCTURE_PRICES_PKR[15], 206_320);

console.log("PASS approved equipment catalog, FOX bundle, and L2/L3 structure pricing");
