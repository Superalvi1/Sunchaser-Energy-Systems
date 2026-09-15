import assert from "node:assert/strict";
import type { Product } from "../../types";
import { batteryCatalogFields, catalogSpecText, inverterCatalogFields, panelCatalogFields, readCatalogSpec } from "./catalogSpecs";

const malformedWebsiteProduct = {
  id: "web_runtime_1",
  name: { value: "Runtime Solar Product" },
  brand: { label: "Safe Brand" },
  model: ["Model", "X"],
  price: { value: 123456 },
  specifications: {
    technology: { value: "N-Type TOPCon" },
    efficiency: { label: "22.5%" },
    communication: ["WiFi", { label: "RS485" }],
    mpptCount: { displayValue: 4 },
    chemistry: { value: { label: "LiFePO4" } },
    nominalKwh: [16, { text: "kWh" }],
  },
} as unknown as Product;

assert.equal(catalogSpecText({ value: { label: "nested" } }), "nested");
assert.equal(catalogSpecText(["WiFi", { label: "RS485" }]), "WiFi, RS485");
assert.equal(readCatalogSpec(malformedWebsiteProduct, ["technology"]), "N-Type TOPCon");
const panel = panelCatalogFields(malformedWebsiteProduct);
assert.equal(panel.technology, "N-Type TOPCon");
assert.equal(panel.efficiency, "22.5%");
const inverter = inverterCatalogFields(malformedWebsiteProduct);
assert.equal(inverter.communication, "WiFi, RS485");
assert.equal(inverter.mpptCount, "4");
const battery = batteryCatalogFields(malformedWebsiteProduct);
assert.equal(battery.chemistry, "LiFePO4");
assert.equal(battery.nominalKwh, "16, kWh");
for (const group of [panel, inverter, battery]) {
  for (const value of Object.values(group)) {
    assert.equal(typeof value, "string");
    assert.notEqual(value, "[object Object]");
  }
}
console.log("catalog runtime safety tests passed");
