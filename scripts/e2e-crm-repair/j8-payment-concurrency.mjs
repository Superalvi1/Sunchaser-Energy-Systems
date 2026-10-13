// Journey 8: payment idempotency and concurrency over REAL parallel HTTP requests, verified in the database.
// Needs the isolated stack from README.md (synthetic data only). Optional: the database guard from the review
// (invoice-payments-integrity.sql) makes the same assertions hold across several app instances; this script reports
// whether it is installed and does not apply anything itself.
//   PAYMENT_ROUNDS=10 node scripts/e2e-crm-repair/j8-payment-concurrency.mjs
import { STATE, BASE, sql, apiLogin, check, save } from "./lib.mjs";

const ROUNDS = Number(process.env.PAYMENT_ROUNDS || 10);
const token = await apiLogin("t_admin");
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: r.status, json };
};
const par = (n, f) => Promise.all(Array.from({ length: n }, (_, i) => f(i)));
const uuid = () => globalThis.crypto.randomUUID();
const later = (ms, f) => new Promise((r) => setTimeout(r, Math.max(0, ms))).then(f);
const jitter = () => Math.floor(Math.random() * 120) - 30;
let seq = 0;
async function newInvoice(total = 100000) {
  seq += 1;
  const r = await call("POST", "/api/admin/invoices", { customerName: `Synthetic J8 Client ${Date.now()}-${seq}`, customerPhone: "0309" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: new Date().toISOString().slice(0, 10), paidAmount: 0,
    items: [{ itemName: "Synthetic system", description: "Synthetic system", qty: 1, rate: total, unit: "job", taxPercent: 0, discountAmount: 0 }] });
  if (r.status !== 201) throw new Error(`invoice create failed ${r.status}`);
  await new Promise((res) => setTimeout(res, 3)); // invoice ids are millisecond timestamps
  return r.json.invoice;
}
const pay = (id, body) => call("POST", `/api/admin/invoices/${id}/payments`, body);
// Integer paisa straight from numeric columns in SQL, never through floating point.
const state = (id) => {
  const [r] = sql(`select (select count(*) from invoice_payments where invoice_id='${id}'), (select coalesce(sum((amount*100)::bigint),0) from invoice_payments where invoice_id='${id}'),
    (grand_total*100)::bigint, (paid_amount*100)::bigint, (balance_due*100)::bigint, payment_status,
    (select count(*) from activity_logs where action='Invoice Payment Recorded' and details like '%(${id})%') from invoices where id='${id}'`).split("\n").map((l) => l.split("|"));
  return { rows: +r[0], ledger: +r[1], grand: +r[2], paid: +r[3], balance: +r[4], status: r[5], audits: +r[6] };
};
const guard = sql("select count(*) from pg_trigger where tgname in ('invoice_payments_before_insert_guard','invoices_before_update_ledger_guard') and not tgisinternal") === "2";
console.log(`database guard installed: ${guard}`);

// T1: one request id, 20 parallel retries
let bad = 0;
for (let i = 0; i < ROUNDS; i++) {
  const inv = await newInvoice(); const clientRequestId = uuid();
  const rs = await par(20, () => pay(inv.id, { amount: 10000, paymentMethod: "Cash", clientRequestId }));
  const s = state(inv.id);
  if (!(s.rows === 1 && rs.filter((r) => r.status === 201).length === 1 && rs.filter((r) => r.status === 200 && r.json.replayed).length === 19 && s.paid === s.ledger && s.audits === 1)) bad++;
}
check(`J8 T1 20 parallel retries of one request id x ${ROUNDS}: one row, one created, 19 replays, one audit, header = ledger`, bad === 0, `${ROUNDS - bad}/${ROUNDS} clean`);

// T2: identical amounts, distinct ids, in parallel: every legitimate payment is recorded
bad = 0;
for (let i = 0; i < ROUNDS; i++) {
  const inv = await newInvoice();
  const rs = await par(5, () => pay(inv.id, { amount: 10000, paymentMethod: "Cash", clientRequestId: uuid() }));
  const s = state(inv.id);
  if (!(rs.every((r) => r.status === 201) && s.rows === 5 && s.ledger === 5000000 && s.paid === s.ledger && s.audits === 5)) bad++;
}
check(`J8 T2 5 x PKR 10,000 distinct-id parallel payments x ${ROUNDS}: all recorded, ledger exact`, bad === 0, `${ROUNDS - bad}/${ROUNDS} clean`);

// T3: overpayment race
bad = 0;
for (let i = 0; i < Math.max(ROUNDS, 15); i++) {
  const inv = await newInvoice();
  const rs = await par(5, () => pay(inv.id, { amount: 30000, paymentMethod: "Cash", clientRequestId: uuid() }));
  const s = state(inv.id); const made = rs.filter((r) => r.status === 201).length;
  if (!(s.ledger <= s.grand && s.paid === s.ledger && s.balance >= 0 && made <= 3 && made + rs.filter((r) => r.status === 422).length === 5 && s.audits === made)) bad++;
}
check("J8 T3 5 parallel PKR 30,000 payments on a PKR 100,000 invoice: never above the total, header = ledger, rest are friendly 422s", bad === 0, `${bad} bad rounds`);

