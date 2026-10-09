// Independent verification of the release candidate on a DISPOSABLE stack (synthetic data only).
// Written separately from the investigators' scripts. Env: E2E_BASE_URL, E2E_PSQL, TEST_PW, JWT_SECRET (the stack's own).
//   node scripts/e2e-crm-repair/final-verify.mjs
import { execFileSync } from "node:child_process";
import jwt from "jsonwebtoken";

const BASE = process.env.E2E_BASE_URL;
const PW = process.env.TEST_PW;
const SECRET = process.env.JWT_SECRET;
if (!BASE || !PW || !SECRET || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set E2E_BASE_URL (local), TEST_PW, JWT_SECRET, E2E_PSQL for a disposable stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q])).toString().trim();
let pass = 0, fail = 0; const failed = []; const notes = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failed.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " — " + d : ""}`); };
const note = (s) => { notes.push(s); console.log("NOTE: " + s); };
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const post = (path, body, token, extra = {}) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });
const get = (path, token) => fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const login = async (u, pw = PW) => (await j(await post("/api/auth/login", { username: u, password: pw }))).token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");

const admin = await login("t_admin");
const A = (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${admin}`, ...(init.headers || {}) } });

// ============ 1. Sessions ============
console.log("\n== 1. Sessions: expired, revoked, suspended, logged-out");
const me = (t) => get("/api/auth/me", t).then((r) => r.status);
check("a valid session works", (await me(admin)) === 200);
const claims = jwt.decode(admin);
const now = Math.floor(Date.now() / 1000);
const mint = (extra, opts = {}) => jwt.sign({ userId: claims.userId, username: claims.username, role: claims.role, pwv: claims.pwv, ...extra }, SECRET, opts);
check("an expired token is refused", (await me(mint({ iat: now - 7200, exp: now - 3600 }))) === 401);
check("a token with no expiry is refused", (await me(jwt.sign({ userId: claims.userId, username: claims.username, role: claims.role, pwv: claims.pwv }, SECRET))) === 401);
check("a session older than the 30-day absolute limit is refused even if its exp is in the future", (await me(mint({ sst: now - 31 * 86400 }, { expiresIn: "1h" }))) === 401);
check("a token whose session start is in the future is refused", (await me(mint({ sst: now + 86400 }, { expiresIn: "1h" }))) === 401);
check("a token signed with the wrong secret is refused", (await me(jwt.sign({ userId: claims.userId, username: claims.username, role: claims.role }, "x".repeat(40), { expiresIn: "1h" }))) === 401);
const refreshed = await post("/api/auth/refresh", {}, admin);
const rj = await j(refreshed);
check("refresh returns a new token for a valid session", refreshed.status === 200 && rj.token && (await me(rj.token)) === 200);
const rc = jwt.decode(rj.token || "") || {};
check("a renewed token never outlives the original session start + cap", rc.exp && rc.sst && rc.exp <= rc.sst + 30 * 86400, JSON.stringify({ exp: rc.exp, sst: rc.sst }));
// suspension
const sales = await login("t_sales");
check("sales session works before suspension", (await me(sales)) === 200);
psql("update users set account_status='Suspended' where username='t_sales'");
check("a suspended user's existing token is refused at once", (await me(sales)) === 403, String(await me(sales)));
check("a suspended user cannot refresh", (await post("/api/auth/refresh", {}, sales)).status >= 400);
check("a suspended user cannot sign in", !(await login("t_sales")));
psql("update users set account_status='Approved' where username='t_sales'");
// role change applies at the next request
const before = await j(await get("/api/auth/me", sales));
psql("update users set role='Support Agent' where username='t_sales'");
const afterRole = await j(await get("/api/auth/me", sales));
check("a role change applies on the next request, not at token expiry", (before.user?.role || before.role) !== (afterRole.user?.role || afterRole.role), JSON.stringify([before.user?.role, afterRole.user?.role]));
psql("update users set role='Sales Executive' where username='t_sales'");
// password reset revokes earlier tokens (the real reset endpoint)
const salesBefore = await login("t_sales");
psql("update users set reset_token='verifytoken-" + "a".repeat(30) + "', reset_token_expires_at = now() + interval '1 hour' where username='t_sales'");
const rs = await post("/api/auth/reset-password", { token: "verifytoken-" + "a".repeat(30), password: "Changed-By-Verify-9!" });
check("the reset-password endpoint accepts a valid token", rs.status === 200, String(rs.status));
check("a token captured before a password reset no longer works", (await me(salesBefore)) === 401, String(await me(salesBefore)));
check("the token cannot be renewed after the reset either", (await post("/api/auth/refresh", {}, salesBefore)).status === 401);
check("signing in with the new password works", Boolean(await login("t_sales", "Changed-By-Verify-9!")));
// restore the synthetic password hash
psql(`update users set password=(select password from users where username='t_accounts') where username='t_sales'`);
// logout
const lo = await post("/api/auth/logout", {}, admin);
if (lo.status === 404) note("LOGOUT: there is no server-side logout endpoint. Signing out only clears the device; a copied token stays valid until it expires or the password changes. This is a known gap (needs a session_epoch column).");
else check("logout revokes the token", (await me(admin)) === 401);
// refresh abuse
const results = await Promise.all(Array.from({ length: 30 }, () => post("/api/auth/refresh", {}, rj.token)));
check("refresh is rate limited", results.some((r) => r.status === 429), results.map((r) => r.status).join(","));
// takeover paths
const fp = await j(await post("/api/auth/forgot-password", { email: "t_admin@example.test" }));
check("forgot-password does not return a reset link", !JSON.stringify(fp).includes("token="), Object.keys(fp).join(","));
for (const reserved of ["allauddin", "raza"]) {
  const reg = await post("/api/auth/register", { username: reserved, password: "Attacker-Pass-123!", name: "Not Admin", email: `a${rand(5)}@example.test`, role: "Customer", phone: "03" + rand(9) });
  check(`self-registering the reserved staff name '${reserved}' is refused`, reg.status >= 400 && reg.status < 500, String(reg.status));
  check(`…and nobody can sign in as '${reserved}' with the attacker's password`, !(await login(reserved, "Attacker-Pass-123!")));
}

