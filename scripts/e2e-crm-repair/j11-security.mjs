// J11: security review of the payment guard on the disposable stack: SECURITY DEFINER, pinned search_path, EXECUTE grants, the escape hatch
// from PostgREST (headers, query string, JWT claims, RPC), RLS interplay, search_path hijack attempts, and error-body leakage.
//   node scripts/e2e-crm-repair/j11-security.mjs   (needs E2E_STACK_DIR/pgrst.conf for the local JWT secret; never prints it)
import fs from "node:fs";
import { createRequire } from "node:module";
import pg from "pg";
import { STATE, BASE, sql, apiLogin, check, save } from "./lib.mjs";
const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");

const PGRST = process.env.RAILWAY_POSTGREST_URL;
const stack = process.env.E2E_STACK_DIR || "/srv/e2e-guard";
const secret = /jwt-secret\s*=\s*"([^"]+)"/.exec(fs.readFileSync(`${stack}/pgrst.conf`, "utf8"))[1];
const role = (r, claims = {}) => jwt.sign({ role: r, ...claims }, secret, { expiresIn: "10m" });
const rest = async (r, method, path, body, headers = {}, claims = {}) => {
  const res = await fetch(PGRST + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${role(r, claims)}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 100) }; }
  return { status: res.status, json, text };
};
const args = process.env.E2E_PSQL.split(" ");
const arg = (f) => args[args.indexOf(f) + 1];
const dbc = (user = "postgres") => new pg.Client({ host: arg("-h"), port: Number(arg("-p")), user, database: arg("-d") });
const token = await apiLogin("t_admin");
const app = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 80) }; } return { status: r.status, json: j, text: t }; };
let seq = 0;
async function newInvoice(total = 100000) {
  seq += 1;
  const r = await app("POST", "/api/admin/invoices", { customerName: `J11 Sec Client ${process.pid}-${seq}`, customerPhone: "0314" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: new Date().toISOString().slice(0, 10), paidAmount: 0, items: [{ itemName: "S", description: "S", qty: 1, rate: total, unit: "job", taxPercent: 0, discountAmount: 0 }] });
  await new Promise((res) => setTimeout(res, 3));
  return r.json.invoice;
}
const payRow = (invoice_id, amount, id = "secpay-" + globalThis.crypto.randomUUID()) => ({ id, invoice_id, amount, payment_method: "Cash", recorded_by: "sec" });

