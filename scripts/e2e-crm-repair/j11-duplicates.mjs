// J11: legitimate duplicate-value payments, the 2-minute duplicate guard, confirmDuplicate, boundaries, rounding and huge values.
// Disposable stack only; run with the database guard installed (the same assertions hold without it, except the DB-level ones, which are skipped).
//   node --import tsx scripts/e2e-crm-repair/j11-duplicates.mjs      (tsx is needed to import the Vyapar importer's own helper)
import pg from "pg";
import { STATE, BASE, sql, apiLogin, check, save } from "./lib.mjs";
import { findMissingPayments } from "../../src/lib/vyaparMatchedImport.ts";

const BASE2 = process.env.E2E_BASE_URL_2;
const token = await apiLogin("t_admin");
const call = async (method, path, body, base = BASE) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: r.status, code: json.code || "", json };
};
const uuid = () => globalThis.crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
let seq = 0;
async function newInvoice(total = 100000, extra = {}) {
  seq += 1;
  const r = await call("POST", "/api/admin/invoices", { customerName: `J11 Dup Client ${process.pid}-${seq}`, customerPhone: "0313" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: today, paidAmount: 0,
    items: [{ itemName: "Synthetic", description: "Synthetic", qty: 1, rate: total, unit: "job", taxPercent: 0, discountAmount: 0 }], ...extra });
  if (r.status !== 201) throw new Error(`invoice create failed ${r.status}`);
  await new Promise((res) => setTimeout(res, 3));
  return r.json.invoice;
}
const pay = (id, body, base = BASE) => call("POST", `/api/admin/invoices/${id}/payments`, body, base);
const st = (id) => { const [r] = sql(`select (select count(*) from invoice_payments where invoice_id='${id}'), (select coalesce(sum((amount*100)::bigint),0) from invoice_payments where invoice_id='${id}'), (paid_amount*100)::bigint, (balance_due*100)::bigint, payment_status from invoices where id='${id}'`).split("\n").map((l) => l.split("|")); return { rows: +r[0], ledger: +r[1], paid: +r[2], balance: +r[3], status: r[4] }; };
const guard = sql("select count(*) from pg_trigger where tgname='invoice_payments_before_insert_guard' and not tgisinternal") === "1";
console.log(`database guard installed: ${guard}`);

// 1. identical values, distinct request ids: all recorded, sequential and parallel, across both instances
{
  const inv = await newInvoice(); const body = () => ({ amount: 10000, paymentMethod: "Cash", paymentDate: today, referenceNumber: "R-100", notes: "same on purpose", clientRequestId: uuid() });
  const a = await pay(inv.id, body()), b = await pay(inv.id, body());
  const par = await Promise.all([pay(inv.id, body()), pay(inv.id, body(), BASE2 || BASE), pay(inv.id, body())]);
  const s = st(inv.id);
  check("two real payments with identical amount/date/method/reference/notes and different request ids are both recorded (sequential)", a.status === 201 && b.status === 201, `${a.status}/${b.status}`);
  check("three more identical payments in parallel from two instances are all recorded; ledger = 5 x 10,000", par.every((r) => r.status === 201) && s.rows === 5 && s.ledger === 5000000 && s.paid === s.ledger, JSON.stringify(s));
}

// 2. legacy client (no request id): the 2-minute guard applies to it only
{
  const inv = await newInvoice(); const body = { amount: 12000, paymentMethod: "Cash", paymentDate: today, referenceNumber: "L-1", notes: "legacy" };
  const first = await pay(inv.id, body), dup = await pay(inv.id, body);
  check("legacy client: an identical second payment within 2 minutes is blocked with 409 DUPLICATE_PAYMENT_SUSPECTED", first.status === 201 && dup.status === 409 && dup.code === "DUPLICATE_PAYMENT_SUSPECTED", `${first.status}/${dup.status}/${dup.code}`);
  const confirmed = await pay(inv.id, { ...body, confirmDuplicate: true }), confirmed2 = await pay(inv.id, { ...body, confirmDuplicate: true });
  const s = st(inv.id);
  check("confirmDuplicate:true records the second payment through the HTTP route (each confirmation is its own payment)", confirmed.status === 201 && confirmed2.status === 201 && s.rows === 3 && s.ledger === 3600000, `${confirmed.status}/${confirmed2.status} rows=${s.rows}`);
  const withId = await pay(inv.id, { ...body, clientRequestId: uuid() });
  check("a client that sends a request id is NEVER stopped by the 2-minute guard, with or without confirmDuplicate", withId.status === 201 && (await pay(inv.id, { ...body, clientRequestId: uuid(), confirmDuplicate: true })).status === 201, String(withId.status));
  // age the stored rows beyond the window: a different user-visible detail is no longer required, but the deterministic id bucket still protects against a double tap
  sql(`update invoice_payments set created_at = created_at - interval '5 minutes' where invoice_id='${inv.id}'`);
  const aged = await pay(inv.id, { ...body, referenceNumber: "L-2" });
  check("legacy client: a payment that differs (new reference) is not treated as a duplicate", aged.status === 201, String(aged.status));
}