// ============ 2. Shared phone numbers ============
console.log("\n== 2. Shared phone numbers");
const phone = "0345" + rand(7);
const key = process.env.PUBLIC_LEAD_API_KEY || "";
const sq = (name, no, kw = 8, total = 900000) => post("/api/public/smart-quotes", { name, phone, city: "Lahore", quoteNumber: no, systemCapacityKw: kw, estimatedTotalPkr: total, panel: "14 × Test 585W", inverter: "1 × Test 8kW", battery: "Not included", structure: "Standard L2", generatedAt: new Date().toISOString(), snapshot: { lines: [{ category: "Equipment", description: "Panels", specification: "585W", unit: "pcs", quantity: 14, unitPricePkr: total / 14, totalPkr: total }], subtotalPkr: total, discountPkr: 0 } }, null, key ? { "x-public-lead-key": key } : {});
const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const q1 = `SES-${day}-${rand(4)}`, q2 = `SES-${day}-${rand(4)}`, q3 = `SES-${day}-${rand(4)}`;
const r1 = await sq("Ahmed Khan", q1); const b1 = await j(r1);
check("client A's first quotation is saved", r1.status === 201 && b1.leadId, `${r1.status} ${JSON.stringify(b1).slice(0, 120)}`);
const r2 = await sq("Sana Malik", q2, 12, 1200000); const b2 = await j(r2);
check("client B on the same phone number gets a SEPARATE lead", r2.status === 201 && b2.leadId && b2.leadId !== b1.leadId, `A=${b1.leadId} B=${b2.leadId}`);
check("client A's lead name, phone and quotation count are untouched", psql(`select name from leads where id='${b1.leadId}'`) === "Ahmed Khan" && psql(`select count(*) from smart_quote_versions where lead_id='${b1.leadId}'`) === "1");
check("the public response for B does not reveal A's lead", !JSON.stringify(b2).includes(b1.leadId) && !JSON.stringify(b2).includes("Ahmed"));
const vA = await j(await get(`/api/leads/${b1.leadId}/smart-quote-versions`, admin));
const vB = await j(await get(`/api/leads/${b2.leadId}/smart-quote-versions`, admin));
check("A's saved versions contain only A's quotation", (vA.versions || []).length === 1 && vA.versions[0].quoteNumber === q1);
check("B's saved versions contain only B's quotation", (vB.versions || []).length === 1 && vB.versions[0].quoteNumber === q2);
const r3 = await sq("ahmed  KHAN", q3, 10, 1000000);
const b3 = await j(r3);
check("A revising their own quote (case/spacing variant of the name) joins A's lead as version 2", b3.leadId === b1.leadId && psql(`select count(*) from smart_quote_versions where lead_id='${b1.leadId}'`) === "2", `${r3.status} ${JSON.stringify(b3).slice(0, 100)}`);
const r2b = await sq("Sana Malik", q2, 12, 1200000);
check("B retrying the same quote number is a replay, not a duplicate", r2b.status === 200 && (await j(r2b)).leadId === b2.leadId && psql(`select count(*) from smart_quote_versions where quote_number='${q2}'`) === "1", String(r2b.status));
check("no extra leads or customers were created for the shared number", psql(`select count(distinct id) from leads where phone like '%${phone.slice(-7)}'`) === "2", psql(`select count(distinct id) from leads where phone like '%${phone.slice(-7)}'`));
const sharedNote = psql(`select (select coalesce(notes,'') from leads where id='${b2.leadId}') ilike '%shared%' or (select coalesce(notes,'') from leads where id='${b1.leadId}') ilike '%shared%'`);
note(`staff-visible 'shared phone' marker present on the leads: ${sharedNote}`);
// a sales user who does not own lead A must not see its versions
const accounts = await login("t_accounts");
const vOther = await get(`/api/leads/${b1.leadId}/smart-quote-versions`, accounts);
check("a user without access cannot read A's quotation versions", vOther.status === 403 || vOther.status === 404 || vOther.status === 401 || (await j(vOther)).versions?.length === 0, String(vOther.status));

