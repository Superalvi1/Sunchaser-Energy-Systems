import assert from "node:assert/strict";
import {
  calculatePublicQuotation,
  defaultPublicQuoteConfig,
  publicQuoteBatteries,
  publicQuoteInverters,
  recommendedPanelQuantity,
} from "./publicQuotationBuilder.ts";
import { BATTERY_CATALOG, INVERTER_CATALOG, PANEL_CATALOG } from "./solarEquipmentCatalog.ts";

const base = defaultPublicQuoteConfig(12);
const aiko645 = PANEL_CATALOG.find((item) => item.id === "panel-aiko-abc-645")!;
const result = calculatePublicQuotation({ ...base, panelId: aiko645.id, panelQuantity: 19 });
const panelLine = result.lines.find((line) => line.description.includes("solar panels"))!;
assert.equal(panelLine.totalPkr, 43 * 645 * 19, "panel formula must be rate × watts × quantity");
assert.equal(recommendedPanelQuantity(12, 645), 19);

const fox = INVERTER_CATALOG.find((item) => item.id === "inverter-fox-12-ip66-hv-bundle")!;
const foxResult = calculatePublicQuotation({ ...base, inverterId: fox.id, batteryId: "not-a-real-battery" });
assert.equal(foxResult.battery.id, "battery-fox-10-2-ip66-hv");
assert.equal(foxResult.lines.find((line) => line.description.includes("FOX ESS 10.2"))?.totalPkr, 0);
assert.equal(foxResult.lines.find((line) => line.description.includes("hybrid inverter"))?.totalPkr, 970_000);

const l2 = calculatePublicQuotation({ ...base, panelQuantity: 16, structureType: "standard-l2" });
const l2Line = l2.lines.find((line) => line.category === "Structure")!;
assert.equal(l2Line.quantity, 8);
assert.equal(l2Line.totalPkr, 36_000);
const l3 = calculatePublicQuotation({ ...base, panelQuantity: 16, structureType: "standard-l3" });
assert.equal(l3.lines.find((line) => line.category === "Structure")?.quantity, 6);
assert.equal(l3.lines.find((line) => line.category === "Structure")?.totalPkr, 43_200);

assert.deepEqual(publicQuoteInverters(15).map((item) => item.capacityKw), [15, 16]);
assert.ok(publicQuoteInverters(6).some((item) => item.id === "inverter-goodwe-6"));
assert.ok(publicQuoteInverters(10).some((item) => item.id === "inverter-goodwe-10"));
assert.ok(publicQuoteBatteries(8).every((item) => [5, 10, 16].includes(item.capacityKwh)));
assert.ok(publicQuoteBatteries(6).some((item) => item.capacityKwh === 10));
assert.ok(publicQuoteBatteries(6).some((item) => item.capacityKwh === 16));
assert.ok(publicQuoteBatteries(15).every((item) => item.capacityKwh === 16));
assert.equal(INVERTER_CATALOG.filter((item) => item.brand === "GoodWe" && item.capacityKw === 8).length, 1);
assert.equal(BATTERY_CATALOG.filter((item) => item.brand === "GoodWe" && item.capacityKwh === 16).length, 1);

assert.throws(
  () => calculatePublicQuotation({ ...base, systemCapacityKw: 7 }),
  /No verified BOQ exists for 7 kW/,
);

console.log("public quotation builder tests passed");