// 3. Party Ledger modal behaviour (src/components/PartyLedgerStaff.tsx): one request id per submission, kept across retries, reset when the amount changes
{
  const inv = await newInvoice(50000); const id = uuid();
  const tooMuch = await pay(inv.id, { amount: 60000, paymentMethod: "Cash", paymentDate: today, clientRequestId: id });
  check("modal: an overpayment is a friendly 422 with a code, nothing stored", tooMuch.status === 422 && tooMuch.code === "PAYMENT_EXCEEDS_BALANCE" && st(inv.id).rows === 0, `${tooMuch.status} ${tooMuch.code}`);
  const id2 = uuid(); // the amount input changed, so the modal minted a new id
  const ok = await pay(inv.id, { amount: 20000, paymentMethod: "Cash", paymentDate: today, clientRequestId: id2 });
  const lost = await pay(inv.id, { amount: 20000, paymentMethod: "Cash", paymentDate: today, clientRequestId: id2 }); // response lost, user presses Save again
  const changed = await pay(inv.id, { amount: 20000, paymentMethod: "Cheque", paymentDate: today, clientRequestId: id2 }); // changed method but kept the id
  check("modal: lost-response retry is a replay (200), a changed method under the same id is 409 PAYMENT_REQUEST_CONFLICT, one row only", ok.status === 201 && lost.status === 200 && lost.json.replayed === true && changed.status === 409 && changed.code === "PAYMENT_REQUEST_CONFLICT" && st(inv.id).rows === 1, `${ok.status}/${lost.status}/${changed.status}`);
}

// 4. Vyapar matched importer (src/components/VyaparMatchedImporter.tsx): fresh id per receipt, multiset compare against what exists
{
  const inv = await newInvoice(100000); const desired = [{ amount: 15000, paymentDate: today, paymentMethod: "Cash", referenceNumber: "V-1" }, { amount: 15000, paymentDate: today, paymentMethod: "Cash", referenceNumber: "V-1" }, { amount: 20000, paymentDate: today, paymentMethod: "Bank transfer", referenceNumber: "V-2" }];
  let created = 0;
  for (const run of [1, 2]) {
    const current = (await call("GET", `/api/admin/invoices/${inv.id}`)).json.invoice;
    for (const p of findMissingPayments(desired, current.payments || [])) { const r = await pay(inv.id, { ...p, clientRequestId: uuid() }); if (r.status === 201) created += 1; else console.log("importer payment refused", r.status, r.code); }
  }
  const s = st(inv.id);
  check("importer: two identical Vyapar receipts are both imported, and importing the same file again adds nothing", created === 3 && s.rows === 3 && s.ledger === 5000000, `created=${created} rows=${s.rows}`);
}

