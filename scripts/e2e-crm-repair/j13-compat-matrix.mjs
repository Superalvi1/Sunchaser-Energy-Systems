// J13: backend/schema compatibility matrix. Runs the SAME observations against whichever app instances and database it is pointed at,
// so the four combinations {old|new backend} x {pre|post migration schema} can be compared. Disposable stack only (synthetic data).
//   LABEL="new-backend/pre-migration" E2E_BASE_URL=... E2E_BASE_URL_2=... E2E_PSQL="-h dir -p port -U postgres -d db" TEST_PW=... node j13-compat-matrix.mjs
// It records what happened (status codes, ledger facts); the verdict column says whether the outcome is SAFE (no corruption, no
// overpayment, no 5xx for a client mistake) and whether it is degraded (a protection that is absent) - it never calls an absent protection "passed".
import pg from "pg";

const B = [process.env.E2E_BASE_URL, process.env.E2E_BASE_URL_2].filter(Boolean);
const PW = process.env.TEST_PW, LABEL = process.env.LABEL || "unlabelled";
if (B.length < 2 || !PW || /sunchaserenergy|railway\.app/.test(B.join())) { console.error("Set E2E_BASE_URL, E2E_BASE_URL_2, TEST_PW (local only)"); process.exit(2); }
const args = process.env.E2E_PSQL.split(" ");
const arg = (f) => args[args.indexOf(f) + 1];
const db = new pg.Pool({ host: arg("-h"), port: Number(arg("-p")), user: arg("-U"), database: arg("-d"), max: 3 });
const q = async (text, p) => (await db.query(text, p)).rows;
const uuid = () => globalThis.crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ipn = 0;
const call = async (i, method, path, body, token, extra = {}) => {
  const r = await fetch(B[i] + path, { method, headers: { "content-type": "application/json", "x-forwarded-for": `10.88.${(ipn >> 8) & 255}.${(ipn++ & 255) || 1}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, code: json.code || "" };
};
const login = async (i) => (await call(i, "POST", "/api/auth/login", { username: "t_admin", password: PW })).json.token;
const tok = [await login(0), await login(1)];
const rows = [];
const rec = (name, observed, verdict) => { rows.push({ name, observed, verdict }); };
let seq = 0;
async function invoice(total = 100000) {
  seq++;
  const r = await call(0, "POST", "/api/admin/invoices", { customerName: `Compat ${process.pid}-${seq}`, customerPhone: "0313" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: new Date().toISOString().slice(0, 10), paidAmount: 0,
    items: [{ itemName: "Base", description: "Base", qty: 1, rate: total, unit: "job", taxPercent: 0, discountAmount: 0 }] }, tok[0]);
  await sleep(3);
  return r.json.invoice;
}
const pay = (i, id, amount, reqId = uuid()) => call(i, "POST", `/api/admin/invoices/${id}/payments`, { amount, paymentMethod: "Cash", clientRequestId: reqId }, tok[i]);
const ledger = async (id) => (await q(`select coalesce(sum(amount),0)::float s, count(*)::int n from invoice_payments where invoice_id=$1`, [id]))[0];

// ---- invoice create / edit
const inv = await invoice();
rec("invoice create", inv ? "201" : "failed", inv ? "ok" : "BROKEN");
const e = await call(0, "PATCH", `/api/admin/invoices/${inv.id}`, { items: [{ id: inv.items[0].id, itemName: "Edited", description: "Edited", qty: 2, rate: 60000, unit: "job", taxPercent: 0, discountAmount: 0 }, { id: `c-${uuid().slice(0, 8)}`, itemName: "Second", description: "Second", qty: 1, rate: 5000, unit: "job", taxPercent: 0, discountAmount: 0 }] }, tok[0]);
const [h] = await q(`select subtotal::float s, grand_total::float g from invoices where id=$1`, [inv.id]);
const [ls] = await q(`select coalesce(sum(qty*rate),0)::float s, count(*)::int n from invoice_items where invoice_id=$1`, [inv.id]);
rec("invoice edit (2 lines)", `${e.status}; header ${h.s}, lines ${ls.s} (${ls.n})`, e.status === 200 && h.s === ls.s && ls.n === 2 ? "ok" : "BROKEN");

// ---- payments
const p1 = await invoice(100000);
const id1 = uuid();
const a = await pay(0, p1.id, 30000, id1), b = await pay(1, p1.id, 30000, id1);
const l1 = await ledger(p1.id);
rec("payment retry with the same request id", `${a.status} then ${b.status}; ledger rows ${l1.n}`, l1.n === 1 && a.status < 300 && b.status < 300 ? "ok (idempotent)" : "BROKEN");
const c = await pay(0, p1.id, 30000), d = await pay(1, p1.id, 30000);
const l2 = await ledger(p1.id);
rec("two legitimate payments of the same value (different request ids)", `${c.status}, ${d.status}; ledger ${l2.s} in ${l2.n} rows`, l2.n === 3 && l2.s === 90000 ? "ok (both recorded)" : "CHECK");
const over = await pay(0, p1.id, 50000);
rec("overpayment attempt (50,000 on a 10,000 balance)", `${over.status} ${over.code}`, over.status >= 400 && over.status < 500 ? "ok (4xx)" : "BROKEN (not a clean 4xx)");
const low = await call(0, "PATCH", `/api/admin/invoices/${p1.id}`, { items: [{ id: p1.items[0].id, itemName: "Cheaper", description: "Cheaper", qty: 1, rate: 50000, unit: "job", taxPercent: 0, discountAmount: 0 }] }, tok[0]);
const [afterLow] = await q(`select grand_total::float g from invoices where id=$1`, [p1.id]);
rec("edit lowering total below payments", `${low.status} ${low.code}; total now ${afterLow.g}`, low.status >= 400 && low.status < 500 && afterLow.g === 100000 ? "ok (refused, total kept)" : "BROKEN");
const del = await call(0, "DELETE", `/api/admin/invoices/${p1.id}`, undefined, tok[0]);
const still = (await q(`select count(*)::int n from invoices where id=$1`, [p1.id]))[0].n;
rec("delete an invoice that has payments", `${del.status} ${del.code}; invoice kept=${still === 1}`, still === 1 && del.status >= 400 && del.status < 500 ? "ok (refused)" : "BROKEN (financial record lost or 5xx)");

// ---- payment races: 6 payments of 30,000 against a 100,000 invoice (at most 3 may be accepted)
async function race(spread, rounds) {
  let overpaid = 0, mismatch = 0, serverErrors = 0;
  for (let r = 0; r < rounds; r++) {
    const iv = await invoice(100000);
    const rs = await Promise.all(Array.from({ length: 6 }, (_, k) => pay(spread ? k % 2 : 0, iv.id, 30000)));
    serverErrors += rs.filter((x) => x.status >= 500).length;
    const l = await ledger(iv.id);
    const [hd] = await q(`select paid_amount::float p from invoices where id=$1`, [iv.id]);
    if (l.s > 100000) overpaid++;
    if (hd.p !== l.s) mismatch++;
  }
  return { overpaid, mismatch, serverErrors };
}
const r1 = await race(false, 15);
rec("6 parallel payments to ONE instance x15", JSON.stringify(r1), r1.overpaid === 0 && r1.mismatch === 0 ? "ok" : "UNSAFE");
const r2 = await race(true, 25);
rec("6 parallel payments split across TWO instances x25", JSON.stringify(r2), r2.overpaid === 0 && r2.mismatch === 0 ? "ok (protected across instances)" : "UNSAFE across instances (single instance only)");

// ---- logout
const t = await login(0);
const lo = await call(0, "POST", "/api/auth/logout", undefined, t);
const reuse = await call(0, "GET", "/api/auth/me", undefined, t);
const reuse2 = await call(1, "GET", "/api/auth/me", undefined, t);
rec("logout, then reuse the token (same / other instance)", `logout ${lo.status} revoked=${lo.json.revoked} reason=${lo.json.reason || "-"}; reuse ${reuse.status} / ${reuse2.status}`,
  reuse.status === 401 && reuse2.status === 401 ? "ok (token dead on both instances)" : (lo.json.revoked === false ? "DEGRADED: honest 'revoked:false', token stays valid until expiry" : "BROKEN"));
// The server learns whether the revocation table exists on first use, so health is read AFTER the logout above.
const health = await (await fetch(B[0] + "/health")).json();
rec("health.sessionRevocationActive (after first logout)", String(health.sessionRevocationActive), health.sessionRevocationActive === undefined ? "n/a (old backend has no such field)" : health.sessionRevocationActive ? "protection active" : "DEGRADED: server-side logout cannot revoke");
const la = await call(0, "POST", "/api/auth/logout-all", undefined, await login(0));
rec("logout-all", `${la.status} ${la.json.error || la.json.revoked || ""}`.trim(), la.status === 200 ? "ok" : (la.status === 503 ? "DEGRADED: refused with a clear 503 (no silent success)" : "BROKEN"));

// ---- anonymous Smart Quote
const day = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10).replaceAll("-", "");
const total = 900000;
const sq = (phone, qn) => call(0, "POST", "/api/public/smart-quotes", { name: "Compat Client", phone, city: "Lahore", quoteNumber: qn, systemCapacityKw: 8, estimatedTotalPkr: total, panel: "14 x Test 585W", inverter: "1 x Test 8kW", battery: "Not included", structure: "Standard L2", generatedAt: new Date().toISOString(),
  snapshot: { lines: [{ category: "Equipment", description: "Panels", specification: "585W", unit: "pcs", quantity: 14, unitPricePkr: total / 14, totalPkr: total }], subtotalPkr: total, discountPkr: 0 } });
const phone = "0309" + String(Math.floor(1000000 + Math.random() * 8999999));
const q1 = await sq(phone, `SES-${day}-${String(Math.floor(Math.random() * 9000) + 1000)}`);
const q2 = await sq(phone, `SES-${day}-${String(Math.floor(Math.random() * 9000) + 1000)}`);
const leads = (await q(`select count(*)::int n from leads where phone like $1`, ["%" + phone.slice(-9)]))[0].n;
rec("anonymous Smart Quote twice with the same name and phone", `${q1.status}, ${q2.status}; leads for that phone: ${leads}`,
  q1.status < 300 && q2.status < 300 && leads >= 2 ? "ok (never merged into one existing customer)" : (leads === 1 ? "OLD BEHAVIOUR: second quote attached to the first client by name+phone" : "BROKEN"));

console.log(JSON.stringify({ label: LABEL }));
console.table(rows);
const bad = rows.filter((r) => /^(BROKEN|UNSAFE)/.test(r.verdict));
console.log(JSON.stringify({ label: LABEL, unsafe: bad.map((r) => r.name), degraded: rows.filter((r) => /DEGRADED|OLD BEHAVIOUR/.test(r.verdict)).map((r) => r.name) }));
await db.end();
process.exit(bad.length ? 1 : 0);
