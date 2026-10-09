import assert from "node:assert/strict";
import { test } from "node:test";
import {
  balanceAfterLedger,
  confirmedPaymentId,
  describeInvoiceChange,
  DUPLICATE_PAYMENT_WINDOW_MS,
  findRecentDuplicatePayment,
  ledgerGuardKind,
  ledgerTotal,
  NON_COLLECTIBLE_INVOICE_STATUSES,
  normalizeClientRequestId,
  overpaymentError,
  parsePaymentAmount,
  paymentIdFor,
  paymentRequestConflict,
  roundMoney,
} from "./paymentLedger.ts";
import { newPaymentRequestId } from "../../src/lib/invoicePayments.ts";

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

test("rounding is half-up on the decimal digits, matching an independent integer-paisa reference", () => {
  // Reference: split the decimal text, add one paisa when the third decimal is 5 or more. No floating point multiplication.
  const reference = (text: string) => {
    const [whole, frac = ""] = text.split(".");
    const digits = (frac + "000").slice(0, 3);
    return Number(whole) * 100 + Number(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1 : 0);
  };
  const samples = ["1.005", "0.015", "2.675", "1234.565", "100.005", "100.004", "0.1", "33333.335", "8.125", "999999.995", "0.001", "0.005"];
  for (let i = 0; i < 400; i++) samples.push(`${Math.floor(Math.random() * 2_000_000)}.${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`);
  for (const text of samples) assert.equal(Math.round(roundMoney(Number(text)) * 100), reference(text), `rounding ${text}`);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(-1.005), -1.01, "half away from zero");
  assert.equal(roundMoney(Number.NaN), 0);
});

test("payment amounts are parsed strictly: only real amounts become money", () => {
  assert.equal(parsePaymentAmount(25000), 25000);
  assert.equal(parsePaymentAmount("25000.50"), 25000.5);
  assert.equal(parsePaymentAmount(" 5 "), 5);
  assert.equal(parsePaymentAmount("100.005"), 100.01);
  for (const bad of [true, false, [5], ["5"], "0x10", "1e3", "12,000", "Infinity", "NaN", "", "  ", "-5", "+5", "5 PKR", null, undefined, {}, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parsePaymentAmount(bad), null, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(parsePaymentAmount(-5), -5, "a negative number parses and is refused later as not positive");
});

test("reusing a request id for a different payment is reported, a leaner retry is not", () => {
  const stored = { id: "pay-1", amount: 10000, paymentMethod: "Cash", paymentDate: "2026-10-09", referenceNumber: null, notes: "advance" };
  assert.equal(paymentRequestConflict(stored, { amount: 10000 }), null, "only the amount was sent");
  assert.equal(paymentRequestConflict(stored, { amount: 10000, paymentMethod: "Cash", paymentDate: "2026-10-09", referenceNumber: null, notes: "advance" }), null);
  assert.equal(paymentRequestConflict(stored, { amount: 10000.004 }), null, "sub-paisa noise rounds to the same payment");
  assert.match(String(paymentRequestConflict(stored, { amount: 20000 })), /PKR 10,000 Cash on 2026-10-09/);
  assert.notEqual(paymentRequestConflict(stored, { amount: 10000, paymentMethod: "Cheque" }), null);
  assert.notEqual(paymentRequestConflict(stored, { amount: 10000, paymentDate: "2026-10-10" }), null);
  assert.notEqual(paymentRequestConflict(stored, { amount: 10000, referenceNumber: "CHQ-7" }), null);
  assert.notEqual(paymentRequestConflict(stored, { amount: 10000, notes: "balance" }), null);
});

test("confirmed second payments get their own id and the UI request ids pass server validation", () => {
  const a = confirmedPaymentId();
  assert.match(a, /^pay-[a-f0-9]{32}$/);
  assert.notEqual(confirmedPaymentId(), a);
  assert.equal(normalizeClientRequestId(newPaymentRequestId()) !== null, true);
});

test("database guard rejections are recognised by their stable tags only", () => {
  assert.equal(ledgerGuardKind({ code: "PT422", message: "invoice_overpayment: payment 80000.00 exceeds the balance due 70000.00" }), "overpayment");
  assert.equal(ledgerGuardKind({ message: "invoice_total_below_payments: invoice total 10.00 cannot be lower" }), "total_below_payments");
  assert.equal(ledgerGuardKind({ message: "invoice_not_collectible: invoice is marked void" }), "not_collectible");
  assert.equal(ledgerGuardKind({ message: "invoice_has_payments: an invoice with recorded payments" }), "has_payments");
  assert.equal(ledgerGuardKind({ message: "invoice_payment_invalid: payment amount must be positive" }), "invalid_payment");
  for (const other of [null, undefined, {}, { code: "23505", message: "duplicate key value violates unique constraint" }, { message: "the invoice_overpayment word later in text" }]) {
    assert.equal(ledgerGuardKind(other), null);
  }
  assert.deepEqual([...NON_COLLECTIBLE_INVOICE_STATUSES], ["void", "duplicate", "test"]);
});
