import assert from "node:assert/strict";
import { calculateSizingRecommendations } from "../lib/solarSizingEngine.ts";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

let pass = 0;

function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`  ✓ ${name}`);
}

console.log("Solar Consultant Wizard test suite");

check("sizing engine selects correct currency and rate for Pakistan", () => {
  const result = calculateSizingRecommendations({
    monthlyBill: 50000,
    location: "Karachi, Pakistan",
    loadSheddingHours: "1-2",
    roofType: "Flat Concrete",
    shading: "Low",
  });
  assert.equal(result.isPakistan, true);
  assert.equal(result.currency, "Rs.");
  // 50000 PKR / 50 PKR per unit = 1000 units
  // 1000 / 120 = 8.33 kW, rounded to 8.3 kW
  assert.equal(result.systemSizekW, 8.3);
  assert.equal(result.panelsCount, 21);
});

check("sizing engine selects correct currency and rate for US", () => {
  const result = calculateSizingRecommendations({
    monthlyBill: 250,
    location: "Los Angeles, CA",
    loadSheddingHours: "None",
    roofType: "Tile Roof",
    shading: "None",
  });
  assert.equal(result.isPakistan, false);
  assert.equal(result.currency, "$");
  // 250 / 0.25 = 1000 units
  // 1000 / 120 = 8.3 kW
  assert.equal(result.systemSizekW, 8.3);
  assert.equal(result.batteryCount, 0);
  assert.equal(result.inverterType, "Enphase IQ8 Smart Microinverters");
});

check("sizing engine determines battery count correctly from load shedding hours", () => {
  const none = calculateSizingRecommendations({
    monthlyBill: 300,
    location: "NY",
    loadSheddingHours: "None",
    roofType: "Tin",
    shading: "Low",
  });
  assert.equal(none.batteryCount, 0);

  const low = calculateSizingRecommendations({
    monthlyBill: 300,
    location: "NY",
    loadSheddingHours: "1-2",
    roofType: "Tin",
    shading: "Low",
  });
  assert.equal(low.batteryCount, 1);
  assert.equal(low.inverterType, "Sunchaser Smart Hybrid Inverter");

  const med = calculateSizingRecommendations({
    monthlyBill: 300,
    location: "NY",
    loadSheddingHours: "3-5",
    roofType: "Tin",
    shading: "Low",
  });
  assert.equal(med.batteryCount, 2);

  const high = calculateSizingRecommendations({
    monthlyBill: 300,
    location: "NY",
    loadSheddingHours: "6+",
    roofType: "Tin",
    shading: "Low",
  });
  assert.equal(high.batteryCount, 3);
});

check("sizing engine clamps payback period correctly", () => {
  // Check low bill leading to high payback clamping
  const result = calculateSizingRecommendations({
    monthlyBill: 5,
    location: "CA",
    loadSheddingHours: "None",
    roofType: "Flat",
    shading: "None",
  });
  assert.equal(result.paybackYears <= 8.0, true);
  assert.equal(result.paybackYears >= 3.5, true);
});

check("SolarConsultantWizard.tsx static checks", () => {
  const src = read("src/components/SolarConsultantWizard.tsx");
  // verify imports submitPublicLead and calculateSizingRecommendations
  assert.match(src, /submitPublicLead/);
  assert.match(src, /calculateSizingRecommendations/);
  assert.match(src, /export default function SolarConsultantWizard/);
  // verify forms attributes are used
  assert.match(src, /<form/);
  assert.match(src, /onSubmit=/);
});

console.log(`\n${pass} passed successfully.`);
