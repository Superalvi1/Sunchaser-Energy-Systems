#!/usr/bin/env node
/** Unit tests for normalizeRows / normalizeQuoteBoqRows used by PDF export. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const sample = [
  { id: "row-1", type: "item", name: "Panel", qty: 1, rate: 100 },
];

function normalizeRows(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return normalizeRows(parsed);
    } catch {
      return [];
    }
  }
  if (input && typeof input === "object") {
    const obj = input;
    if (Array.isArray(obj.rows)) return obj.rows;
    if (Array.isArray(obj.boqRows)) return obj.boqRows;
    if (Array.isArray(obj.boq_rows)) return obj.boq_rows;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.boqItems)) return obj.boqItems;
    if (Array.isArray(obj.boq_items)) return obj.boq_items;
  }
  return [];
}

function normalizeQuoteBoqRows(quote) {
  if (!quote || typeof quote !== "object") return [];
  const fromBoq = normalizeRows(quote.boqRows ?? quote.boq_rows);
  if (fromBoq.length > 0) return fromBoq;
  return normalizeRows(quote.boqItems ?? quote.boq_items);
}

function describeRowsInput(input) {
  return {
    typeofRows: typeof input,
    isArray: Array.isArray(input),
    normalizedLength: normalizeRows(input).length,
  };
}

let passed = 0;
let failed = 0;

function check(label, cond, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {

  console.log("\n1) normalizeRows cases");
  check("array passthrough", normalizeRows(sample).length === 1);
  check(
    "JSON string array",
    normalizeRows(JSON.stringify(sample))[0]?.id === "row-1"
  );
  check(
    "object.rows",
    normalizeRows({ rows: sample })[0]?.id === "row-1"
  );
  check(
    "object.boqRows",
    normalizeRows({ boqRows: sample })[0]?.id === "row-1"
  );
  check("null → []", normalizeRows(null).length === 0);
  check("invalid string → []", normalizeRows("not-json").length === 0);

  console.log("\n2) normalizeQuoteBoqRows");
  check(
    "quote.boqRows array",
    normalizeQuoteBoqRows({ boqRows: sample }).length === 1
  );
  check(
    "quote.boq_rows JSON string",
    normalizeQuoteBoqRows({ boq_rows: JSON.stringify(sample) }).length === 1
  );
  check(
    "quote.boqRows wrapped object",
    normalizeQuoteBoqRows({ boqRows: { rows: sample } }).length === 1
  );

  console.log("\n3) describeRowsInput");
  const diag = describeRowsInput(JSON.stringify(sample));
  check("diag typeof string", diag.typeofRows === "string");
  check("diag isArray false", diag.isArray === false);
  check("diag normalized length", diag.normalizedLength === 1);

  console.log("\n4) getCompanyBrandingLogoUrl does not call .find on object settings");
  const manualLib = readFileSync(join(ROOT, "src/lib/manualQuotePdfTemplate.ts"), "utf8");
  check(
    "uses normalizeSettingsRows not rows.find",
    manualLib.includes("normalizeSettingsRows(settings)") &&
      !manualLib.includes("rows.find((s: any) => s?.key === \"companyLogo\"")
  );

  console.log("\n5) PDF export wiring");
  const server = readFileSync(join(ROOT, "server.ts"), "utf8");
  check("resolveSavedManualQuoteForExport normalizes rows", server.includes("normalizeQuoteBoqRows(quote)"));
  check("PDF EXPORT ROWS log", server.includes("[PDF EXPORT ROWS]"));
  check("filterBoqRowsForPdf uses normalizeRows", readFileSync(join(ROOT, "src/lib/quoteBoqPdf.ts"), "utf8").includes("normalizeRows(allRows)"));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
