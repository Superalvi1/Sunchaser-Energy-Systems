// J12: concurrent invoice EDITS across 2-3 app instances sharing one database. Disposable stack only.
// Proves that invoice header and line items stay consistent (and come from ONE edit) and that stale edits are refused.
//   ROUNDS=300 node scripts/e2e-crm-repair/j12-atomic-edit.mjs
// Env: E2E_BASE_URL, E2E_BASE_URL_2 [, E2E_BASE_URL_3], E2E_PSQL ("-h <dir> -p <port> -U postgres -d <db>"), TEST_PW.
// MODE label (free text) is only printed, so a run without scripts/invoice-save-atomic.sql can be told apart in the report.
// Scenarios per round:
//   mix        three concurrent full edits (different line sets, ids, discounts)       -> header and lines come from the SAME edit
//   mix_pay    two edits and a payment at once                                         -> header == lines, paid == ledger
//   versioned  three edits that all loaded the same version                            -> exactly one wins, the others get 409, nothing mixed
//   stale      an edit made on an old version after another edit committed             -> 409, nothing written
// Static checks (once): foreign line id refused; patch with lines that cannot add up is refused by the database function.
import pg from "pg";

const B = [process.env.E2E_BASE_URL, process.env.E2E_BASE_URL_2, process.env.E2E_BASE_URL_3].filter(Boolean);
const PW = process.env.TEST_PW;
if (B.length < 2 || !PW || /sunchaserenergy|railway\.app/.test(B.join())) { console.error("Set E2E_BASE_URL, E2E_BASE_URL_2, TEST_PW (local only)"); process.exit(2); }
const args = process.env.E2E_PSQL.split(" ");
const arg = (f) => args[args.indexOf(f) + 1];
const db = new pg.Pool({ host: arg("-h"), port: Number(arg("-p")), user: arg("-U"), database: arg("-d"), max: 4 });
const ROUNDS = Number(process.env.ROUNDS || 300);
const MODE = process.env.MODE || "atomic";

