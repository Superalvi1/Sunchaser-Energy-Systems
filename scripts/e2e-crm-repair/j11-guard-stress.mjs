// J11: mixed-operation concurrency stress against TWO app instances sharing one database, plus direct SQL sessions, with a lock monitor.
// Disposable stack only. The database guard (invoice-payments-integrity.sql) should be installed; GUARD=off runs the same load without it
// to show what the guard prevents.   ROUNDS=240 node scripts/e2e-crm-repair/j11-guard-stress.mjs
// Env: E2E_BASE_URL (instance 1), E2E_BASE_URL_2 (instance 2), E2E_PSQL ("-h <dir> -p <port> -U postgres -d <db>"), TEST_PW.
// Reported: per-scenario status histogram, 5xx count, deadlocks (pg_stat_database + server log), peak lock waiters / longest wait, invariant violations.
import fs from "node:fs";
import pg from "pg";
import { STATE } from "./lib.mjs";

const B = [process.env.E2E_BASE_URL, process.env.E2E_BASE_URL_2, process.env.E2E_BASE_URL_3].filter(Boolean); // two or three app instances
const PW = process.env.TEST_PW;
if (B.length < 2 || !PW || /sunchaserenergy|railway\.app/.test(B.join())) { console.error("Set E2E_BASE_URL, E2E_BASE_URL_2, TEST_PW (local only)"); process.exit(2); }
const args = process.env.E2E_PSQL.split(" ");
const arg = (f) => args[args.indexOf(f) + 1];
const dbConfig = { host: arg("-h"), port: Number(arg("-p")), user: arg("-U"), database: arg("-d") };
const ROUNDS = Number(process.env.ROUNDS || 240);
const PG_LOG = process.env.PG_LOG || `${arg("-h")}/pg.log`;

