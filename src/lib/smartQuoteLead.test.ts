import assert from "node:assert/strict";
import { isSmartQuoteLead, parseSmartQuoteLeadNotes } from "./smartQuoteLead";

assert.equal(isSmartQuoteLead({ leadSource: "Smart Quote" }), true);
assert.equal(isSmartQuoteLead({ leadSource: "Marketing Website" }), false);

const parsed = parseSmartQuoteLeadNotes([
  "SMART_QUOTE_V1",
  "Quote: SES-20260921-1234",
  "System: 8 kW",
  "Estimate: PKR 1328595",
  "Panel: 13 × AIKO 645W",
  "Inverter: 1 × itel 8kW",
  "Battery: 1 × Dyness 16.08kWh",
  "Structure: L2 standard stands (13 panels)",
  "Generated: 2026-09-21T06:52:00.000Z",
].join("\n"));

assert.ok(parsed);
assert.equal(parsed.quoteNumber, "SES-20260921-1234");
assert.equal(parsed.estimatePkr, 1_328_595);
assert.equal(parsed.battery, "1 × Dyness 16.08kWh");
assert.equal(parseSmartQuoteLeadNotes("ordinary note"), null);

console.log("Smart Quote lead parsing tests passed.");

