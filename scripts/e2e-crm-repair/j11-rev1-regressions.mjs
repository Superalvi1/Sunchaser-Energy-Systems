// J11: executed evidence for what revision 2 of invoice-payments-integrity.sql fixes. Applies the FROZEN revision 1 (j11-rev1-integrity.sql,
// the file proposed at d6a4261) and then revision 2 to the SAME disposable database and runs identical probes against each.
// Disposable stack only. Leaves revision 2 installed.   node scripts/e2e-crm-repair/j11-rev1-regressions.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import pg from "pg";
import { STATE } from "./lib.mjs";
const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");
const args = process.env.E2E_PSQL.split(" "); const arg = (f) => args[args.indexOf(f) + 1];
const cfg = (user = arg("-U")) => ({ host: arg("-h"), port: Number(arg("-p")), user, database: arg("-d") });
const psql = (file) => { const r = spawnSync("psql", ["-h", arg("-h"), "-p", arg("-p"), "-U", arg("-U"), "-d", arg("-d"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8" }); if (r.status) throw new Error(r.stderr.slice(0, 300)); };
const stack = process.env.E2E_STACK_DIR || "/srv/e2e-guard";
const secret = /jwt-secret\s*=\s*"([^"]+)"/.exec(fs.readFileSync(`${stack}/pgrst.conf`, "utf8"))[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = new pg.Pool({ ...cfg(), max: 3 });
const run = async (text, params) => q.query(text, params);
const code = async (text, params) => { try { await q.query(text, params); return "ok"; } catch (e) { return e.code || e.message; } };
const hdr = async (id) => { const r = (await run("select paid_amount::numeric(14,2)::text||'/'||balance_due::numeric(14,2)::text||'/'||payment_status as h from invoices where id=$1", [id])).rows[0]; return r ? r.h : "(gone)"; };
const tag = Date.now().toString(36);

async function probes(label) {
  const out = {}; const id = (n) => `rv-${label}-${tag}-${n}`;
  const mk = async (n, total, paid) => run("insert into invoices(id,invoice_number,customer_name,subtotal,grand_total,paid_amount,balance_due,payment_status) values ($1,$2,'rv probe',$3::numeric,$3::numeric,$4::numeric,greatest(0,$3::numeric-$4::numeric),case when $4::numeric>=$3::numeric and $3::numeric>0 then 'Paid' when $4::numeric>0 then 'Partial' else 'Unpaid' end)", [id(n), "RV-" + label + tag + n, total, paid]);
  const ledgerReplica = async (n, rows) => { const c = new pg.Client(cfg()); await c.connect(); await c.query("set session_replication_role = replica"); for (const [pid, amt] of rows) await c.query("insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,$3,'Cash')", [`${id(n)}-${pid}`, id(n), amt]); await c.end(); };
  // a. backfill row for a legacy header-only overpayment
  await mk("a", 100000, 150000);
  out["a. pay-backfill row for legacy header-only overpayment (paid 150k of 100k)"] = await code("insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,150000,'Unknown')", [`pay-backfill-${id("a")}`, id("a")]);
  // b. direct first payment on a legacy opening-balance invoice
  await mk("b", 100000, 50000);
  const b = await code("insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,10000,'Cash')", [`${id("b")}-p`, id("b")]);
  out["b. direct first payment on legacy invoice (paid 50k, no rows): result / header afterwards"] = `${b} / ${await hdr(id("b"))}`;
  // c. non-money write on a drifted invoice (header 80k, ledger 30k)
  await mk("c", 100000, 80000); await ledgerReplica("c", [["a", 30000]]);
  await run("update invoices set customer_phone='0300', invoice_status='archived', archived_at=now() where id=$1", [id("c")]);
  out["c. archive + phone edit on drifted invoice (header 80k, ledger 30k): header afterwards"] = await hdr(id("c"));
  // d. delete last payment
  await mk("d", 100000, 0); await run("insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,30000,'Cash')", [`${id("d")}-p`, id("d")]);
  await run("delete from invoice_payments where id=$1", [`${id("d")}-p`]);
  out["d. delete the only payment row: header afterwards"] = await hdr(id("d"));
  // e. role-level escape hatch on the API login role
  await mk("e", 100000, 0);
  await run("alter role authenticator set app.skip_payment_guard = 'on'");
  const ce = new pg.Client(cfg("authenticator")); await ce.connect(); await ce.query("set role service_role");
  let e1 = "ok"; try { await ce.query("insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,500000,'Cash')", [`${id("e")}-p`, id("e")]); } catch (e) { e1 = e.code; } await ce.end();
  await run("alter role authenticator reset app.skip_payment_guard");
  out["e. ALTER ROLE authenticator SET app.skip_payment_guard='on' then overpay 500k as service_role"] = e1;
  // f. lock footprint: an uncommitted payment must not block adding invoice lines
  await mk("f", 100000, 0);
  const t1 = new pg.Client(cfg()); await t1.connect(); await t1.query("begin"); await t1.query("insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,100,'Cash')", [`${id("f")}-p`, id("f")]);
  const t2 = new pg.Client(cfg()); await t2.connect(); await t2.query("begin"); await t2.query("set local lock_timeout = '1s'");
  let f1 = "ok"; try { await t2.query("insert into invoice_items(id,invoice_id,description,qty,rate,line_total) values ($1,$2,'x',1,1,1)", [`${id("f")}-i`, id("f")]); } catch (e) { f1 = e.code; }
  await t2.query("rollback"); await t1.query("rollback"); await t1.end(); await t2.end();
  out["f. add an invoice line while another session has an uncommitted payment (55P03 = blocked)"] = f1;
  // g. hang on a held row
  await mk("g", 100000, 0);
  const h = new pg.Client(cfg()); await h.connect(); await h.query("begin"); await h.query("update invoices set notes='held' where id=$1", [id("g")]);
  const s = Date.now(); const pending = code("insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,100,'Cash')", [`${id("g")}-p`, id("g")]);
  await sleep(12500); await h.query("rollback"); await h.end(); const res = await pending;
  out["g. payment while another session holds the invoice row for 12.5 s"] = `${res} after ${((Date.now() - s) / 1000).toFixed(1)} s`;
  // h. RPC exposure
  await run("notify pgrst, 'reload schema'"); await sleep(1500);
  const tok = jwt.sign({ role: "anon" }, secret, { expiresIn: "5m" });
  const r = await fetch(`${process.env.RAILWAY_POSTGREST_URL}/rpc/invoice_ledger_status`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ grand: 100, paid: 10, due: null }) });
  out["h. anon POST /rpc/invoice_ledger_status"] = String(r.status);
  // j. customer delete (FK ON DELETE SET NULL) on a drifted invoice
  await run("insert into customers(id, name, email) values ($1, 'rv customer', $2)", [`cust-${id("j")}`, `${id("j")}@example.test`]);
  await run("insert into invoices(id,invoice_number,customer_name,customer_id,subtotal,grand_total,paid_amount,balance_due,payment_status) values ($1,$2,'rv probe',$3,100000,100000,80000,20000,'Partial')", [id("j"), "RV-" + label + tag + "j", `cust-${id("j")}`]);
  await ledgerReplica("j", [["a", 30000]]);
  const before = await hdr(id("j"));
  await run("delete from customers where id=$1", [`cust-${id("j")}`]);
  out["j. delete the linked customer (FK sets customer_id NULL) on a drifted invoice: header before -> after"] = `${before} -> ${await hdr(id("j"))}`;
  return out;
}

const dir = new URL(".", import.meta.url).pathname;
const results = {};
psql("scripts/invoice-payments-integrity-rollback.sql");
psql(dir + "j11-rev1-integrity.sql"); results.rev1 = await probes("r1");
psql("scripts/invoice-payments-integrity-rollback.sql");
psql("scripts/invoice-payments-integrity.sql"); results.rev2 = await probes("r2");
await q.end();
const keys = Object.keys(results.rev1);
console.log("probe".padEnd(100), "| revision 1 (d6a4261)".padEnd(34), "| revision 2");
for (const k of keys) console.log(k.padEnd(100), "|", String(results.rev1[k]).padEnd(32), "|", results.rev2[k]);
fs.writeFileSync(`${STATE}/j11-rev1-regressions.json`, JSON.stringify(results, null, 1));