const tokens = await Promise.all(B.map(async (b) => (await (await fetch(`${b}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "t_admin", password: PW }) })).json()).token));
const call = async (inst, method, path, body) => {
  const r = await fetch(B[inst] + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tokens[inst]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: r.status, code: json.code || "", json };
};
const q = new pg.Pool({ ...dbConfig, max: 4 });
const one = async (text, params) => (await q.query(text, params)).rows;
const uuid = () => globalThis.crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);
const pay = (inst, id, amount, extra = {}) => call(inst, "POST", `/api/admin/invoices/${id}/payments`, { amount, paymentMethod: "Cash", clientRequestId: uuid(), ...extra });
let seq = 0;
async function newInvoice(total = 100000) {
  seq += 1;
  const r = await call(rnd(B.length), "POST", "/api/admin/invoices", { customerName: `Stress Client ${process.pid}-${seq}`, customerPhone: "0312" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: new Date().toISOString().slice(0, 10), paidAmount: 0,
    items: [{ itemName: "Synthetic", description: "Synthetic", qty: 1, rate: total, unit: "job", taxPercent: 0, discountAmount: 0 }] });
  if (r.status !== 201) throw new Error(`invoice create failed ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  await sleep(3); // ids are millisecond timestamps
  return r.json.invoice;
}
const editTotal = (inst, inv, rate) => call(inst, "PATCH", `/api/admin/invoices/${inv.id}`, { items: [{ id: inv.items[0].id, itemName: "Synthetic", description: "Synthetic", qty: 1, rate, unit: "job", taxPercent: 0, discountAmount: 0 }] });

// -------- lock monitor
const mon = { samples: 0, waitingSamples: 0, maxWaiters: 0, maxWaitSec: 0 };
const monClient = new pg.Client(dbConfig); await monClient.connect();
const monTimer = setInterval(async () => {
  try {
    const [r] = (await monClient.query(`select count(*) filter (where wait_event_type='Lock')::int w, coalesce(max(extract(epoch from now()-state_change)) filter (where wait_event_type='Lock'),0)::float s
      from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()`)).rows;
    mon.samples++; if (r.w > 0) mon.waitingSamples++; mon.maxWaiters = Math.max(mon.maxWaiters, r.w); mon.maxWaitSec = Math.max(mon.maxWaitSec, r.s);
  } catch { /* monitor must never fail the run */ }
}, 40);
const dl0 = +(await one(`select deadlocks from pg_stat_database where datname=current_database()`))[0].deadlocks;
const logSize0 = fs.existsSync(PG_LOG) ? fs.statSync(PG_LOG).size : 0;

// -------- invariants
const violations = [];
async function invariants(label, id, { expectGone = false } = {}) {
  const [r] = await one(`select i.grand_total::text g, i.paid_amount::text p, i.balance_due::text b, i.payment_status ps, i.invoice_status ist,
      (select coalesce(sum(amount),0)::text from invoice_payments where invoice_id=i.id) l, (select count(*)::int from invoice_payments where invoice_id=i.id) n,
      (select coalesce(sum(line_total),0)::text from invoice_items where invoice_id=i.id) lines from invoices i where i.id=$1`, [id]);
  const orphan = +(await one(`select count(*)::int c from invoice_payments where invoice_id=$1`, [id]))[0].c;
  if (!r) { if (!expectGone && orphan) violations.push(`${label}: ${id} gone but ${orphan} payment rows remain`); if (orphan) violations.push(`${label}: ${id} deleted but ${orphan} orphan payments`); return null; }
  const c = (x) => Math.round(Number(x) * 100);
  const g = c(r.g), p = c(r.p), b = c(r.b), l = c(r.l), lines = c(r.lines);
  const bad = [];
  if (p !== l) bad.push(`paid ${p} != ledger ${l}`);
  if (b !== Math.max(0, g - p)) bad.push(`balance ${b} != max(0,total ${g}-paid ${p})`);
  if (l > g) bad.push(`ledger ${l} > total ${g}`);
  if (p < 0 || b < 0) bad.push("negative");
  const want = g > 0 && g - p <= 0 ? "Paid" : p > 0 ? "Partial" : "Unpaid";
  if (r.ps !== want) bad.push(`status ${r.ps} != ${want}`);
  if (lines !== g) bad.push(`items ${lines} != total ${g}`);
  if (bad.length) violations.push(`${label}: ${id} ${bad.join("; ")}`);
  return { g, p, l, n: r.n, ist: r.ist };
}

const hist = {};
const note = (sc, rs) => { hist[sc] ||= {}; for (const r of [].concat(rs)) { const k = `${r.status}${r.code ? ":" + r.code : ""}`; hist[sc][k] = (hist[sc][k] || 0) + 1; } };
const all5xx = []; const noteAll = (sc, rs) => { for (const r of [].concat(rs)) if (r.status >= 500) all5xx.push(`${sc}:${r.status}:${r.code}:${String(r.json.error || "").slice(0, 80)}`); };

const scenarios = {
  // 6 parallel 30,000 payments (two instances) on a 100,000 invoice: at most 3 may be recorded
  async pay_pay() {
    const inv = await newInvoice(); const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => pay(i % B.length, inv.id, 30000)));
    note("pay_pay", rs); noteAll("pay_pay", rs);
    const ok = rs.filter((r) => r.status === 201).length; const s = await invariants("pay_pay", inv.id);
    if (s && s.n !== ok) violations.push(`pay_pay: ${ok} accepted but ${s.n} rows`);
    if (ok > 3) violations.push(`pay_pay: ${ok} of 6 accepted`);
  },
  // identical retries of ONE request id from both instances
  async pay_retry() {
    const inv = await newInvoice(); const id = uuid();
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => pay(i % B.length, inv.id, 40000, { clientRequestId: id })));
    note("pay_retry", rs); noteAll("pay_retry", rs);
    const s = await invariants("pay_retry", inv.id);
    if (s && s.n !== 1) violations.push(`pay_retry: ${s.n} rows for one request id`);
  },
  // payment racing an edit that lowers the total
  async pay_edit() {
    const inv = await newInvoice(); const off = rnd(80);
    const rs = await Promise.all([sleep(off).then(() => pay(0, inv.id, 80000)), sleep(80 - off).then(() => editTotal(1, inv, 50000))]);
    note("pay_edit", rs); noteAll("pay_edit", rs); await invariants("pay_edit", inv.id);
  },
  // payment racing a permanent delete
  async pay_delete() {
    const inv = await newInvoice(); const off = rnd(80);
    const [p, d] = await Promise.all([sleep(off).then(() => pay(0, inv.id, 10000)), sleep(80 - off).then(() => call(1, "DELETE", `/api/admin/invoices/${inv.id}`, { confirmText: "DELETE" }))]);
    note("pay_delete", [p, d]); noteAll("pay_delete", [p, d]);
    const exists = (await one(`select 1 from invoices where id=$1`, [inv.id])).length;
    if (p.status === 201 && !exists) violations.push(`pay_delete: acknowledged payment lost with the invoice ${inv.id}`);
    if (d.status === 200 && exists) violations.push(`pay_delete: delete said ok but invoice exists ${inv.id}`);
    await invariants("pay_delete", inv.id, { expectGone: !exists });
  },
  // payment racing an archive
  async pay_archive() {
    const inv = await newInvoice(); const off = rnd(80);
    const rs = await Promise.all([sleep(off).then(() => pay(0, inv.id, 25000)), sleep(80 - off).then(() => call(1, "POST", `/api/admin/invoices/${inv.id}/archive`))]);
    note("pay_archive", rs); noteAll("pay_archive", rs);
    const s = await invariants("pay_archive", inv.id); if (s && s.ist !== "archived") violations.push(`pay_archive: status ${s.ist}`);
  },
  // payment racing a void set by an operator in SQL
  async pay_void() {
    const inv = await newInvoice(); const off = rnd(60);
    const rs = await Promise.all([sleep(off).then(() => pay(rnd(B.length), inv.id, 20000)), sleep(60 - off).then(async () => { await q.query(`update invoices set invoice_status='void' where id=$1`, [inv.id]); return { status: 200, code: "", json: {} }; })]);
    note("pay_void", rs); noteAll("pay_void", rs); await invariants("pay_void", inv.id);
  },
  // two item-replacing edits and a payment at once
  async edit_edit_pay() {
    const inv = await newInvoice();
    const rs = await Promise.all([editTotal(0, inv, 70000), editTotal(1, inv, 90000), pay(rnd(B.length), inv.id, 30000)]);
    note("edit_edit_pay", rs); noteAll("edit_edit_pay", rs);
    await invariants("edit_edit_pay", inv.id);
  },
  // an operator's SQL session holds the invoice row (like a long manual repair) while two payments arrive
  async sql_holds_row() {
    const inv = await newInvoice();
    const c = new pg.Client(dbConfig); await c.connect();
    await c.query("begin"); await c.query(`update invoices set notes='held' where id=$1`, [inv.id]);
    const ps = Promise.all([pay(0, inv.id, 20000), pay(1, inv.id, 20000)]);
    await sleep(300); await c.query("commit"); await c.end();
    const rs = await ps; note("sql_holds_row", rs); noteAll("sql_holds_row", rs);
    const s = await invariants("sql_holds_row", inv.id); if (s && s.n !== 2) violations.push(`sql_holds_row: expected both payments, got ${s.n}`);
  },
  // a direct SQL payment insert (service-role style) racing app payments
  async sql_pay_vs_app() {
    const inv = await newInvoice(); const c = new pg.Client(dbConfig); await c.connect();
    const direct = c.query(`insert into invoice_payments(id,invoice_id,amount,payment_method,recorded_by) values ($1,$2,60000,'Cash','sql')`, [`sqlpay-${uuid()}`, inv.id]).then(() => ({ status: 201, code: "", json: {} }), (e) => ({ status: Number(String(e.code).replace("PT", "")) || 500, code: String(e.message).split(":")[0], json: {} }));
    const rs = await Promise.all([direct, pay(0, inv.id, 60000), pay(1, inv.id, 60000)]); await c.end();
    note("sql_pay_vs_app", rs); noteAll("sql_pay_vs_app", rs);
    const ok = rs.filter((r) => r.status === 201).length; const s = await invariants("sql_pay_vs_app", inv.id);
    if (ok > 1) violations.push(`sql_pay_vs_app: ${ok} of 3 x 60000 accepted on 100000`);
    if (s && s.n !== ok) violations.push(`sql_pay_vs_app: ${ok} accepted but ${s.n} rows`);
  },
};
const names = Object.keys(scenarios);
const t0 = Date.now();
for (let r = 0; r < ROUNDS; r++) {
  const name = names[r % names.length];
  try { await scenarios[name](); } catch (e) { violations.push(`${name}: harness error ${String(e.message).slice(0, 140)}`); }
}
clearInterval(monTimer); await monClient.end();
const dl1 = +(await one(`select deadlocks from pg_stat_database where datname=current_database()`))[0].deadlocks;
const logTail = fs.existsSync(PG_LOG) ? fs.readFileSync(PG_LOG).subarray(logSize0).toString() : "";
const logDeadlocks = (logTail.match(/deadlock detected/g) || []).length;
const guard = (await one(`select count(*)::int c from pg_trigger where tgname='invoice_payments_before_insert_guard' and not tgisinternal`))[0].c === 1;
await q.end();
const summary = { instances: B.length, guardInstalled: guard, rounds: ROUNDS, seconds: Math.round((Date.now() - t0) / 1000), deadlocksPgStat: dl1 - dl0, deadlocksInLog: logDeadlocks, http5xx: all5xx.length, lockMonitor: { ...mon, maxWaitSec: Math.round(mon.maxWaitSec * 100) / 100 }, invariantViolations: violations.length };
console.log(JSON.stringify({ summary, statusHistogram: hist, fiveXx: all5xx.slice(0, 10), violations: violations.slice(0, 25) }, null, 1));
fs.writeFileSync(`${STATE}/j11-stress-${guard ? "guard" : "noguard"}.json`, JSON.stringify({ summary, hist, all5xx, violations }, null, 1));
process.exitCode = violations.length || all5xx.length || dl1 - dl0 ? 1 : 0;
