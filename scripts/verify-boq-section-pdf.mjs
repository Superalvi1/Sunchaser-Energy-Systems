/**
 * Phase 18B — BOQ section headers in quotation PDF.
 * Usage: node scripts/verify-boq-section-pdf.mjs
 */
import {
  filterBoqRowsForPdf,
  renderBoqTableBodyHtml,
  ensureBoqSectionSubtotals,
} from "../src/lib/quoteBoqPdf.ts";

const formatPKR = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

const sampleRows = [
  { id: "h-1", type: "heading", name: "Imported Equipment" },
  { id: "i-1", type: "item", srNo: "1", name: "Longi X10", qty: 10, rate: 25000, total: 250000, unit: "Pcs" },
  { id: "i-2", type: "item", srNo: "2", name: "ITEL IPV-8K48U Hybrid Inverter", qty: 1, rate: 400000, total: 400000, unit: "Pcs" },
  { id: "s-1", type: "subtotal", name: "Imported Equipment Subtotal", total: 650000 },
  { id: "h-2", type: "heading", name: "Cables & Conductors" },
  { id: "i-3", type: "item", srNo: "3", name: "LS DC Cable", qty: 100, rate: 500, total: 50000, unit: "Mtr" },
  { id: "i-4", type: "item", srNo: "4", name: "GM AC Cable", qty: 50, rate: 800, total: 40000, unit: "Mtr" },
  { id: "h-5", type: "heading", name: "Earthing" },
  { id: "i-5", type: "item", srNo: "5", name: "Earthing Copper Wire", qty: 1, rate: 15000, total: 15000, unit: "Lot" },
];

function pass(id, ok, msg) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${msg}`);
  return ok;
}

let ok = true;

const filtered = filterBoqRowsForPdf(sampleRows, { includeSizerItems: false });
ok &= pass("1 filter keeps headings", filtered.some((r) => r.type === "heading"), `${filtered.filter((r) => r.type === "heading").length} heading(s)`);
ok &= pass("2 filter keeps items", filtered.filter((r) => r.type === "item").length === 5, "5 items");

const { html, calculatedGross } = renderBoqTableBodyHtml(filtered, formatPKR);
ok &= pass("3 html has IMPORTED EQUIPMENT", html.includes("IMPORTED EQUIPMENT"), "found");
ok &= pass("4 html has CABLES &amp; CONDUCTORS", html.includes("CABLES &amp; CONDUCTORS"), "found");
ok &= pass("5 html has EARTHING", html.includes("EARTHING"), "found");
ok &= pass("6 section header class", html.includes("boq-section-header"), "css class present");
ok &= pass("7 sr 1 preserved", html.includes(">1<"), "sr 1");
ok &= pass("8 gross from items only", calculatedGross === 755000, `Rs. ${calculatedGross}`);

const legacyItems = [
  { id: "x-1", type: "item", name: "Legacy panel", qty: 1, rate: 1000, total: 1000, unit: "Pcs" },
  { id: "x-2", type: "item", name: "Legacy inverter", qty: 1, rate: 2000, total: 2000, unit: "Pcs" },
];
const legacyFiltered = filterBoqRowsForPdf(legacyItems, { includeSizerItems: false });
const legacy = renderBoqTableBodyHtml(legacyFiltered, formatPKR);
ok &= pass("9 legacy items-only renders", legacy.html.includes("Legacy panel"), "2 rows");
ok &= pass("10 legacy no section header required", !legacy.html.includes("boq-section-header"), "no headers");

const noSubtotalRows = [
  { id: "h-1", type: "heading", name: "Imported Equipment" },
  { id: "i-1", type: "item", name: "Longi X10", qty: 10, rate: 25000, total: 250000, unit: "Pcs" },
  { id: "i-2", type: "item", name: "ITEL Inverter", qty: 1, rate: 501050, total: 501050, unit: "Pcs" },
];
const ensured = ensureBoqSectionSubtotals(noSubtotalRows);
ok &= pass("11 auto subtotal inserted", ensured.some((r) => r.type === "subtotal"), "subtotal row");
ok &= pass("12 auto subtotal amount", ensured.find((r) => r.type === "subtotal")?.total === 751050, "751050");
const autoHtml = renderBoqTableBodyHtml(noSubtotalRows, formatPKR);
ok &= pass("13 subtotal label in pdf", autoHtml.html.includes("Imported Equipment Subtotal:"), "label");
ok &= pass("14 subtotal amount in pdf", autoHtml.html.includes("751,050"), "amount");

console.log(`\n${ok ? "ALL PASS" : "SOME FAILURES"}\n`);
process.exit(ok ? 0 : 1);
