// Application-level payment tests on the local JSON store (no network, no Supabase). The live HTTP suite against a real
// PostgreSQL + PostgREST stack lives in scripts/e2e-crm-repair/j8-payment-concurrency.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdminInvoice, InvoiceDbError, recordInvoicePayment } from "../../invoiceDb.ts";

delete process.env.SUPABASE_URL;
delete process.env.RAILWAY_POSTGREST_URL;

const ADMIN = ["u1", "admin", "Super Admin"] as const;
const fresh = () => ({ users: [{ id: "u1", username: "admin", role: "Super Admin" }], invoices: [], invoiceItems: [], invoicePayments: [], customers: [], activityLogs: [] }) as any;
async function invoice(db: any, total = 100000) {
  return createAdminInvoice(...ADMIN, { customerName: "Synthetic Client", items: [{ itemName: "System", description: "System", qty: 1, rate: total, taxPercent: 0, discountAmount: 0 }] }, db);
}
const pay = (db: any, id: string, body: Record<string, unknown>) => recordInvoicePayment(...ADMIN, id, body, db);
const ledger = (db: any, id: string) => db.invoicePayments.filter((p: any) => p.invoice_id === id);
const sum = (rows: any[]) => rows.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
type Outcome = { ok: boolean; replayed?: boolean; status?: number; code?: string; message?: string };
const outcome = async (p: Promise<any>): Promise<Outcome> => p.then((r) => ({ ok: true, replayed: r.replayed as boolean }), (e: InvoiceDbError) => ({ ok: false, status: e.statusCode, code: e.code, message: e.message }));
let n = 0;
const rid = () => `req-${String(++n).padStart(8, "0")}`;

test("five parallel 30,000 payments on a 100,000 invoice: at most three are recorded and the ledger never exceeds the total", async () => {
  const db = fresh(); const inv = await invoice(db);
  const rs = await Promise.all(Array.from({ length: 5 }, () => outcome(pay(db, inv.id, { amount: 30000, clientRequestId: rid() }))));
  assert.equal(rs.filter((r) => r.ok).length, 3);
  assert.equal(rs.filter((r) => !r.ok && r.status === 422).length, 2);
  assert.equal(sum(ledger(db, inv.id)), 9000000);
  const row = db.invoices.find((i: any) => i.id === inv.id);
  assert.equal(row.paid_amount, 90000);
  assert.equal(row.balance_due, 10000);
});

test("identical amounts with distinct request ids are all recorded", async () => {
  const db = fresh(); const inv = await invoice(db);
  const rs = await Promise.all(Array.from({ length: 5 }, () => outcome(pay(db, inv.id, { amount: 10000, paymentMethod: "Cash", clientRequestId: rid() }))));
  assert.ok(rs.every((r) => r.ok && !r.replayed));
  assert.equal(sum(ledger(db, inv.id)), 5000000);
  assert.equal(db.invoices[0].paid_amount, 50000);
});

test("twenty parallel retries of one request id record exactly one payment", async () => {
  const db = fresh(); const inv = await invoice(db); const clientRequestId = rid();
  const rs = await Promise.all(Array.from({ length: 20 }, () => outcome(pay(db, inv.id, { amount: 100000, paymentMethod: "Cash", clientRequestId }))));
  assert.equal(rs.filter((r) => r.ok && !r.replayed).length, 1);
  assert.equal(rs.filter((r) => r.ok && r.replayed).length, 19, "retries are replays even when the first copy used the whole balance");
  assert.equal(ledger(db, inv.id).length, 1);
});

test("a request id reused for a different payment is a conflict; a leaner retry is a replay", async () => {
  const db = fresh(); const inv = await invoice(db); const clientRequestId = rid();
  await pay(db, inv.id, { amount: 10000, paymentMethod: "Cash", notes: "advance", clientRequestId });
  const other = await outcome(pay(db, inv.id, { amount: 20000, paymentMethod: "Cash", clientRequestId }));
  assert.deepEqual([other.ok, !other.ok && other.status, !other.ok && other.code], [false, 409, "PAYMENT_REQUEST_CONFLICT"]);
  const method = await outcome(pay(db, inv.id, { amount: 10000, paymentMethod: "Cheque", clientRequestId }));
  assert.equal(!method.ok && method.status, 409);
  const lean = await outcome(pay(db, inv.id, { amount: 10000, clientRequestId }));
  assert.deepEqual([lean.ok, lean.ok && lean.replayed], [true, true]);
  assert.equal(ledger(db, inv.id).length, 1);
  assert.equal(sum(ledger(db, inv.id)), 1000000);
});