const tokens = await Promise.all(B.map(async (b) => (await (await fetch(`${b}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "t_admin", password: PW }) })).json()).token));
const call = async (inst, method, path, body) => {
  const r = await fetch(B[inst % B.length] + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tokens[inst % B.length]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: r.status, code: json.code || "", json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);
const uuid = () => globalThis.crypto.randomUUID();
let seq = 0;
async function newInvoice() {
  seq += 1;
  const r = await call(rnd(B.length), "POST", "/api/admin/invoices", { customerName: `Edit Client ${process.pid}-${seq}`, customerPhone: "0312" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: new Date().toISOString().slice(0, 10), paidAmount: 0,
    items: [{ itemName: "Base", description: "Base", qty: 1, rate: 100000, unit: "job", taxPercent: 0, discountAmount: 0 }] });
  if (r.status !== 201) throw new Error(`invoice create failed ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  await sleep(3);
  return r.json.invoice;
}
// A line set is identified by a marker in every line's name; its expected header numbers are known up front.
function lineSet(marker, base) {
  const n = 1 + rnd(4);
  const items = Array.from({ length: n }, (_, i) => ({ id: `${marker}-${uuid().slice(0, 8)}`, itemName: `${marker}-${i}`, description: `${marker}-${i}`, qty: 1 + rnd(3), rate: base + i * 1111, unit: "job", taxPercent: 0, discountAmount: 0 }));
  const subtotal = items.reduce((s, x) => s + x.qty * x.rate, 0);
  const discount = rnd(2) ? 0 : 500 * (1 + rnd(5));
  return { marker, items, discount, subtotal, total: Math.max(0, subtotal - discount) };
}
const edit = (inst, inv, set, extra = {}) => call(inst, "PATCH", `/api/admin/invoices/${inv.id}`, { items: set.items, discountAmount: set.discount, ...extra });
const pay = (inst, id, amount) => call(inst, "POST", `/api/admin/invoices/${id}/payments`, { amount, paymentMethod: "Cash", clientRequestId: uuid() });

const failures = [];
const stats = {};
const bump = (sc, key) => { stats[sc] ||= {}; stats[sc][key] = (stats[sc][key] || 0) + 1; };
async function state(id) {
  const [h] = (await db.query(`select subtotal::float s, discount_amount::float d, grand_total::float g, paid_amount::float p, balance_due::float b, payment_status ps, updated_at from invoices where id=$1`, [id])).rows;
  const lines = (await db.query(`select item_name, qty::float q, rate::float r, line_total::float lt, discount_amount::float ld from invoice_items where invoice_id=$1`, [id])).rows;
  const [l] = (await db.query(`select coalesce(sum(amount),0)::float s from invoice_payments where invoice_id=$1`, [id])).rows;
  return { h, lines, ledger: l.s };
}
// header and lines must be internally consistent AND come from the same edit (one marker)
function check(sc, id, st, sets) {
  const bad = [];
  const sum = st.lines.reduce((s, x) => s + x.q * x.r, 0);
  const markers = new Set(st.lines.map((x) => String(x.item_name).replace(/-\d+$/, "")));
  if (st.lines.length === 0) bad.push("no lines");
  if (markers.size > 1) bad.push(`lines from different edits: ${[...markers].join("+")}`);
  if (Math.abs(sum - st.h.s) > 0.005) bad.push(`subtotal ${st.h.s} != lines ${sum}`);
  if (Math.abs(Math.max(0, st.h.s - st.h.d) - st.h.g) > 0.005) bad.push(`total ${st.h.g} != subtotal-discount`);
  for (const x of st.lines) if (Math.abs(Math.max(0, x.q * x.r - x.ld) - x.lt) > 0.005) bad.push(`line total wrong`);
  const m = [...markers][0];
  const set = sets.find((x) => x.marker === m);
  if (set && (Math.abs(set.subtotal - st.h.s) > 0.005)) bad.push(`header (${st.h.s}) is not the header of edit ${m} (${set.subtotal})`);
  if (Math.abs(st.ledger - st.h.p) > 0.005 && st.ledger > 0) bad.push(`paid ${st.h.p} != ledger ${st.ledger}`);
  if (Math.abs(Math.max(0, st.h.g - (st.ledger > 0 ? st.ledger : st.h.p)) - st.h.b) > 0.005) bad.push(`balance ${st.h.b} wrong`);
  if (bad.length) failures.push({ sc, id, bad });
  return bad.length === 0;
}
const histogram = (sc, rs) => rs.forEach((r) => bump(sc, String(r.status) + (r.code ? `:${r.code}` : "")));

const scenarios = {
  async mix() {
    const inv = await newInvoice();
    const sets = ["A", "B", "C"].slice(0, B.length).map((m, i) => lineSet(`${m}${seq}`, 20000 * (i + 1)));
    // one set reuses the invoice's original line id
    sets[0].items[0].id = inv.items[0].id;
    const rs = await Promise.all(sets.map((s, i) => edit(i, inv, s)));
    histogram("mix", rs);
    check("mix", inv.id, await state(inv.id), sets);
    if (rs.some((r) => r.status >= 500 && r.code !== "INVOICE_BUSY")) failures.push({ sc: "mix", id: inv.id, bad: ["unexpected 5xx " + rs.map((r) => r.status + r.code).join()] });
  },
  async mix_pay() {
    const inv = await newInvoice();
    const sets = [lineSet(`P${seq}a`, 30000), lineSet(`P${seq}b`, 40000)];
    const rs = await Promise.all([edit(0, inv, sets[0]), edit(1, inv, sets[1]), pay(B.length > 2 ? 2 : 0, inv.id, 20000)]);
    histogram("mix_pay", rs);
    check("mix_pay", inv.id, await state(inv.id), sets);
  },
  async versioned() {
    const inv = await newInvoice();
    const version = inv.updatedAt;
    const sets = Array.from({ length: B.length }, (_, i) => lineSet(`V${seq}${i}`, 15000 * (i + 1)));
    const rs = await Promise.all(sets.map((s, i) => edit(i, inv, s, { expectedUpdatedAt: version })));
    histogram("versioned", rs);
    const wins = rs.filter((r) => r.status === 200).length;
    const conflicts = rs.filter((r) => r.status === 409 && r.code === "INVOICE_CONFLICT").length;
    if (MODE.startsWith("atomic") && (wins !== 1 || conflicts !== B.length - 1)) failures.push({ sc: "versioned", id: inv.id, bad: [`expected 1 winner and ${B.length - 1} conflicts, got ${rs.map((r) => r.status + r.code).join()}`] });
    check("versioned", inv.id, await state(inv.id), sets);
  },
  async stale() {
    const inv = await newInvoice();
    const first = lineSet(`S${seq}a`, 25000);
    const r1 = await edit(0, inv, first, { expectedUpdatedAt: inv.updatedAt });
    const second = lineSet(`S${seq}b`, 35000);
    const before = await state(inv.id);
    const r2 = await edit(1, inv, second, { expectedUpdatedAt: inv.updatedAt }); // old version
    histogram("stale", [r1, r2]);
    const after = await state(inv.id);
    if (MODE.startsWith("atomic") && (r2.status !== 409 || JSON.stringify(before) !== JSON.stringify(after))) failures.push({ sc: "stale", id: inv.id, bad: [`stale edit not refused cleanly: ${r2.status}${r2.code}`] });
    check("stale", inv.id, after, [first, second]);
  },
};

for (let r = 0; r < ROUNDS; r++) {
  const names = Object.keys(scenarios);
  await scenarios[names[r % names.length]]().catch((e) => failures.push({ sc: names[r % names.length], id: "-", bad: [String(e.message).slice(0, 160)] }));
}

// ---- static checks against the database function (skipped when it is not installed)
const hasFn = (await db.query(`select to_regprocedure('public.invoice_save_atomic(text,timestamptz,jsonb,jsonb)') is not null as ok`)).rows[0].ok;
const statics = [];
if (hasFn) {
  const a = await newInvoice(); const b = await newInvoice();
  const r1 = await call(0, "PATCH", `/api/admin/invoices/${b.id}`, { items: [{ id: a.items[0].id, itemName: "Steal", description: "Steal", qty: 1, rate: 1, unit: "job", taxPercent: 0, discountAmount: 0 }] });
  const stillA = (await db.query(`select invoice_id from invoice_items where id=$1`, [a.items[0].id])).rows[0]?.invoice_id === a.id;
  statics.push({ name: "line id of another invoice is refused and not taken over", pass: r1.status === 409 && r1.code === "INVOICE_ITEM_ID_CONFLICT" && stillA, got: `${r1.status}:${r1.code}` });
  // the database function itself refuses lines that do not add up to the header (bypassing the app's arithmetic)
  const c = await newInvoice();
  const before = await state(c.id);
  let msg = "";
  try { await db.query(`select invoice_save_atomic($1, null, $2::jsonb, $3::jsonb)`, [c.id, JSON.stringify({ subtotal: 999, grand_total: 999, discount_amount: 0 }), JSON.stringify([{ id: "x-" + uuid(), item_name: "x", description: "x", qty: 1, rate: 5, line_total: 5 }])]); } catch (e) { msg = String(e.message); }
  const after = await state(c.id);
  statics.push({ name: "header that disagrees with its lines is rolled back entirely", pass: msg.startsWith("invoice_totals_inconsistent") && JSON.stringify(before) === JSON.stringify(after), got: msg.slice(0, 60) });
}

console.log(JSON.stringify({ mode: MODE, instances: B.length, rounds: ROUNDS, functionInstalled: hasFn, statusByScenario: stats, inconsistentInvoices: failures.length, statics }, null, 1));
for (const f of failures.slice(0, 12)) console.log("FAIL", f.sc, f.id, f.bad.join("; "));
await db.end();
process.exit(failures.length || statics.some((s) => !s.pass) ? 1 : 0);
