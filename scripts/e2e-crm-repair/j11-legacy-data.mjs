// J11: what does the FIRST write to each kind of legacy ("dirty") invoice do, with and without the database guard?
// Disposable stack only. Prerequisite: scripts/e2e-crm-repair/j11-dirty-dataset.sql loaded (ids dirty-dNN).
// For each seeded case and each operation a throw-away clone (id "<case>~<op>") is created straight in SQL, the operation is sent
// through the real HTTP route, and the header (paid / balance / payment status / invoice status) is compared before and after.
//   LABEL=guard node scripts/e2e-crm-repair/j11-legacy-data.mjs      -> writes $E2E_STATE_DIR/j11-legacy-$LABEL.json
//   node scripts/e2e-crm-repair/j11-legacy-data.mjs --compare a.json b.json
import fs from "node:fs";
import { BASE, STATE, sql, apiLogin } from "./lib.mjs";

if (process.argv[2] === "--compare") {
  const [a, b] = process.argv.slice(3).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const key = (r) => `${r.case}|${r.op}`;
  const bm = new Map(b.map((r) => [key(r), r]));
  let diffs = 0;
  for (const r of a) {
    const o = bm.get(key(r));
    const same = o && r.status === o.status && JSON.stringify(r.after) === JSON.stringify(o.after);
    if (!same) { diffs++; console.log(`${key(r)}\n  A: ${r.status} ${r.code || ""} ${JSON.stringify(r.after)}\n  B: ${o?.status} ${o?.code || ""} ${JSON.stringify(o?.after)}`); }
  }
  console.log(`${diffs} differing case/op pairs of ${a.length}`);
  process.exit(0);
}

const LABEL = process.env.LABEL || "run";
const token = await apiLogin("t_admin");
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 80) }; }
  return { status: r.status, json };
};
const cases = sql("select id from invoices where id ~ '^dirty-d[0-9]+$' order by id").split("\n").filter(Boolean);
const header = (id) => {
  const r = sql(`select coalesce((select paid_amount||'/'||balance_due||'/'||payment_status||'/'||invoice_status||'/'||(archived_at is not null)||'/'||grand_total from invoices where id='${id}'),'GONE'), (select coalesce(sum(amount),0) from invoice_payments where invoice_id='${id}'), (select count(*) from invoice_payments where invoice_id='${id}')`).split("|");
  const [paid, bal, ps, is, arch, grand] = r[0].split("/");
  return r[0] === "GONE" ? { gone: true } : { paid: +paid, balance: +bal, pay: ps, inv: is, archived: arch === "true", grand: +grand, ledger: +r[1], rows: +r[2] };
};
const clone = (src, op) => {
  const id = `${src}~${op}`;
  sql(`set app.skip_payment_guard = 'on'; delete from invoices where id='${id}'`);  // the operator escape hatch, so clones can be rebuilt after the guard is installed
  const q = (s) => s.replace(/'/g, "''");
  sql(`set session_replication_role = replica; insert into invoices select (r).* from (select jsonb_populate_record(null::invoices, to_jsonb(i) || jsonb_build_object('id','${id}','invoice_number', i.invoice_number||'~${op}')) as r from invoices i where i.id='${src}') x;
       insert into invoice_items select (r).* from (select jsonb_populate_record(null::invoice_items, to_jsonb(t) || jsonb_build_object('id', t.id||'~${op}','invoice_id','${id}')) r from invoice_items t where invoice_id='${src}') x;
       insert into invoice_payments select (r).* from (select jsonb_populate_record(null::invoice_payments, to_jsonb(p) || jsonb_build_object('id', p.id||'~${op}','invoice_id','${id}')) r from invoice_payments p where invoice_id='${src}') x;`);
  return id;
};
const line = (id, rate) => [{ id: `item-${id}`, itemName: "Synthetic line", description: "Synthetic line", qty: 1, rate, unit: "job", taxPercent: 0, discountAmount: 0 }];
const remaining = (id) => { const h = header(id); return Math.max(0, h.grand - h.ledger); };
const ops = {
  view: (id) => call("GET", `/api/admin/invoices/${id}`),
  list: () => call("GET", `/api/admin/invoices?includeArchived=true`),
  pdf: (id) => call("GET", `/api/export/pdf/invoice/${id}`),
  edit_phone: (id) => call("PATCH", `/api/admin/invoices/${id}`, { customerPhone: "0300999" + id.slice(7, 9).replace(/\D/g, "0") }),
  edit_items_same_total: (id) => { const h = header(id); return call("PATCH", `/api/admin/invoices/${id}`, { items: line(id, h.grand) }); },
  edit_raise_total: (id) => { const h = header(id); return call("PATCH", `/api/admin/invoices/${id}`, { items: line(id, h.grand + 10000) }); },
  edit_lower_to_ledger: (id) => { const h = header(id); return call("PATCH", `/api/admin/invoices/${id}`, { items: line(id, Math.max(h.ledger, 1)) }); },
  edit_lower_below_ledger: (id) => { const h = header(id); return call("PATCH", `/api/admin/invoices/${id}`, { items: line(id, Math.max(Math.floor(h.ledger / 2), 1)) }); },
  // The way out for a legacy overpaid invoice: raise the total to what was actually received.
  edit_fix_overpaid: (id) => { const h = header(id); return call("PATCH", `/api/admin/invoices/${id}`, { items: line(id, Math.max(h.grand, h.ledger, h.paid)) }); },
  edit_stale_paid: (id) => call("PATCH", `/api/admin/invoices/${id}`, { paidAmount: 1234 }),
  archive: (id) => call("POST", `/api/admin/invoices/${id}/archive`),
  pay_remaining: (id) => call("POST", `/api/admin/invoices/${id}/payments`, { amount: remaining(id) || 1, paymentMethod: "Cash", clientRequestId: `j11-${Math.random().toString(36).slice(2, 12)}` }),
  pay_one_rupee: (id) => call("POST", `/api/admin/invoices/${id}/payments`, { amount: 1, paymentMethod: "Cash", clientRequestId: `j11-${Math.random().toString(36).slice(2, 12)}` }),
  delete: (id) => call("DELETE", `/api/admin/invoices/${id}`, { confirmText: "DELETE" }),
};
const rows = [];
for (const c of cases) {
  for (const [op, fn] of Object.entries(ops)) {
    if (op === "list") continue;
    const id = clone(c, op);
    const before = header(id);
    const r = await fn(id);
    const after = header(id);
    rows.push({ case: c, op, status: r.status, code: r.json.code || "", error: String(r.json.error || "").slice(0, 110), before, after, changed: JSON.stringify(before) !== JSON.stringify(after) });
  }
}
const list = await ops.list();
rows.push({ case: "*", op: "list", status: list.status, code: "", error: "", before: {}, after: { count: (list.json.invoices || []).length }, changed: false });
fs.writeFileSync(`${STATE}/j11-legacy-${LABEL}.json`, JSON.stringify(rows, null, 1));
const fmt = (h) => (h.gone ? "GONE" : `paid ${h.paid} bal ${h.balance} ${h.pay}/${h.inv}${h.archived ? "/arch" : ""} total ${h.grand} ledger ${h.ledger}(${h.rows})`);
for (const r of rows) console.log(`${r.case.padEnd(10)} ${r.op.padEnd(24)} HTTP ${r.status} ${(r.code || "").padEnd(24)} ${r.changed ? "CHANGED " : "same    "} ${fmt(r.before)} -> ${fmt(r.after)}${r.error ? "  | " + r.error : ""}`);