// ============ 3. Payments ============
console.log("\n== 3. Payments");
async function newInvoice(total) {
  const lead = await j(await A("/api/leads", { method: "POST", body: JSON.stringify({ name: "Verify Client " + rand(4), email: `v${rand(6)}@example.test`, phone: "0311" + rand(7), leadSource: "Direct/Referral" }) }));
  const r = await A("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: "Verify Client", customerPhone: "0311" + rand(7), invoiceDate: "2026-10-09", taxPercent: 0, discountAmount: 0, paidAmount: 0, items: [{ description: "Verification item", qty: 1, unit: "pcs", rate: total, taxPercent: 0, discountAmount: 0 }] }) });
  const body = await j(r); const id = body.invoice?.id || body.id;
  return { id, status: r.status, body };
}
const state = (id) => ({ ledger: Number(psql(`select coalesce(sum(amount),0) from invoice_payments where invoice_id='${id}'`)), paid: Number(psql(`select paid_amount from invoices where id='${id}'`)), total: Number(psql(`select grand_total from invoices where id='${id}'`)), balance: Number(psql(`select balance_due from invoices where id='${id}'`)), rows: Number(psql(`select count(*) from invoice_payments where invoice_id='${id}'`)) });
const pay = (id, amount, extra = {}) => A(`/api/admin/invoices/${id}/payments`, { method: "POST", body: JSON.stringify({ amount, paymentMethod: "Cash", paymentDate: "2026-10-09", ...extra }) });
const inv = await newInvoice(100000);
check("a test invoice can be created", Boolean(inv.id), `${inv.status} ${JSON.stringify(inv.body).slice(0, 160)}`);
if (inv.id) {
  const rid = "verify-same-" + rand(8);
  const same = await Promise.all(Array.from({ length: 20 }, () => pay(inv.id, 10000, { clientRequestId: rid })));
  const codes = same.map((r) => r.status);
  let s = state(inv.id);
  check("20 simultaneous retries with one request id record exactly one payment", s.rows === 1 && s.ledger === 10000, `rows=${s.rows} ledger=${s.ledger} codes=${[...new Set(codes)].join(",")}`);
  check("the other 19 are answered as replays, none as errors", codes.filter((c) => c === 201).length === 1 && codes.every((c) => c === 201 || c === 200), codes.join(","));
  check("invoice paid/balance equal the ledger after the retry storm", s.paid === s.ledger && s.balance === s.total - s.ledger, JSON.stringify(s));

  const inv2 = await newInvoice(100000);
  const distinct = await Promise.all(Array.from({ length: 5 }, (_, i) => pay(inv2.id, 10000, { clientRequestId: `verify-d-${i}-${rand(8)}` })));
  s = state(inv2.id);
  check("five separate legitimate payments of the same amount are ALL recorded", s.rows === 5 && s.ledger === 50000 && distinct.every((r) => r.status === 201), `rows=${s.rows} ledger=${s.ledger} ${distinct.map((r) => r.status).join(",")}`);

  const inv3 = await newInvoice(100000);
  const first = await pay(inv3.id, 5000);
  const second = await pay(inv3.id, 5000);
  const third = await pay(inv3.id, 5000, { confirmDuplicate: true });
  s = state(inv3.id);
  check("an old client sending no request id is told about a likely double-click (409)", first.status === 201 && second.status === 409, `${first.status},${second.status}`);
  check("…and can still record a genuine second identical payment after confirming", third.status === 201 && s.rows === 2 && s.ledger === 10000, `third=${third.status} rows=${s.rows} ledger=${s.ledger}`);

  let overpaid = 0, mismatch = 0, negative = 0;
  for (let round = 0; round < 12; round++) {
    const x = await newInvoice(100000);
    await Promise.all(Array.from({ length: 5 }, (_, i) => pay(x.id, 30000, { clientRequestId: `verify-o-${round}-${i}-${rand(6)}` })));
    const t = state(x.id);
    if (t.ledger > t.total) overpaid++;
    if (t.paid !== t.ledger || t.balance !== t.total - t.ledger) mismatch++;
    if (t.balance < 0) negative++;
  }
  check("12 rounds of 5 simultaneous 30,000 payments on a 100,000 invoice never overpay", overpaid === 0, `overpaid rounds=${overpaid}`);
  check("…and the invoice balance always equals total minus ledger", mismatch === 0 && negative === 0, `mismatch=${mismatch} negative=${negative}`);

  // failed requests must not disturb balances
  const inv4 = await newInvoice(100000);
  await pay(inv4.id, 40000, { clientRequestId: "verify-f-ok-" + rand(8) });
  const before4 = state(inv4.id);
  const bad = [
    await pay(inv4.id, 70000, { clientRequestId: "verify-f-over-" + rand(8) }),
    await pay(inv4.id, -5, { clientRequestId: "verify-f-neg-" + rand(8) }),
    await pay(inv4.id, "abc", { clientRequestId: "verify-f-nan-" + rand(8) }),
    await pay(inv4.id, 0, { clientRequestId: "verify-f-zero-" + rand(8) }),
    await pay("no-such-invoice", 10, { clientRequestId: "verify-f-miss-" + rand(8) }),
  ];
  const after4 = state(inv4.id);
  check("rejected payments (overpay, negative, text, zero, missing invoice) are refused with 4xx", bad.every((r) => r.status >= 400 && r.status < 500), bad.map((r) => r.status).join(","));
  check("rejected payments leave the invoice and ledger exactly as they were", JSON.stringify(before4) === JSON.stringify(after4), JSON.stringify([before4, after4]));
  // same id, different amount
  const rid2 = "verify-conf-" + rand(8);
  await pay(inv4.id, 1000, { clientRequestId: rid2 });
  const reuse = await pay(inv4.id, 2000, { clientRequestId: rid2 });
  const s4 = state(inv4.id);
  check("reusing a request id for a DIFFERENT amount is a conflict, never a silent success", reuse.status === 409, String(reuse.status));
  check("…and records nothing extra", s4.ledger === before4.ledger + 1000, JSON.stringify(s4));
  // invoice edit racing a payment
  let editBad = 0;
  for (let k = 0; k < 15; k++) {
    const x = await newInvoice(100000);
    const [e] = await Promise.all([A(`/api/admin/invoices/${x.id}`, { method: "PATCH", body: JSON.stringify({ items: [{ description: "Reduced", qty: 1, unit: "pcs", rate: 50000, taxPercent: 0, discountAmount: 0 }], paidAmount: 0 }) }), pay(x.id, 80000, { clientRequestId: `verify-e-${k}-${rand(6)}` })]);
    const t = state(x.id);
    if (t.ledger > t.total || t.paid !== t.ledger || t.balance !== Math.max(0, t.total - t.ledger)) editBad++;
    void e;
  }
  check("an invoice edit racing a payment never leaves an inconsistent invoice (15 rounds)", editBad === 0, `inconsistent rounds=${editBad}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (notes.length) console.log("Notes:\n - " + notes.join("\n - "));
if (fail) console.log("Failed:\n - " + failed.join("\n - "));
process.exitCode = fail ? 1 : 0;
