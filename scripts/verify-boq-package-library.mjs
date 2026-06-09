#!/usr/bin/env node
/**
 * Phase 21 — BOQ package library verification.
 * Usage: node scripts/verify-boq-package-library.mjs [baseUrl]
 */
const BASE = process.argv[2] || process.env.API_BASE_URL || "http://localhost:3000";

const SIZES = [3, 4, 6, 8, 10, 12, 15, 20, 25];
const STRUCTURES = ["standard", "elevated"];
const TIERS = ["budgeted", "premium"];

function pass(id, msg) {
  console.log(`PASS ${id}: ${msg}`);
}
function fail(id, msg) {
  console.log(`FAIL ${id}: ${msg}`);
}

const res = await fetch(`${BASE}/api/state`);
if (!res.ok) {
  fail("0", `Cannot load app state (${res.status})`);
  process.exit(1);
}
const state = await res.json();
const packages = state.solarPackages || [];

if (!packages.length) {
  fail("1", "No solarPackages in app state");
  process.exit(1);
}

const withBoq = packages.filter((p) => Array.isArray(p.boqRows) && p.boqRows.length > 0);
withBoq.length === packages.length
  ? pass("1", `All ${packages.length} packages store complete BOQ (${withBoq[0].boqRows.length}+ rows each)`)
  : fail("1", `${withBoq.length}/${packages.length} packages have boqRows`);

const expectedCount = SIZES.length * STRUCTURES.length * TIERS.length;
packages.length >= expectedCount
  ? pass("2", `Catalog has ${packages.length} packages (expected ${expectedCount})`)
  : fail("2", `Only ${packages.length} packages (expected ${expectedCount})`);

let missingCombo = null;
for (const kw of SIZES) {
  for (const structure of STRUCTURES) {
    for (const tier of TIERS) {
      const name = `${kw}kW ${structure === "standard" ? "Standard" : "Elevated"} ${tier === "budgeted" ? "Budgeted" : "Premium"}`;
      const found = packages.find((p) => p.name === name || p.id === `pkg-${kw}kw-${structure}-${tier}`);
      if (!found) missingCombo = name;
    }
  }
}
missingCombo
  ? fail("3", `Missing package: ${missingCombo}`)
  : pass("3", "All size × structure × tier combinations present");

const sample = packages.find((p) => p.id === "pkg-10kw-standard-budgeted") || packages[0];
const headings = (sample.boqRows || []).filter((r) => r.type === "heading").length;
const items = (sample.boqRows || []).filter((r) => r.type === "item").length;
headings >= 5 && items >= 10
  ? pass("4", `Sample package "${sample.name}" has ${headings} sections and ${items} line items`)
  : fail("4", `Sample package BOQ too small (${headings} headings, ${items} items)`);

const elevated = packages.find((p) => p.structureType === "elevated" && p.systemSizeKw === 10);
const elevatedStructRow = elevated?.boqRows?.find((r) => r.id === "structure_row");
elevatedStructRow?.name?.includes("Elevated")
  ? pass("5", "Elevated packages use elevated structure BOQ row")
  : fail("5", "Elevated structure row missing or mislabeled");

console.log("\nPackage library verification complete.");
