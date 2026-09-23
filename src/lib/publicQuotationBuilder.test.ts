import assert from "node:assert/strict";
import { calculatePublicQuotation, defaultPublicQuoteConfig, publicQuoteBatteries, publicQuoteInverters, recommendedPanelQuantity } from "./publicQuotationBuilder.ts";
import { BATTERY_CATALOG, INVERTER_CATALOG, PANEL_CATALOG } from "./solarEquipmentCatalog.ts";

const base = defaultPublicQuoteConfig(12);
const aiko645 = PANEL_CATALOG.find((item) => item.id === "panel-aiko-abc-645")!;
const result = calculatePublicQuotation({ ...base, panelId: aiko645.id, panelQuantity: 19 });
assert.equal(result.lines.find((line) => line.description.includes("solar panels"))?.totalPkr, 43 * 645 * 19);
assert.equal(recommendedPanelQuantity(12, 645), 19);

const installation = calculatePublicQuotation({ ...base, panelId: aiko645.id, panelQuantity: 16 });
assert.equal(installation.lines.find((line) => line.description === "Installation and electrical wiring")?.totalPkr, 16 * 645 * 4);

const fox = INVERTER_CATALOG.find((item) => item.id === "inverter-fox-12-ip66-hv-bundle")!;
const foxResult = calculatePublicQuotation({ ...base, inverterId: fox.id, inverterQuantity: 2, batteryId: "not-a-real-battery" });
assert.equal(foxResult.battery.id, "battery-fox-10-2-ip66-hv");
assert.equal(foxResult.lines.find((line) => line.description.includes("FOX ESS 10.2"))?.quantity, 2);
assert.equal(foxResult.lines.find((line) => line.description.includes("FOX ESS 10.2"))?.totalPkr, 0);
assert.equal(foxResult.lines.find((line) => line.description.includes("hybrid inverter"))?.totalPkr, 2 * 970_000);

const l2 = calculatePublicQuotation({ ...base, panelQuantity: 16, structurePanelQuantity: 20, structureType: "standard-l2" });
assert.equal(l2.configuredStructureCapacityPanels, 20);
assert.equal(l2.lines.find((line) => line.description === "L2 standard panel stands")?.quantity, 10);
assert.equal(l2.lines.find((line) => line.description === "L2 standard panel stands")?.totalPkr, 45_000);
const l3 = calculatePublicQuotation({ ...base, panelQuantity: 16, structurePanelQuantity: 20, structureType: "standard-l3" });
assert.equal(l3.lines.find((line) => line.description === "L3 standard panel stands")?.quantity, 7);
assert.equal(l3.lines.find((line) => line.description === "L3 standard panel stands")?.totalPkr, 50_400);

const elevated = calculatePublicQuotation({ ...base, panelId: aiko645.id, panelQuantity: 16, structurePanelQuantity: 20, structureType: "elevated" });
assert.equal(elevated.configuredStructureCapacityPanels, 20);
assert.equal(elevated.lines.find((line) => line.description.startsWith("Elevated structure"))?.totalPkr, 20 * 645 * 16);

const mixed = calculatePublicQuotation({ ...base, panelId: aiko645.id, panelQuantity: 16, structureType: "mixed", mixedL2StandQuantity: 4, mixedL3StandQuantity: 2, mixedElevatedPanelQuantity: 6 });
assert.equal(mixed.configuredStructureCapacityPanels, 20);
assert.equal(mixed.lines.filter((line) => line.category === "Structure").reduce((sum, line) => sum + line.totalPkr, 0), 4 * 4_500 + 2 * 7_200 + 6 * 645 * 16);

const goodweInverter = publicQuoteInverters(12).find((item) => !item.bundle)!;
const battery = publicQuoteBatteries(12).find((item) => item.capacityKwh === 5)!;
const quantities = calculatePublicQuotation({ ...base, inverterId: goodweInverter.id, inverterQuantity: 2, batteryId: battery.id, batteryQuantity: 3 });
assert.equal(quantities.lines.find((line) => line.description.includes("hybrid inverter"))?.totalPkr, goodweInverter.pricePkr * 2);
assert.equal(quantities.lines.find((line) => line.description.includes("lithium battery"))?.totalPkr, battery.pricePkr * 3);

assert.ok(publicQuoteInverters(15).some((item) => item.capacityKw === 15));
assert.ok(publicQuoteInverters(15).some((item) => item.capacityKw === 16));
assert.ok(publicQuoteInverters(6).some((item) => item.id === "inverter-goodwe-6"));
assert.ok(publicQuoteInverters(10).some((item) => item.id === "inverter-goodwe-10"));
assert.ok(publicQuoteBatteries(6).some((item) => item.capacityKwh >= 2.5 && item.capacityKwh <= 2.6));
assert.ok(publicQuoteBatteries(6).some((item) => item.capacityKwh === 10));
assert.ok(publicQuoteBatteries(6).some((item) => item.capacityKwh === 16));
assert.ok(publicQuoteBatteries(15).some((item) => item.capacityKwh === 5));
const dyness5 = BATTERY_CATALOG.find((item) => item.id === "battery-dyness-5");
assert.ok(dyness5);
assert.equal(dyness5.pricePkr, 225_000);
assert.ok(publicQuoteBatteries(6).some((item) => item.id === "battery-dyness-5"));
assert.equal(INVERTER_CATALOG.filter((item) => item.brand === "GoodWe" && item.capacityKw === 8).length, 1);
assert.equal(BATTERY_CATALOG.filter((item) => item.brand === "GoodWe" && item.capacityKwh === 16).length, 1);
assert.ok(publicQuoteInverters(6).some((item) => item.id === "inverter-knox-krypton-9000"));
assert.ok(publicQuoteInverters(8).some((item) => item.id === "inverter-knox-krypton-12002"));
assert.ok(publicQuoteInverters(10).some((item) => item.id === "inverter-knox-zapher-9-2"));
assert.ok(publicQuoteInverters(12).some((item) => item.id === "inverter-knox-krypton-15002"));
const knoxAccessories = calculatePublicQuotation({
  ...base,
  batteryId: "battery-knox-hv-5",
  batteryAccessoryIds: ["battery-accessory-knox-hv-box-52ah", "battery-accessory-knox-base-wheel-52ah"],
});
assert.equal(
  knoxAccessories.lines.filter((item) => /HV Box 52Ah|Base wheel 52Ah/.test(item.description)).reduce((sum, item) => sum + item.totalPkr, 0),
  266_000,
);
assert.throws(
  () => calculatePublicQuotation({
    ...base,
    batteryId: "battery-knox-hv-5",
    batteryAccessoryIds: ["battery-accessory-knox-hv-box-100ah"],
  }),
  /do not match the selected battery module/,
);
assert.throws(() => calculatePublicQuotation({ ...base, systemCapacityKw: 7 }), /No verified BOQ exists for 7 kW/);

console.log("public quotation builder tests passed");
