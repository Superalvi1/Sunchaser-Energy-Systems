import assert from "node:assert/strict";
import test from "node:test";
import {
  QuotationConfigurationError,
  resolveQuotationComponents,
  resolveQuotationSource,
} from "./QuotationSourceCatalog.ts";

test("15kW selects its own 30m cable, 20k DB and 16-member structure", () => {
  const result = resolveQuotationComponents({
    systemCapacityKw: 15,
    inverterBrand: "GoodWe",
    inverterModel: "3P IP66",
    batteryBrand: "Dyness",
    batteryModel: "16kWh",
    structureType: "elevated",
  });

  assert.equal(result.sourceQuotationId, "q-15kw-goodwe-3p-ip66");
  assert.equal(result.requiredCabling.find((item) => item.code === "pv-6mm")?.quantity, 30);
  assert.equal(result.requiredFixedItems.find((item) => item.code === "db-box-4p-1000v")?.unitPrice, 20000);
  assert.equal(result.requiredServices.find((item) => item.code === "elevated-girder")?.quantity, 16);
});

test("20kW does not inherit 15kW components", () => {
  const source = resolveQuotationSource({
    systemCapacityKw: 20,
    inverterBrand: "GoodWe",
    inverterModel: "LV IP65",
    batteryBrand: "Dyness",
    batteryModel: "Brick Max",
    structureType: "elevated",
  });

  assert.equal(source.lines.find((item) => item.code === "pv-6mm")?.quantity, 70);
  assert.equal(source.lines.find((item) => item.code === "db-box-4p-1000v")?.unitPrice, 30000);
  assert.equal(source.lines.find((item) => item.code === "elevated-girder")?.quantity, 32);
});

test("unknown inverter/capacity combination is rejected without defaults", () => {
  assert.throws(
    () => resolveQuotationSource({
      systemCapacityKw: 15,
      inverterBrand: "GoodWe",
      inverterModel: "LV IP65",
      batteryBrand: "Dyness",
      batteryModel: "16kWh",
      structureType: "elevated",
    }),
    (error: unknown) => error instanceof QuotationConfigurationError && error.code === "NO_MATCHING_QUOTATION",
  );
});

test("FOX ESS selects the corrected IP66 inverter and 10.2kWh HV battery bundle", () => {
  const source = resolveQuotationSource({
    systemCapacityKw: 20,
    inverterBrand: "FOX ESS",
    inverterModel: "12kW IP66 HV + 10.2kWh battery bundle",
    batteryBrand: "FOX ESS",
    batteryModel: "10.2kWh IP66 HV (included)",
    structureType: "elevated",
  });
  assert.equal(source.inverter.unitPrice, 970000);
  assert.equal(source.battery.unitPrice, 0);
  assert.equal(source.battery.priceStatus, "confirmed");
});