// 7. catalog facts
const cat = sql(`select p.proname||'|'||p.prosecdef||'|'||coalesce(p.proconfig::text,'')||'|'||coalesce(p.proacl::text,'(default=PUBLIC)') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('invoice_guard_skipped','invoice_ledger_status','invoice_sync_header','invoice_payments_before_insert','invoice_payments_after_change','invoices_before_update_ledger','invoices_before_delete_guard','invoice_payments_before_update') order by 1`).split("\n");
console.log(cat.join("\n"));
check("all 8 guard functions exist", cat.length === 8, String(cat.length));
check("every trigger function is SECURITY DEFINER with a pinned search_path (pg_catalog first, pg_temp last)", cat.filter((l) => !l.startsWith("invoice_guard_skipped") && !l.startsWith("invoice_ledger_status")).every((l) => l.split("|")[1] === "true" && /search_path=pg_catalog, public, pg_temp/.test(l)), "see list above");
check("the two pure helpers pin search_path too", cat.filter((l) => /^invoice_(guard_skipped|ledger_status)/.test(l)).every((l) => /search_path=pg_catalog, pg_temp/.test(l)));
check("no function grants EXECUTE to PUBLIC, anon, authenticated or service_role (ACL is owner-only)", cat.every((l) => { const acl = l.split("|")[3]; return !acl.includes("PUBLIC") && !/(^|[{,])(=|anon=|authenticated=|service_role=)/.test(acl); }), cat.map((l) => l.split("|")[3]).join(" "));

// RPC exposure
const inv = await newInvoice();
const rpcs = await Promise.all(["invoice_ledger_status", "invoice_guard_skipped", "invoice_sync_header", "invoice_payments_before_insert"].map((f) => rest("service_role", "POST", `/rpc/${f}`, { p_invoice_id: inv.id, grand: 1, paid: 0, due: null })));
check("service_role cannot call any guard function over /rpc (404 not exposed or 403/401 not permitted)", rpcs.every((r) => [401, 403, 404].includes(r.status)), rpcs.map((r) => r.status).join(","));
const anonRpc = await rest("anon", "POST", "/rpc/invoice_ledger_status", { grand: 1, paid: 0, due: null });
check("anon cannot call the pure helper either", [401, 403, 404].includes(anonRpc.status), String(anonRpc.status));
const anonInsert = await rest("anon", "POST", "/invoice_payments", payRow(inv.id, 10));
const authInsert = await rest("authenticated", "POST", "/invoice_payments", payRow(inv.id, 10));
check("anon and authenticated cannot write payments at all (no table privileges)", [401, 403].includes(anonInsert.status) && [401, 403].includes(authInsert.status), `${anonInsert.status}/${authInsert.status}`);

// 6. escape hatch from PostgREST
const attempts = [
  ["header app.skip_payment_guard", { "app.skip_payment_guard": "on" }, "", {}],
  ["header x-app-skip-payment-guard", { "x-app-skip-payment-guard": "on" }, "", {}],
  ["Prefer params", { Prefer: "params=single-object, return=representation" }, "", {}],
  ["Prefer + custom setting", { Prefer: "app.skip_payment_guard=on" }, "", {}],
  ["query string", {}, "?app.skip_payment_guard=on", {}],
  ["JWT claim app.skip_payment_guard", {}, "", { "app.skip_payment_guard": "on" }],
  ["JWT claim app: {skip_payment_guard}", {}, "", { app: { skip_payment_guard: "on" } }],
  ["Accept-Profile/Content-Profile", { "Content-Profile": "public", "Accept-Profile": "public" }, "", {}],
];
const results = [];
for (const [name, headers, qs, claims] of attempts) {
  const r = await rest("service_role", "POST", `/invoice_payments${qs}`, payRow(inv.id, 500000), headers, claims);
  results.push(`${name}=${r.status}`);
}
const sneaky = await rest("service_role", "POST", "/rpc/set_config", { setting_name: "app.skip_payment_guard", new_value: "on", is_local: true });
const stored = sql(`select count(*) from invoice_payments where invoice_id='${inv.id}'`);
check("PostgREST callers cannot switch the guard off: 8 header / query-string / Prefer / JWT-claim attempts to overpay by 400,000 are all refused", results.every((x) => /=(422|403|400)$/.test(x)) && stored === "0", results.join(" "));
check("set_config is not reachable through PostgREST (404)", [401, 403, 404].includes(sneaky.status), String(sneaky.status));
{
  // The role-level misconfiguration case: even if someone ran ALTER ROLE authenticator SET app.skip_payment_guard='on', the API role is excluded.
  const c = dbc("authenticator"); await c.connect();
  await c.query("set app.skip_payment_guard = 'on'");
  let seenAuth, seenOwner;
  try { seenAuth = (await c.query("set role service_role")) && (await c.query("select public.invoice_guard_skipped() as s")).rows[0].s; } catch (e) { seenAuth = `err:${e.code}`; }
  await c.end();
  const o = dbc("postgres"); await o.connect(); await o.query("set app.skip_payment_guard = 'on'"); seenOwner = (await o.query("select public.invoice_guard_skipped() as s")).rows[0].s;
  await o.end();
  check("escape hatch is honoured for an operator session (postgres) and ignored for the API connection role (authenticator / service_role)", seenOwner === true && (seenAuth === false || String(seenAuth).startsWith("err:42501")), `operator=${seenOwner} api=${seenAuth}`);
  // direct overpay as authenticator->service_role with the GUC on must still be refused
  const c2 = dbc("authenticator"); await c2.connect(); await c2.query("set app.skip_payment_guard = 'on'"); await c2.query("set role service_role");
  let code = "inserted"; try { await c2.query("insert into invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,500000,'Cash')", ["secpay-" + globalThis.crypto.randomUUID(), inv.id]); } catch (e) { code = e.code; }
  await c2.end();
  check("a service_role session that sets the GUC itself is still refused (PT422)", code === "PT422", code);
}

// search_path / pg_temp hijack: shadow objects in pg_temp and public must not change the guard
{
  const c = dbc("postgres"); await c.connect();
  await c.query("create temp table invoices (id text, grand_total numeric, invoice_status text, paid_amount numeric)");
  await c.query("create temp table invoice_payments (id text, invoice_id text, amount numeric)");
  await c.query("create function pg_temp.round(numeric, int) returns numeric language sql as 'select 0::numeric'");
  await c.query("create function public.round(numeric, int) returns numeric language sql as 'select 0::numeric'");
  await c.query("set search_path = pg_temp, public");
  let code = "inserted"; try { await c.query("insert into public.invoice_payments(id,invoice_id,amount,payment_method) values ($1,$2,500000,'Cash')", ["secpay-" + globalThis.crypto.randomUUID(), inv.id]); } catch (e) { code = e.code; }
  await c.query("drop function public.round(numeric, int)");
  await c.end();
  check("shadowing round()/invoices/invoice_payments in pg_temp and public does not weaken the guard", code === "PT422", code);
}

// RLS interplay: enable RLS with a service_role-only policy (the layout the task describes) and confirm the guard + API still work
{
  const c = dbc("postgres"); await c.connect();
  for (const t of ["invoices", "invoice_payments", "invoice_items"]) {
    await c.query(`alter table public.${t} enable row level security`);
    await c.query(`drop policy if exists j11_service on public.${t}`);
    await c.query(`create policy j11_service on public.${t} for all to service_role using (true) with check (true)`);
  }
  const inv2 = await newInvoice(); const ok = await app("POST", `/api/admin/invoices/${inv2.id}/payments`, { amount: 60000, paymentMethod: "Cash", clientRequestId: globalThis.crypto.randomUUID() });
  const over = await app("POST", `/api/admin/invoices/${inv2.id}/payments`, { amount: 60000, paymentMethod: "Cash", clientRequestId: globalThis.crypto.randomUUID() });
  await c.query("grant insert, select on public.invoice_payments to authenticated");  // simulate an over-grant: RLS must still stop a non-service role
  const viaAuth = await rest("authenticated", "POST", "/invoice_payments", payRow(inv2.id, 100));
  await c.query("revoke insert, select on public.invoice_payments from authenticated");
  check("with RLS ON (service_role-only policies) the app still records payments and the guard still refuses the overpayment", ok.status === 201 && over.status === 422, `${ok.status}/${over.status}`);
  check("an over-granted authenticated role is stopped by RLS before the guard (no row, 4xx)", viaAuth.status >= 400 && viaAuth.status < 500, String(viaAuth.status));
  // FORCE RLS: the definer functions run as the owner (postgres, superuser) so they still see every row
  for (const t of ["invoices", "invoice_payments", "invoice_items"]) await c.query(`alter table public.${t} force row level security`);
  const inv3 = await newInvoice(); const f1 = await app("POST", `/api/admin/invoices/${inv3.id}/payments`, { amount: 100000, paymentMethod: "Cash", clientRequestId: globalThis.crypto.randomUUID() });
  const f2 = await app("POST", `/api/admin/invoices/${inv3.id}/payments`, { amount: 1, paymentMethod: "Cash", clientRequestId: globalThis.crypto.randomUUID() });
  check("with FORCE RLS the guard still sees the ledger (owner is a superuser): exact payment accepted, one more rupee refused", f1.status === 201 && f2.status === 422, `${f1.status}/${f2.status}`);
  for (const t of ["invoices", "invoice_payments", "invoice_items"]) {
    await c.query(`alter table public.${t} no force row level security`);
    await c.query(`drop policy if exists j11_service on public.${t}`);
    await c.query(`alter table public.${t} disable row level security`);
  }
  await c.end();
}

// 5. error mapping / leakage
{
  const inv4 = await newInvoice(); const body = (amount) => ({ amount, paymentMethod: "Cash", clientRequestId: globalThis.crypto.randomUUID() });
  const r422 = await app("POST", `/api/admin/invoices/${inv4.id}/payments`, body(999999));
  const r400 = await app("POST", `/api/admin/invoices/${inv4.id}/payments`, body(-5));
  const r404 = await app("POST", `/api/admin/invoices/does-not-exist/payments`, body(10));
  sql(`update invoices set invoice_status='void' where id='${inv4.id}'`);
  const r409 = await app("POST", `/api/admin/invoices/${inv4.id}/payments`, body(10));
  const edit = await app("PATCH", `/api/admin/invoices/${inv4.id}`, { notes: "x" });
  const sample = [r422, r400, r404, r409];
  check("friendly coded 4xx for overpayment (422), invalid amount (400), unknown invoice (404), void invoice (409)", r422.status === 422 && r422.json.code && r400.status === 400 && r400.json.code && r404.status === 404 && r404.json.code && r409.status === 409 && r409.json.code && sample.every((r) => !/PT4\d\d|invoice_[a-z_]+:|SQLSTATE|postgres|pgrst|select |insert |relation|trigger/i.test(r.text)), sample.map((r) => `${r.status} ${r.json.code || "-"}`).join(" | "));
  // force a database failure: take INSERT away from service_role; the client must get a generic coded 500 with no database text
  sql("revoke insert on public.invoice_payments from service_role");
  const inv5 = await newInvoice();
  const boom = await app("POST", `/api/admin/invoices/${inv5.id}/payments`, body(10));
  sql("grant insert on public.invoice_payments to service_role");
  check("an unexpected database failure answers with a generic message and a code, never the database text (no 'permission denied', table or role names)", boom.status >= 500 && !/permission|denied|invoice_payments|service_role|relation|42501/i.test(boom.text) && boom.json.code, `${boom.status} ${boom.text.slice(0, 120)}`);
  const direct = await rest("service_role", "POST", "/invoice_payments", payRow(inv5.id, 9999999));
  check("the raw PostgREST error for a guard rejection carries only the tag, amounts of that invoice and a PT code (this is what the app swallows)", direct.status === 422 && /^invoice_overpayment: payment/.test(direct.json.message || "") && direct.json.code === "PT422", JSON.stringify(direct.json).slice(0, 200));
}
save(`${STATE}/j11-security-results.json`);
