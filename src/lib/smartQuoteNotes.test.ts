import assert from "node:assert/strict";
import { test } from "node:test";
import {
  editableLeadNotes,
  leadLatestActivityAt,
  mergeStaffEditedLeadNotes,
  parseSmartQuoteLeadNotes,
  parseSmartQuotePdfArchive,
  quoteSnapshot,
  replaceSmartQuoteBlock,
  splitSmartQuoteNotes,
} from "./smartQuoteLead";

const snapshot = JSON.stringify({ lines: [{ category: "Equipment", description: "Panels", specification: "585W", unit: "pcs", quantity: 14, unitPricePkr: 20000, totalPkr: 280000 }], subtotalPkr: 280000, discountPkr: 0 });
const archive = JSON.stringify({ quoteNumber: "SES-20261009-1001", fileName: "q.pdf", fileUrl: "/api/storage/object/customer-documents/abc?sig=1", sha256: "a".repeat(64), savedAt: "2026-10-09T05:00:00Z", sizeBytes: 10 });
const block = ["SMART_QUOTE_V1", "Quote: SES-20261009-1001", "Version: 1", "System: 8 kW", "Estimate: PKR 280000", "Panel: 14 × Test 585W", "Inverter: 1 × Test", "Battery: Not included", "Structure: Standard", "Generated: 2026-10-09T05:00:00.000Z", `Snapshot: ${snapshot}`].join("\n");
const notes = `${block}\nPdfArchive: ${archive}\nClient prefers evening calls`;

test("staff notes are separated from the saved quotation block", () => {
  const { machine, human } = splitSmartQuoteNotes(notes);
  assert.equal(machine.length, 12);
  assert.deepEqual(human, ["Client prefers evening calls"]);
  assert.equal(editableLeadNotes(notes), "Client prefers evening calls");
});

test("a staff notes edit cannot delete or forge the saved quotation", () => {
  const edited = mergeStaffEditedLeadNotes(notes, "Visited site; roof OK");
  assert.equal(parseSmartQuoteLeadNotes(edited)?.quoteNumber, "SES-20261009-1001");
  assert.deepEqual(quoteSnapshot(edited), JSON.parse(snapshot));
  assert.equal(parseSmartQuotePdfArchive(edited)?.fileName, "q.pdf");
  assert.match(edited, /Visited site; roof OK$/);
  assert.doesNotMatch(edited, /evening calls/, "removed staff notes stay removed");
  const forged = mergeStaffEditedLeadNotes(notes, `${block.replace("280000", "1")}\nPdfArchive: {"fileUrl":"https://evil.example"}`);
  assert.equal(parseSmartQuoteLeadNotes(forged)?.estimatePkr, 280000, "pasted quotation lines do not replace the saved quotation");
  assert.doesNotMatch(forged, /evil\.example/);
});

test("old clients that resend the whole notes text do not duplicate the block", () => {
  const resent = mergeStaffEditedLeadNotes(notes, notes);
  assert.equal(resent.match(/SMART_QUOTE_V1/g)?.length, 1);
  assert.equal(resent, notes);
});

test("non Smart Quote leads keep free-form notes unchanged", () => {
  assert.equal(mergeStaffEditedLeadNotes("Walk-in client", "Walk-in client\nQuote: wants 10kW"), "Walk-in client\nQuote: wants 10kW");
});

test("a newer quotation replaces the summary but keeps staff notes", () => {
  const next = block.replace("SES-20261009-1001", "SES-20261009-1002").replace("Version: 1", "Version: 2");
  const replaced = replaceSmartQuoteBlock(notes, next);
  assert.equal(parseSmartQuoteLeadNotes(replaced)?.quoteNumber, "SES-20261009-1002");
  assert.equal(parseSmartQuotePdfArchive(replaced), null, "the older version's PDF is not shown as the latest");
  assert.match(replaced, /Client prefers evening calls$/);
});

test("lead activity time follows the latest quotation", () => {
  assert.equal(leadLatestActivityAt({ createdAt: "2026-10-01T00:00:00Z", notes }), Date.parse("2026-10-09T05:00:00.000Z"));
  assert.equal(leadLatestActivityAt({ createdAt: "2026-10-01T00:00:00Z", notes: "manual" }), Date.parse("2026-10-01T00:00:00Z"));
});