test("legacy clients: an identical payment is blocked with a code, and an explicit confirmation lets a genuine second payment through", async () => {
  const db = fresh(); const inv = await invoice(db);
  const body = { amount: 25000, paymentMethod: "Cash", paymentDate: "2026-10-09", notes: "legacy" };
  assert.equal((await outcome(pay(db, inv.id, body))).ok, true);
  const blocked = await outcome(pay(db, inv.id, body));
  assert.deepEqual([blocked.ok, !blocked.ok && blocked.status, !blocked.ok && blocked.code], [false, 409, "DUPLICATE_PAYMENT_SUSPECTED"]);
  assert.equal(ledger(db, inv.id).length, 1, "never a silent drop and never a silent second row");
  assert.equal((await outcome(pay(db, inv.id, { ...body, confirmDuplicate: "yes" }))).ok, false, "only the boolean true confirms");
  assert.equal((await outcome(pay(db, inv.id, { ...body, confirmDuplicate: true }))).ok, true);
  assert.equal(ledger(db, inv.id).length, 2);
  assert.equal(sum(ledger(db, inv.id)), 5000000);
  // confirmation never bypasses the balance check
  const over = await outcome(pay(db, inv.id, { ...body, amount: 60000, confirmDuplicate: true }));
  assert.deepEqual([over.ok, !over.ok && over.status], [false, 422]);
  // with a request id the legacy guard does not apply at all: genuine identical payments just work
  assert.equal((await outcome(pay(db, inv.id, { ...body, amount: 10000, clientRequestId: rid() }))).ok, true);
  assert.equal((await outcome(pay(db, inv.id, { ...body, amount: 10000, clientRequestId: rid() }))).ok, true);
});

test("amounts that are not plain positive decimals never become money", async () => {
  const db = fresh(); const inv = await invoice(db);
  for (const bad of [0, -500, "NaN", "abc", "", null, undefined, true, [5], { a: 1 }, "0x10", "1e3", "12,000", "Infinity", 0.004]) {
    const r = await outcome(pay(db, inv.id, { amount: bad, clientRequestId: rid() }));
    assert.equal(r.ok, false, `refused: ${JSON.stringify(bad)}`);
  }
  assert.equal(ledger(db, inv.id).length, 0);
  assert.equal((await outcome(pay(db, inv.id, { amount: "100.005", clientRequestId: rid() }))).ok, true);
  assert.equal(ledger(db, inv.id)[0].amount, 100.01, "sub-paisa input is rounded half-up once, deliberately");
  const huge = await outcome(pay(db, inv.id, { amount: 1e30, clientRequestId: rid() }));
  assert.equal(!huge.ok && huge.status, 422);
});

test("three instalments settle the invoice exactly and the last paisa is not an overpayment", async () => {
  const db = fresh(); const inv = await invoice(db);
  for (const amount of [33333.33, 33333.33, 33333.34]) assert.equal((await outcome(pay(db, inv.id, { amount, clientRequestId: rid() }))).ok, true);
  assert.equal(sum(ledger(db, inv.id)), 10000000);
  const row = db.invoices[0];
  assert.deepEqual([row.paid_amount, row.balance_due, row.payment_status], [100000, 0, "Paid"]);
  const extra = await outcome(pay(db, inv.id, { amount: 0.01, clientRequestId: rid() }));
  assert.equal(!extra.ok && extra.status, 422);
});

test("void, duplicate and test invoices refuse payments; archived invoices stay collectible", async () => {
  for (const status of ["void", "duplicate", "test"]) {
    const db = fresh(); const inv = await invoice(db); db.invoices[0].invoice_status = status;
    const r = await outcome(pay(db, inv.id, { amount: 1000, clientRequestId: rid() }));
    assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.code], [false, 409, "INVOICE_NOT_COLLECTIBLE"], status);
    assert.equal(ledger(db, inv.id).length, 0);
  }
  const db = fresh(); const inv = await invoice(db); db.invoices[0].invoice_status = "archived";
  assert.equal((await outcome(pay(db, inv.id, { amount: 1000, clientRequestId: rid() }))).ok, true);
});
