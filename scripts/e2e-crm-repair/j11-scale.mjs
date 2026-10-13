// J11: apply / rollback duration and writer stall on a production-sized table, plus per-write overhead of the triggers.
// Builds its OWN throw-away database (default scale_guard) on the disposable cluster; touches nothing else.
//   INVOICES=100000 PAYMENTS=150000 node scripts/e2e-crm-repair/j11-scale.mjs
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";
import { STATE } from "./lib.mjs";

const N = Number(process.env.INVOICES || 100000), M = Number(process.env.PAYMENTS || 150000), DBN = process.env.SCALE_DB || "scale_guard";
const args = process.env.E2E_PSQL.split(" "); const arg = (f) => args[args.indexOf(f) + 1];
const base = { host: arg("-h"), port: Number(arg("-p")), user: arg("-U") };
const psqlBase = ["-h", base.host, "-p", String(base.port), "-U", base.user, "-X", "-q", "-v", "ON_ERROR_STOP=1"];
const admin = new pg.Client({ ...base, database: arg("-d") }); await admin.connect();
await admin.query(`drop database if exists ${DBN}`); await admin.query(`create database ${DBN}`); await admin.end();
// Schema from the TRACKED scripts only (a stub customers table stands in for the CRM table the invoices reference).
const tracked = ["scripts/invoice-module-schema.sql", "scripts/invoice-status-schema.sql", "scripts/invoice-archive-schema.sql", "scripts/party-ledger-phase2-schema.sql"];
const stub = spawnSync("psql", [...psqlBase, "-d", DBN, "-c", "create table public.customers(id text primary key)"], { encoding: "utf8" });
if (stub.status) { console.error(stub.stderr.slice(0, 300)); process.exit(1); }
for (const f of tracked) {
  const r = spawnSync("psql", [...psqlBase, "-d", DBN, "-f", f], { encoding: "utf8" });
  if (r.status) { console.error(f, r.stderr.slice(0, 300)); process.exit(1); }
}
const db = () => new pg.Client({ ...base, database: DBN });
const c = db(); await c.connect();
let t = Date.now();
await c.query(`insert into invoices(id, invoice_number, invoice_date, customer_name, subtotal, grand_total, paid_amount, balance_due, payment_status, created_by)
  select 'si-' || g, 'S' || g, date '2025-01-01' + (g % 400), 'Scale ' || g, 100000, 100000, case when g % 3 = 0 then 40000 else 0 end, case when g % 3 = 0 then 60000 else 100000 end, case when g % 3 = 0 then 'Partial' else 'Unpaid' end, 'scale' from generate_series(1, ${N}) g`);
await c.query(`insert into invoice_items(id, invoice_id, sort_order, description, qty, rate, line_total) select 'sii-' || g, 'si-' || g, 0, 'line', 1, 100000, 100000 from generate_series(1, ${N}) g`);
await c.query(`insert into invoice_payments(id, invoice_id, amount, payment_method, payment_date, recorded_by)
  select 'sp-' || g, 'si-' || (3 * ((g - 1) % ${Math.floor(N / 3)} + 1)), case when g <= ${Math.floor(N / 3)} then 40000 else 0.01 end, 'Cash', date '2025-02-01', 'scale' from generate_series(1, ${M}) g`);
await c.query("analyze");
const sizes = (await c.query(`select pg_size_pretty(pg_total_relation_size('invoices')) i, pg_size_pretty(pg_total_relation_size('invoice_payments')) p, (select count(*) from invoices) ni, (select count(*) from invoice_payments) np`)).rows[0];
console.log(`seeded ${sizes.ni} invoices / ${sizes.np} payments in ${Math.round((Date.now() - t) / 1000)}s (${sizes.i} + ${sizes.p})`);

// background writer: one small transaction every ~4 ms, records the slowest
const lat = []; let stop = false; let applyWindow = null;
const writer = (async () => {
  const w = db(); await w.connect(); let i = 0;
  while (!stop) {
    const s = performance.now(); const id = `si-${1 + Math.floor(Math.random() * N)}`;
    try { await w.query(i++ % 2 ? `update invoices set notes = 'w' where id = '${id}'` : `update invoices set customer_phone = '03${i}' where id = '${id}'`); } catch (e) { lat.push({ at: performance.now(), ms: 0, err: e.code }); }
    lat.push({ at: performance.now(), ms: performance.now() - s });
    await new Promise((r) => setTimeout(r, 4));
  }
  await w.end();
})();
await new Promise((r) => setTimeout(r, 1500));
const timed = (file) => { const a = performance.now(); const r = spawnSync("psql", [...psqlBase, "-d", DBN, "-f", file], { encoding: "utf8" }); return { ms: Math.round(performance.now() - a), ok: r.status === 0, err: r.status ? r.stderr.slice(0, 200) : "" }; };
const w0 = performance.now(); const apply = timed("scripts/invoice-payments-integrity.sql"); const w1 = performance.now();
await new Promise((r) => setTimeout(r, 1000));
const apply2 = timed("scripts/invoice-payments-integrity.sql");
const r0 = performance.now(); const rollback = timed("scripts/invoice-payments-integrity-rollback.sql"); const r1 = performance.now();
await new Promise((r) => setTimeout(r, 500));
stop = true; await writer;
const inWindow = (a, b) => lat.filter((x) => x.at >= a - 50 && x.at <= b + 200).map((x) => x.ms);
const quiet = lat.filter((x) => x.at < w0 - 50).map((x) => x.ms).sort((x, y) => x - y);
const q = (arr, p) => Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] * 10) / 10;
const win = (a, b) => { const v = inWindow(a, b); return { writes: v.length, maxMs: Math.round(Math.max(...v) * 10) / 10 }; };

// per-write overhead: sequential autocommit payment inserts and money updates, guard off vs on
async function bench(label) {
  const k = db(); await k.connect(); const R = 3000; const out = {};
  let s = performance.now();
  for (let i = 0; i < R; i++) await k.query(`insert into invoice_payments(id, invoice_id, amount, payment_method) values ($1, $2, 0.01, 'Cash')`, [`bn-${label}-${i}`, `si-${3 * (1 + (i % 1000)) + 1}`]);
  out.paymentInsertMs = Math.round(((performance.now() - s) / R) * 1000) / 1000;
  s = performance.now();
  for (let i = 0; i < R; i++) await k.query(`update invoices set notes = 'x' where id = $1`, [`si-${1 + (i % 50000)}`]);
  out.nonMoneyUpdateMs = Math.round(((performance.now() - s) / R) * 1000) / 1000;
  s = performance.now();
  for (let i = 0; i < R; i++) await k.query(`update invoices set grand_total = grand_total + 1 where id = $1`, [`si-${3 * (1 + (i % 1000))}`]);
  out.moneyUpdateMs = Math.round(((performance.now() - s) / R) * 1000) / 1000;
  await k.end(); return out;
}
const off = await bench("off");
const reapply = timed("scripts/invoice-payments-integrity.sql");
const on = await bench("on");
await c.end();
const result = { invoices: Number(sizes.ni), payments: Number(sizes.np), tables: `${sizes.i} + ${sizes.p}`,
  apply, applySecondRun: apply2, rollback, reapply,
  writerQuietP50: q(quiet, 0.5), writerQuietP99: q(quiet, 0.99), writerQuietMax: q(quiet, 1),
  writerDuringApply: win(w0, w1), writerDuringRollback: win(r0, r1), perWriteMsGuardOff: off, perWriteMsGuardOn: on };
console.log(JSON.stringify(result, null, 1));
fs.writeFileSync(`${STATE}/j11-scale.json`, JSON.stringify(result, null, 1));
