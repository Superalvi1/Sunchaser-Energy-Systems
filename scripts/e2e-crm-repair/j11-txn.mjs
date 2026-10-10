// J11: transaction semantics of the guard. Disposable stack only, guard installed.
//  a) a PostgREST insert runs the guard AND the header sync inside ONE transaction (same xmin), a refused insert leaves nothing behind
//  b) a lock held by another session: the waiting payment gives up with invoice_busy (409 at the DB, 503 INVOICE_BUSY from the app) instead of hanging
//  c) the error codes a client sees for a serialization failure and a deadlock between operator transactions, and that the app treats them as retryable
//      node scripts/e2e-crm-repair/j11-txn.mjs      (SLOW=1 adds the 35 s app-level busy test)
import fs from "node:fs";
import { createRequire } from "node:module";
import pg from "pg";
import { STATE, BASE, sql, apiLogin, check, save } from "./lib.mjs";
const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");
const stack = process.env.E2E_STACK_DIR || "/srv/e2e-guard";
const secret = /jwt-secret\s*=\s*"([^"]+)"/.exec(fs.readFileSync(`${stack}/pgrst.conf`, "utf8"))[1];
const PGRST = process.env.RAILWAY_POSTGREST_URL;
const rest = async (method, path, body) => { const r = await fetch(PGRST + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ role: "service_role" }, secret, { expiresIn: "10m" })}` }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = {}; } return { status: r.status, json: j }; };
const args = process.env.E2E_PSQL.split(" "); const arg = (f) => args[args.indexOf(f) + 1];
const dbc = () => new pg.Client({ host: arg("-h"), port: Number(arg("-p")), user: arg("-U"), database: arg("-d") });
const token = await apiLogin("t_admin");
const app = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = {}; } return { status: r.status, code: j.code || "", json: j }; };
let seq = 0;
async function newInvoice(total = 100000) { seq += 1; const r = await app("POST", "/api/admin/invoices", { customerName: `J11 Txn Client ${process.pid}-${seq}`, customerPhone: "0316" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: new Date().toISOString().slice(0, 10), paidAmount: 0, items: [{ itemName: "T", description: "T", qty: 1, rate: total, unit: "job", taxPercent: 0, discountAmount: 0 }] }); await new Promise((x) => setTimeout(x, 3)); return r.json.invoice; }
const row = (id, amount, pid = "txn-" + globalThis.crypto.randomUUID()) => ({ id: pid, invoice_id: id, amount, payment_method: "Cash", recorded_by: "txn" });

// a) one transaction
{
  const inv = await newInvoice(100000); const pid = "txn-" + globalThis.crypto.randomUUID();
  const ok = await rest("POST", "/invoice_payments", row(inv.id, 30000, pid));
  const [x] = sql(`select p.xmin::text||'|'||i.xmin::text||'|'||i.paid_amount||'|'||i.balance_due from invoice_payments p join invoices i on i.id=p.invoice_id where p.id='${pid}'`).split("\n");
  const [px, ix, paid, bal] = x.split("|");
  check("PostgREST insert: the payment row and the invoice header update carry the same transaction id (guard + sync ran inside the request's transaction)", ok.status === 201 && px === ix && Number(paid) === 30000 && Number(bal) === 70000, `${ok.status} payment xmin=${px} invoice xmin=${ix} paid=${paid}`);
  const before = sql(`select xmin::text||'|'||updated_at from invoices where id='${inv.id}'`);
  const refused = await rest("POST", "/invoice_payments", row(inv.id, 80000));
  const after = sql(`select xmin::text||'|'||updated_at from invoices where id='${inv.id}'`);
  check("a refused insert (PT422) leaves no payment row and does not touch the invoice (same xmin)", refused.status === 422 && sql(`select count(*) from invoice_payments where invoice_id='${inv.id}'`) === "1" && before === after, `${refused.status} ${refused.json.code}`);
  const dup = await rest("POST", "/invoice_payments", row(inv.id, 30000, pid));
  check("re-sending the same payment id reaches the primary key (409 duplicate), not the balance rule, even if the first copy used the balance", dup.status === 409 && dup.json.code === "23505", `${dup.status} ${dup.json.code}`);
  const bulk = await rest("POST", "/invoice_payments", [row(inv.id, 40000), row(inv.id, 40000)]);
  check("a bulk insert of two rows (40,000 each into a 70,000 balance) is rejected as a whole: later rows see earlier rows of the same statement", bulk.status === 422 && sql(`select count(*) from invoice_payments where invoice_id='${inv.id}'`) === "1", `${bulk.status}`);
}

// b) lock held by someone else
{
  const inv = await newInvoice(100000); const holder = dbc(); await holder.connect(); await holder.query("begin"); await holder.query(`update invoices set notes='held' where id=$1`, [inv.id]);
  const t0 = Date.now(); const waited = await rest("POST", "/invoice_payments", row(inv.id, 100)); const secs = (Date.now() - t0) / 1000;
  await holder.query("rollback"); await holder.end();
  check("a payment that waits on a held invoice row gives up after ~10 s with invoice_busy (HTTP 409 from PostgREST), nothing stored", waited.status === 409 && /^invoice_busy/.test(waited.json.message || "") && secs > 9 && secs < 14 && sql(`select count(*) from invoice_payments where invoice_id='${inv.id}'`) === "0", `${waited.status} after ${secs.toFixed(1)}s`);
  const inv2 = await newInvoice(100000); const h2 = dbc(); await h2.connect(); await h2.query("begin"); await h2.query(`update invoices set notes='held' where id=$1`, [inv2.id]);
  const t1 = Date.now(); const quick = rest("POST", "/invoice_payments", row(inv2.id, 100)); await new Promise((x) => setTimeout(x, 1500)); await h2.query("commit"); await h2.end(); const r2 = await quick;
  check("a wait shorter than the timeout simply succeeds once the holder commits", r2.status === 201, `${r2.status} after ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  if (process.env.SLOW) {
    const inv3 = await newInvoice(100000); const h3 = dbc(); await h3.connect(); await h3.query("begin"); await h3.query(`update invoices set notes='held' where id=$1`, [inv3.id]);
    const t2 = Date.now(); const appRes = await app("POST", `/api/admin/invoices/${inv3.id}/payments`, { amount: 100, paymentMethod: "Cash", clientRequestId: globalThis.crypto.randomUUID() }); const s3 = (Date.now() - t2) / 1000;
    await h3.query("rollback"); await h3.end();
    check("the app turns a persistent lock into a coded 503 INVOICE_BUSY after 3 attempts (no 500, nothing stored)", appRes.status === 503 && appRes.code === "INVOICE_BUSY" && sql(`select count(*) from invoice_payments where invoice_id='${inv3.id}'`) === "0", `${appRes.status} ${appRes.code} after ${s3.toFixed(0)}s`);
  }
}

