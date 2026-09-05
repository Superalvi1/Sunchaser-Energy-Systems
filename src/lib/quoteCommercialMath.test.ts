import assert from "node:assert/strict";
import {
  calculateArrayWatts,
  calculateElevatedStructureTotal,
  calculateImpliedPkrPerWatt,
  calculateInstallationTotal,
  calculatePanelTotal,
  calculatePanelUnitPrice,
  nonNegativeFinite,
  positiveFinite,
  recommendedPanelQuantity,
} from "./quoteCommercialMath.ts";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("owner commercial formulas use actual array watts", () => {
  const panelWattage = 645;
  const panelQuantity = 16;
  const panelRatePerWatt = 42.5;
  const installationRatePerWatt = 4;
  const elevatedStructureRatePerWatt = 16;
  assert.equal(calculateArrayWatts(panelWattage, panelQuantity), 645 * 16);
  assert.equal(calculatePanelUnitPrice(panelWattage, panelRatePerWatt), 645 * 42.5);
  assert.equal(calculatePanelTotal(panelWattage, panelQuantity, panelRatePerWatt), 645 * 16 * 42.5);
  assert.equal(calculateInstallationTotal(panelWattage, panelQuantity, installationRatePerWatt), 645 * 16 * 4);
  assert.equal(
    calculateElevatedStructureTotal(panelWattage, panelQuantity, elevatedStructureRatePerWatt),
    645 * 16 * 16
  );
});

check("website implied PKR/W is catalogue price / wattage", () => {
  assert.equal(calculateImpliedPkrPerWatt(28661.5, 665), 28661.5 / 665);
  assert.equal(calculateImpliedPkrPerWatt(100, 0), 0);
});

check("recommended panel count uses ceil of system watts / panel wattage", () => {
  assert.equal(recommendedPanelQuantity(10, 645), Math.ceil(10000 / 645));
});

check("negative commercial inputs are not valid numbers", () => {
  assert.equal(positiveFinite(-645), null);
  assert.equal(nonNegativeFinite(-4), null);
  assert.equal(nonNegativeFinite(Number.NaN), null);
  assert.equal(nonNegativeFinite(Number.POSITIVE_INFINITY), null);
  assert.equal(nonNegativeFinite(0), 0);
  assert.equal(calculateArrayWatts(-645, 16), 0);
  assert.equal(calculatePanelTotal(-645, 16, 42.5), 0);
});

console.log(`\nquoteCommercialMath tests: ${pass} passed`);