// 5. boundaries
{
  const inv = await newInvoice(100000);
  const part = await pay(inv.id, { amount: 99999.99, paymentMethod: "Cash", clientRequestId: uuid() });
  const over = await pay(inv.id, { amount: 0.02, paymentMethod: "Cash", clientRequestId: uuid() });
  const exact = await pay(inv.id, { amount: 0.01, paymentMethod: "Cash", clientRequestId: uuid() });
  const after = await pay(inv.id, { amount: 0.01, paymentMethod: "Cash", clientRequestId: uuid() });
  const s = st(inv.id);
  check("exactly the remaining balance (paid == total) is accepted and marks the invoice Paid; one paisa more is refused", part.status === 201 && over.status === 422 && exact.status === 201 && after.status === 422 && s.paid === 10000000 && s.balance === 0 && s.status === "Paid", `${part.status}/${over.status}/${exact.status}/${after.status} ${JSON.stringify(s)}`);
  const edited = await call("PATCH", `/api/admin/invoices/${inv.id}`, { items: [{ id: inv.items[0].id, itemName: "Synthetic", description: "Synthetic", qty: 1, rate: 120000, unit: "job", taxPercent: 0, discountAmount: 0 }] });
  const more = await pay(inv.id, { amount: 20000, paymentMethod: "Cash", clientRequestId: uuid() });
  const lower = await call("PATCH", `/api/admin/invoices/${inv.id}`, { items: [{ id: inv.items[0].id, itemName: "Synthetic", description: "Synthetic", qty: 1, rate: 110000, unit: "job", taxPercent: 0, discountAmount: 0 }] });
  const s2 = st(inv.id);
  check("after raising the total the remaining balance is payable; lowering the total below the ledger is a coded 422", edited.status === 200 && more.status === 201 && lower.status === 422 && s2.paid === 12000000 && s2.status === "Paid", `${edited.status}/${more.status}/${lower.status} ${JSON.stringify(s2)}`);
  const bad = [];
  for (const amount of [0, -1, 0.004, "0", "-5", null, "abc", "1e3", "0x10", "12,000", true]) { const r = await pay((await newInvoice(1000)).id, { amount, paymentMethod: "Cash", clientRequestId: uuid() }); if (r.status === 201) bad.push(JSON.stringify(amount)); else if (r.status >= 500) bad.push(`5xx:${JSON.stringify(amount)}`); }
  check("zero, negative, sub-half-paisa, text, exponent, hex, thousands-separator and boolean amounts are refused with a 4xx", bad.length === 0, bad.join(","));
}

// 6. paisa rounding
{
  const inv = await newInvoice(1000.1); const rs = [];
  for (const amount of ["0.1", "0.2", "100.005", "1.005", 0.005]) rs.push(await pay(inv.id, { amount, paymentMethod: "Cash", clientRequestId: uuid() }));
  const s = st(inv.id);
  check("sub-paisa input is rounded half-up once: 0.10 + 0.20 + 100.01 + 1.01 + 0.01 = 101.33", rs.every((r) => r.status === 201) && s.ledger === 10133 && s.paid === 10133 && s.balance === 100010 - 10133, JSON.stringify(s));
  if (guard) {
    const c = new pg.Client({ host: process.env.E2E_PSQL.split(" ")[1], port: Number(process.env.E2E_PSQL.split(" ")[3]), user: "postgres", database: process.env.E2E_PSQL.split(" ")[7] }); await c.connect();
    const total = (await c.query(`select grand_total from invoices where id=$1`, [inv.id])).rows[0].grand_total;
    await c.end();
    check("the stored total keeps its paisa (1000.1) so the arithmetic above is exact", Number(total) === 1000.1, String(total));
  }
}

// 7. huge values
{
  const inv = await newInvoice(9000000000000); // PKR 9 trillion
  const big = await pay(inv.id, { amount: 8999999999999.99, paymentMethod: "Cash", clientRequestId: uuid() });
  const rest = await pay(inv.id, { amount: 0.01, paymentMethod: "Cash", clientRequestId: uuid() });
  const s = st(inv.id);
  check("PKR 9 trillion invoice: payment of 8,999,999,999,999.99 + 0.01 is exact to the paisa", big.status === 201 && rest.status === 201 && s.paid === 900000000000000 && s.status === "Paid", `${big.status}/${rest.status} ${JSON.stringify(s)}`);
  const huge = [];
  const small = await newInvoice(1000);
  for (const amount of [1e15, 1e21, 1e300, Number.MAX_VALUE, 123456789012345678901234567890]) { const r = await pay(small.id, { amount, paymentMethod: "Cash", clientRequestId: uuid() }); huge.push(r.status); }
  check("absurdly large amounts are refused as an overpayment (422), never a 5xx and never stored", huge.every((s2) => s2 === 422 || s2 === 400) && st(small.id).rows === 0, huge.join(","));
}

// 8. database level (guard only): identical rows with different ids are accepted by the trigger itself
if (guard) {
  const inv = await newInvoice(100000);
  const out = [];
  for (const id of ["sqldup-a-" + uuid(), "sqldup-b-" + uuid()]) out.push(sql(`insert into invoice_payments(id,invoice_id,amount,payment_method,payment_date,reference_number,notes,recorded_by) values ('${id}','${inv.id}',30000,'Cash','${today}','SAME','SAME','sql') returning 1`));
  const s = st(inv.id);
  check("DB level: two rows with identical amount/date/method/reference but different ids are both accepted; the header follows the ledger", out.every((o) => o.startsWith("1")) && s.rows === 2 && s.paid === 6000000, JSON.stringify(s));
}
save(`${STATE}/j11-duplicates-results.json`);