// c) serialization failure and deadlock between operator transactions
{
  const inv = await newInvoice(100000); const a = dbc(), b = dbc(); await a.connect(); await b.connect();
  await a.query("begin isolation level repeatable read"); await a.query(`select grand_total from invoices where id=$1`, [inv.id]);
  await b.query(`insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,1000,'Cash')`, ["txn-" + globalThis.crypto.randomUUID(), inv.id]);
  let code = "none"; try { await a.query(`insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,1000,'Cash')`, ["txn-" + globalThis.crypto.randomUUID(), inv.id]); } catch (e) { code = e.code; }
  await a.query("rollback").catch(() => {}); await a.end(); await b.end();
  check("operator REPEATABLE READ transaction racing a payment: PostgreSQL reports 40001 (the app and PostgREST callers run READ COMMITTED, where this cannot happen)", code === "40001", code);
  const i1 = await newInvoice(), i2 = await newInvoice(); const x = dbc(), y = dbc(); await x.connect(); await y.connect();
  await x.query("begin"); await y.query("begin");
  await x.query(`insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,10,'Cash')`, ["txn-" + globalThis.crypto.randomUUID(), i1.id]);
  await y.query(`insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,10,'Cash')`, ["txn-" + globalThis.crypto.randomUUID(), i2.id]);
  const px = x.query(`insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,10,'Cash')`, ["txn-" + globalThis.crypto.randomUUID(), i2.id]).then(() => "ok", (e) => e.code);
  await new Promise((r) => setTimeout(r, 300));
  const py = y.query(`insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,10,'Cash')`, ["txn-" + globalThis.crypto.randomUUID(), i1.id]).then(() => "ok", (e) => e.code);
  const [rx, ry] = await Promise.all([px, py]);
  await x.query("rollback").catch(() => {}); await y.query("rollback").catch(() => {}); await x.end(); await y.end();
  check("two operator transactions that pay invoices in opposite order (multi-statement, never done by the app) deadlock: exactly one victim gets 40P01", [rx, ry].filter((c) => c === "40P01").length === 1, `${rx}/${ry}`);
}
save(`${STATE}/j11-txn-results.json`);