// T4: legacy clients without a request id
{
  const inv = await newInvoice(); const body = { amount: 25000, paymentMethod: "Cash", paymentDate: new Date().toISOString().slice(0, 10), notes: "legacy" };
  const first = await pay(inv.id, body), second = await pay(inv.id, body), confirmed = await pay(inv.id, { ...body, confirmDuplicate: true });
  const s = state(inv.id);
  check("J8 T4 legacy: a second identical payment is blocked with a coded 409 until the user confirms it, then recorded", first.status === 201 && second.status === 409 && second.json.code === "DUPLICATE_PAYMENT_SUSPECTED" && confirmed.status === 201 && s.rows === 2 && s.ledger === 5000000, `${first.status}/${second.status}/${confirmed.status} rows=${s.rows}`);
}

// T5: request id reused
{
  const a = await newInvoice(); const clientRequestId = uuid(); const base = { amount: 10000, paymentMethod: "Cash", notes: "j8", clientRequestId };
  await pay(a.id, base);
  const same = await pay(a.id, base), amount = await pay(a.id, { ...base, amount: 20000 }), method = await pay(a.id, { ...base, paymentMethod: "Cheque" });
  check("J8 T5 same request id: identical retry = replay (200); different amount or method = conflict (409), never a silent success", same.status === 200 && same.json.replayed === true && amount.status === 409 && amount.json.code === "PAYMENT_REQUEST_CONFLICT" && method.status === 409 && state(a.id).rows === 1, `${same.status}/${amount.status}/${method.status}`);
}

// T6: races with edits and deletes, statuses, amount hygiene, rounding
{
  let over = 0, drift = 0, lost = 0, linesOff = 0;
  const rounds = Math.max(ROUNDS * 4, 40);
  for (let i = 0; i < rounds; i++) {
    const inv = await newInvoice(); const off = jitter();
    await Promise.all([later(off, () => pay(inv.id, { amount: 80000, paymentMethod: "Cash", clientRequestId: uuid() })), later(-off, () => call("PATCH", `/api/admin/invoices/${inv.id}`, { items: [{ id: inv.items[0].id, itemName: "Synthetic system", description: "Synthetic system", qty: 1, rate: 50000, unit: "job", taxPercent: 0, discountAmount: 0 }] }))]);
    const s = state(inv.id); const lines = +sql(`select coalesce(sum((line_total*100)::bigint),0) from invoice_items where invoice_id='${inv.id}'`);
    if (s.ledger > s.grand) over++; if (s.paid !== s.ledger) drift++; if (lines !== s.grand) linesOff++;
    const del = await newInvoice(); const off2 = jitter();
    const [p] = await Promise.all([later(off2, () => pay(del.id, { amount: 10000, paymentMethod: "Cash", clientRequestId: uuid() })), later(-off2, () => call("DELETE", `/api/admin/invoices/${del.id}`, { confirmText: "DELETE" }))]);
    if (p.status === 201 && +sql(`select count(*) from invoice_payments where invoice_id='${del.id}'`) === 0) lost++;
  }
  check(`J8 T6 payment racing with an edit that lowers the total x ${rounds}: ledger <= total, header = ledger, lines = total`, over === 0 && drift === 0 && linesOff === 0, `ledger>total=${over} header!=ledger=${drift} lines!=total=${linesOff}`);
  check(`J8 T6 payment racing with permanent delete x ${rounds}: no acknowledged payment disappears`, lost === 0, `lost=${lost}`);
  const hyg = await newInvoice(); const accepted = [];
  for (const amount of [0, -5, "NaN", "abc", "", null, true, [5], {}, "0x10", "1e3", "12,000", "Infinity"]) { const r = await pay(hyg.id, { amount, clientRequestId: uuid() }); if (r.status === 201) accepted.push(JSON.stringify(amount)); }
  check("J8 T6 zero, negative, NaN, text, empty, null, boolean, array, object, hex, exponent, thousands-separator and Infinity amounts are refused", accepted.length === 0 && state(hyg.id).rows === 0, accepted.join(","));
  const rnd = await newInvoice(1000.1); for (const amount of ["0.1", "0.2", "100.005", "1.005"]) await pay(rnd.id, { amount, clientRequestId: uuid() });
  check("J8 T6 sub-paisa input is rounded half-up once (0.10 + 0.20 + 100.01 + 1.01 = 101.32)", state(rnd.id).ledger === 10132, `ledger paisa=${state(rnd.id).ledger}`);
  const v = await newInvoice(); sql(`update invoices set invoice_status='void' where id='${v.id}'`);
  const vr = await pay(v.id, { amount: 1000, clientRequestId: uuid() });
  check("J8 T6 a void invoice refuses payments (409)", vr.status === 409 && vr.json.code === "INVOICE_NOT_COLLECTIBLE", String(vr.status));
}

// T7: audit trail
{
  const inv = await newInvoice(50000); const clientRequestId = uuid();
  const rs = [await pay(inv.id, { amount: 20000, paymentMethod: "Cash", clientRequestId }), await pay(inv.id, { amount: 20000, paymentMethod: "Cash", clientRequestId }), await pay(inv.id, { amount: 99999, paymentMethod: "Cash", clientRequestId: uuid() }), await pay(inv.id, { amount: -1, clientRequestId: uuid() }), await pay(inv.id, { amount: 20000, paymentMethod: "Cash", clientRequestId: uuid() })];
  const s = state(inv.id);
  check("J8 T7 two accepted payments = two audit rows; the replay, the overpayment and the invalid amount add none", s.rows === 2 && s.audits === 2, `statuses=${rs.map((r) => r.status)} rows=${s.rows} audits=${s.audits}`);
}
save(`${STATE}/j8-results.json`);
