import assert from "node:assert/strict";
import {
  BATTERY_ACCESSORY_CATALOG,
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

const goodwe12 = INVERTER_CATALOG.filter(
  (item) => item.brand === "GoodWe" && item.capacityKw === 12
);
assert.deepEqual(
  goodwe12.map((item) => ({ phase: item.phase, pricePkr: item.pricePkr })),
  [
    { phase: "single", pricePkr: 420_000 },
    { phase: "three", pricePkr: 480_000 },
  ]
);

const goodwe16 = BATTERY_CATALOG.filter(
  (item) => item.brand === "GoodWe" && item.capacityKwh === 16
);
assert.deepEqual(goodwe16.map((item) => item.pricePkr), [725_000]);
assert.equal(BATTERY_CATALOG.some((item) => item.pricePkr === 735_000), false);

const dynessPowerBrickMax = BATTERY_CATALOG.find(
  (item) => item.id === "battery-dyness-powerbrick-max-16-08"
);
assert.equal(dynessPowerBrickMax?.model, "PowerBrick MAX");
assert.equal(dynessPowerBrickMax?.capacityKwh, 16.08);
assert.equal(dynessPowerBrickMax?.voltageClass, "LV");
assert.equal(dynessPowerBrickMax?.pricePkr, 585_000);

const expectedKnoxBatteryPrices = new Map([
  ["Powerwall 3.0", 130_000],
  ["Powerwall 4.15", 133_000],
  ["Powerwall 6.0", 225_000],
  ["Powerwall 6.11", 230_000],
  ["Powerbase 10", 430_000],
  ["Powerbase 16", 570_000],
  ["Powerbase 32", 1_090_000],
  ["PowerStack 5-HV", 556_000],
  ["PowerStack 10-HV", 867_000],
  ["HV Battery 5-HV", 300_000],
  ["HV Battery 10-HV", 562_000],
]);
for (const [model, pricePkr] of expectedKnoxBatteryPrices) {
  assert.equal(BATTERY_CATALOG.find((item) => item.brand === "Knox" && item.model === model)?.pricePkr, pricePkr);
}

assert.deepEqual(
  BATTERY_ACCESSORY_CATALOG.map((item) => [item.model, item.pricePkr]),
  [
    ["HV Box 52Ah", 215_000],
    ["HV Box 100Ah", 255_000],
    ["Base wheel 52Ah", 51_000],
    ["Base wheel 100Ah", 60_000],
  ],
);

const expectedKnoxInverterPrices = new Map([
  ["Krypton ECO 5000 WiFi", 98_000],
  ["Krypton ECO 6600 WiFi", 104_000],
  ["Krypton 6500", 118_000],
  ["Krypton 9000", 138_000],
  ["Krypton 9055", 160_000],
  ["Krypton 11008", 174_000],
  ["Krypton 12002", 245_000],
  ["Krypton 13002", 255_000],
  ["Krypton 15002", 265_000],
  ["Xenon 12066", 200_000],
]);
for (const [model, pricePkr] of expectedKnoxInverterPrices) {
  assert.equal(INVERTER_CATALOG.find((item) => item.brand === "Knox" && item.model === model)?.pricePkr, pricePkr);
}
assert.deepEqual(
  INVERTER_CATALOG.filter((item) => item.brand === "Knox" && item.model === "Zapher")
    .map((item) => [item.capacityKw, item.pricePkr]),
  [
    [6.6, 195_000], [9.2, 295_000], [11.2, 330_000], [12, 480_000],
    [15, 580_000], [20, 740_000], [30, 955_000], [50, 1_280_000],
  ],
);

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
assert.equal(sixKwBatterySizes.has(16.08), true);

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
