import assert from "node:assert/strict";
import { findMissingPayments, parseVyaparImportPayload } from "./vyaparMatchedImport";

const base = {
  invoices: [{
    invoiceNumber: "1001",
    invoiceDate: "2026-01-02",
    customerName: "Example Client",
    items: [{ itemName: "Solar system", qty: 1, rate: 1000 }],
    payments: [
      { amount: 400, paymentMethod: "Cash", paymentDate: "2026-01-02", referenceNumber: "R-1" },
      { amount: 400, paymentMethod: "Cash", paymentDate: "2026-01-02", referenceNumber: "R-1" },
    ],
  }],
};

const { summary } = parseVyaparImportPayload(JSON.stringify(base));
assert.deepEqual(summary, {
  invoiceCount: 1,
  partyCount: 1,
  itemCount: 1,
  paymentCount: 2,
  salesTotal: 1000,
  paymentTotal: 800,
  balanceTotal: 200,
  unresolvedReceiptCount: 0,
});

const desired = base.invoices[0].payments;
assert.equal(findMissingPayments(desired, [desired[0]]).length, 1, "duplicate receipt is preserved");
assert.equal(findMissingPayments(desired, desired).length, 0, "completed import is idempotent");

assert.throws(
  () => parseVyaparImportPayload(JSON.stringify({ invoices: [{ ...base.invoices[0], items: [] }] })),
  /at least one item/
);
assert.throws(() => parseVyaparImportPayload("not json"), /not valid JSON/);

console.log("Vyapar matched import tests passed.");
