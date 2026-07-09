import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import {
  computeStructureCost,
  isRoofType,
  isStructureType,
  ROOF_TYPE_MULTIPLIERS,
} from "./StructurePricingRules.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("isStructureType accepts elevated", isStructureType("elevated"));
check("isStructureType accepts ballast", isStructureType("ballast"));
check("isStructureType rejects unknown", !isStructureType("floating"));

check("isRoofType accepts flat_concrete", isRoofType("flat_concrete"));
check("isRoofType accepts ground_mount", isRoofType("ground_mount"));
check("isRoofType rejects unknown", !isRoofType("thatched"));

check("ROOF_TYPE_MULTIPLIERS: flat_concrete is baseline 1.0", ROOF_TYPE_MULTIPLIERS.flat_concrete === 1.0);
check("ROOF_TYPE_MULTIPLIERS: ground_mount is the highest multiplier", ROOF_TYPE_MULTIPLIERS.ground_mount === 1.5);
check(
  "ROOF_TYPE_MULTIPLIERS: sloped_tile costs more than sloped_tin",
  ROOF_TYPE_MULTIPLIERS.sloped_tile > ROOF_TYPE_MULTIPLIERS.sloped_tin
);

check(
  "computeStructureCost on flat_concrete applies no multiplier",
  computeStructureCost({ structureType: "elevated", systemSizeKw: 10, ratePerKw: 5000, roofType: "flat_concrete" }).totalCost === 50000
);
check(
  "computeStructureCost on ground_mount applies 1.5x multiplier",
  computeStructureCost({ structureType: "ballast", systemSizeKw: 10, ratePerKw: 5000, roofType: "ground_mount" }).totalCost === 75000
);
check(
  "computeStructureCost scales linearly with systemSizeKw",
  computeStructureCost({ structureType: "gi", systemSizeKw: 20, ratePerKw: 3000, roofType: "flat_concrete" }).totalCost === 60000
);
check(
  "computeStructureCost echoes the resolved multiplier",
  computeStructureCost({ structureType: "gi", systemSizeKw: 10, ratePerKw: 1000, roofType: "sloped_tin" }).multiplier === 1.15
);

check(
  "computeStructureCost throws for invalid structureType",
  (() => {
    try {
      computeStructureCost({ structureType: "floating" as never, systemSizeKw: 10, ratePerKw: 1000, roofType: "flat_concrete" });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "structure_pricing";
    }
  })()
);
check(
  "computeStructureCost throws for zero systemSizeKw",
  (() => {
    try {
      computeStructureCost({ structureType: "gi", systemSizeKw: 0, ratePerKw: 1000, roofType: "flat_concrete" });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeStructureCost throws for negative ratePerKw",
  (() => {
    try {
      computeStructureCost({ structureType: "gi", systemSizeKw: 10, ratePerKw: -1, roofType: "flat_concrete" });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check(
  "computeStructureCost throws for invalid roofType",
  (() => {
    try {
      computeStructureCost({ structureType: "gi", systemSizeKw: 10, ratePerKw: 1000, roofType: "thatched" as never });
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);

console.log(`\nStructurePricingRules tests: ${pass} passed`);
