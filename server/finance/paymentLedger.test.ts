import assert from "node:assert/strict";
import { test } from "node:test";
import {
  balanceAfterLedger,
  describeInvoiceChange,
  DUPLICATE_PAYMENT_WINDOW_MS,
  findRecentDuplicatePayment,
  ledgerTotal,
  normalizeClientRequestId,
  overpaymentError,
  paymentIdFor,
  roundMoney,
} from "./paymentLedger.ts";

const base = { invoiceId: "inv-1", amount: 25000, paymentMethod: "Cash", paymentDate: "2026-10-09", referenceNumber: null, notes: null, recordedBy: "accounts", nowMs: Date.parse("2026-10-09T10:00:00Z") };

test("retries of one submission map to one payment id; separate submissions do not", () => {
  const id = paymentIdFor({ ...base, clientRequestId: "req-aaaaaaaa" });
  assert.equal(paymentIdFor({ ...base, clientRequestId: "req-aaaaaaaa", nowMs: base.nowMs + 60 * 60 * 1000 }), id, "a retry an hour later is still the same payment");
  assert.notEqual(paymentIdFor({ ...base, clientRequestId: "req-bbbbbbbb" }), id);
  assert.notEqual(paymentIdFor({ ...base, invoiceId: "inv-2", clientRequestId: "req-aaaaaaaa" }), id);
  assert.match(id, /^pay-[a-f0-9]{32}$/);
});

test("clients without a request id still collide on an immediate double tap", () => {
  const first = paymentIdFor({ ...base, clientRequestId: null });
  assert.equal(paymentIdFor({ ...base, clientRequestId: null, nowMs: base.nowMs + 1 }), first);
  assert.notEqual(paymentIdFor({ ...base, clientRequestId: null, amount: 25001 }), first);
  assert.notEqual(paymentIdFor({ ...base, clientRequestId: null, nowMs: base.nowMs + DUPLICATE_PAYMENT_WINDOW_MS }), first);
});

test("client request ids are validated", () => {
  assert.equal(normalizeClientRequestId("7d0f7a43-5b8b-4b6c-9f4c-1f0d3a4b2c11"), "7d0f7a43-5b8b-4b6c-9f4c-1f0d3a4b2c11");
  for (const bad of ["", "short", "has space here", "a".repeat(81), 12345678, null]) assert.equal(normalizeClientRequestId(bad), null);
});

test("an identical recent payment is detected as a duplicate; older or different ones are not", () => {
  const recorded = [{ id: "pay-x", amount: 25000, paymentMethod: "Cash", paymentDate: "2026-10-09", referenceNumber: null, notes: null, recordedBy: "accounts", createdAt: "2026-10-09T09:59:30Z" }];
  const candidate = { amount: 25000, paymentMethod: "Cash", paymentDate: "2026-10-09", referenceNumber: null, notes: null, recordedBy: "accounts", nowMs: base.nowMs };
  assert.equal(findRecentDuplicatePayment(recorded, candidate)?.id, "pay-x");
  assert.equal(findRecentDuplicatePayment(recorded, { ...candidate, nowMs: base.nowMs + DUPLICATE_PAYMENT_WINDOW_MS }), null);
  assert.equal(findRecentDuplicatePayment(recorded, { ...candidate, referenceNumber: "CHQ-2" }), null);
  assert.equal(findRecentDuplicatePayment(recorded, { ...candidate, recordedBy: "someone-else" }), null);
});

test("partial payments, balances and rounding match independently computed values", () => {
  // Three instalments of a PKR 100,000 invoice: 33,333.33 + 33,333.33 + 33,333.34 = 100,000.00 exactly.
  const instalments = [{ amount: 33333.33 }, { amount: 33333.33 }, { amount: 33333.34 }];
  assert.equal(ledgerTotal(instalments.slice(0, 1)), 33333.33);
  assert.equal(balanceAfterLedger(100000, ledgerTotal(instalments.slice(0, 2))), 33333.34);
  assert.equal(ledgerTotal(instalments), 100000);
  assert.equal(balanceAfterLedger(100000, ledgerTotal(instalments)), 0);
  // Binary floating point: 0.1 + 0.2 must still settle a PKR 0.30 balance.
  assert.equal(balanceAfterLedger(0.3, ledgerTotal([{ amount: 0.1 }, { amount: 0.2 }])), 0);
  assert.equal(roundMoney(1234.565), 1234.57);
});

test("payments that exceed the balance due are rejected with the balance in the message", () => {
  assert.equal(overpaymentError(75000, 100000, 25000), null, "paying exactly the balance is allowed");
  assert.match(String(overpaymentError(75000.01, 100000, 25000)), /exceeds the balance due of PKR 75,000/);
  assert.match(String(overpaymentError(1, 100000, 100000)), /already fully paid/);
  assert.equal(overpaymentError(33333.34, 100000, 66666.66), null, "rounding at the last instalment is not an overpayment");
});

test("invoice edits are described field by field for the audit trail", () => {
  const before = { grandTotal: 100000, paidAmount: 25000, balanceDue: 75000, customerName: "Synthetic Client", items: [{ itemName: "System", qty: 1, rate: 100000 }] };
  const after = { grandTotal: 120000, paidAmount: 25000, balanceDue: 95000, customerName: "Synthetic Client", items: [{ itemName: "System", qty: 1, rate: 120000 }] };
  assert.deepEqual(describeInvoiceChange(before, after), [
    "grand total: 100000 → 120000",
    "balance: 75000 → 95000",
    "items: [System×1@100000] → [System×1@120000]",
  ]);
  assert.deepEqual(describeInvoiceChange(before, before), []);
});
