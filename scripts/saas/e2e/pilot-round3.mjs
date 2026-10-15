// Pilot round 3 journey: two SYNTHETIC companies against a running multi-company server (MULTI_COMPANY_ENABLED=true) on a disposable stack.
//   A  invoice issuance snapshot: bank accounts and terms kept at creation, reprints preserved, legacy invoices labelled, no back-fill
//   B  local QR on the invoice (no third-party host in the printed document)
//   C  AutoSizer disabled for pilot companies by the API (and left on for the founding company)
//   D  delivery challans: each company's own challan, PDF and certificate carry its own branding only; the other company cannot read or change them
//   (E, F: company settings screen API with audit history and permissions; subscription expiry and storage limits - appended below)
//   Env: E2E_BASE_URL, E2E_PSQL ("-h <dir> -p <port> -U postgres -d <db>"), TEST_PW.   Seed first: seed-two-companies.mjs
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151";
const PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and E2E_PSQL and point E2E_BASE_URL at a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " - " + detail : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const RUN = randomBytes(3).toString("hex").toUpperCase();

const login = async (username) => { const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) }); return json(r); };
const caller = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
const CO = {
  alpha: { id: "co_alpha", user: "alpha_admin", sales: "alpha_sales", name: `Alpha Solar ${RUN}`, bank: `AlphaBank${RUN}`, bank2: `AlphaNewBank${RUN}`, terms: `Alpha terms ${RUN}: pay within 5 days.` },
  beta: { id: "co_beta", user: "beta_admin", sales: "beta_sales", name: `Beta Energy ${RUN}`, bank: `BetaBank${RUN}`, bank2: `BetaNewBank${RUN}`, terms: `Beta terms ${RUN}: pay within 9 days.` },
};
for (const c of Object.values(CO)) { const l = await login(c.user); c.token = l.token; c.api = caller(l.token); const s = await login(c.sales); c.salesApi = caller(s.token); }
check("both pilot companies sign in", Boolean(CO.alpha.token && CO.beta.token));
const iban = (n) => "PK36SCBL0000001123456" + String(n).padStart(3, "0");
const acct = (bank, no) => ({ bankName: bank, accountTitle: "SYNTHETIC CO", accountNumber: String(no), iban: iban(no), branchCode: "01", isActive: true, showOnInvoice: true, sortOrder: 1 });
const invBody = (c, tag) => ({ customerName: `${c.name} customer ${tag}`, customerPhone: "03000000000", items: [{ itemName: `${tag} item`, description: `${tag} item`, qty: 2, unit: "pcs", rate: 5000, taxPercent: 0, discountAmount: 0 }] });
const printOf = async (c, id) => { const r = await c.api(`/api/export/pdf/invoice/${id}`); return { status: r.status, header: r.headers.get("x-invoice-issuance"), html: await r.text() }; };

// ------------------------------------------------------------------ A. invoice issuance snapshot
console.log("\nA. invoice issuance snapshot");
for (const c of Object.values(CO)) {
  const b = await c.api("/api/company/settings/branding", { method: "PUT", body: JSON.stringify({ companyName: c.name, terms: c.terms }) });
  const k = await c.api("/api/company/settings/bank-accounts", { method: "PUT", body: JSON.stringify({ accounts: [acct(c.bank, 111)] }) });
  check(`${c.id}: settings saved (name, terms, bank account)`, b.status === 200 && k.status === 200, `${b.status}/${k.status}`);
  const cr = await c.api("/api/admin/invoices", { method: "POST", body: JSON.stringify(invBody(c, "first")) });
  c.inv1 = (await json(cr)).invoice || {};
  check(`${c.id}: invoice created`, cr.status < 300 && c.inv1.id, `${cr.status}`);
  const snap = JSON.parse(psql(`select coalesce(issuance_snapshot::text,'null') from invoices where id='${c.inv1.id}'`) || "null");
  c.snap1 = snap;
  check(`${c.id}: the invoice stored an issuance snapshot with its bank account and terms`, snap && snap.version === 1 && snap.bankAccounts?.[0]?.bankName === c.bank && snap.companyTerms === c.terms, JSON.stringify(snap));
  check(`${c.id}: the stored snapshot has no other company's name, bank or terms`, !JSON.stringify(snap).includes(other(c).bank) && !JSON.stringify(snap).includes(other(c).terms) && !/sunchaser/i.test(JSON.stringify(snap)));
  const p1 = await printOf(c, c.inv1.id);
  check(`${c.id}: the print is labelled "snapshot" and shows the bank and terms`, p1.status === 200 && p1.header === "snapshot" && p1.html.includes(c.bank) && p1.html.includes(c.terms), `${p1.status} ${p1.header}`);
  c.print1 = p1.html;
}
function other(c) { return c === CO.alpha ? CO.beta : CO.alpha; }
for (const c of Object.values(CO)) {
  // the company changes its bank account and terms AFTER issuing
  await c.api("/api/company/settings/bank-accounts", { method: "PUT", body: JSON.stringify({ accounts: [acct(c.bank2, 222)] }) });
  await c.api("/api/company/settings/branding", { method: "PUT", body: JSON.stringify({ companyName: c.name, terms: c.terms + " CHANGED" }) });
  const re = await printOf(c, c.inv1.id);
  check(`${c.id}: after the company changed its bank and terms, the OLD invoice reprints with the bank and terms it was issued with`, re.html.includes(c.bank) && !re.html.includes(c.bank2) && re.html.includes(c.terms) && !re.html.includes("CHANGED"));
  const cr2 = await c.api("/api/admin/invoices", { method: "POST", body: JSON.stringify(invBody(c, "second")) });
  c.inv2 = (await json(cr2)).invoice || {};
  const p2 = await printOf(c, c.inv2.id);
  check(`${c.id}: a NEW invoice uses the new bank and terms`, p2.html.includes(c.bank2) && !p2.html.includes(c.bank + "<") && p2.html.includes("CHANGED"));
  // an edit to the invoice keeps the snapshot (the database refuses a change; the application never sends one)
  const g = (await json(await c.api(`/api/admin/invoices/${c.inv1.id}`))).invoice || {};
  const ed = await c.api(`/api/admin/invoices/${c.inv1.id}`, { method: "PATCH", body: JSON.stringify({ notes: "edited", items: g.items, expectedUpdatedAt: g.updatedAt }) });
  const after = psql(`select md5(issuance_snapshot::text) from invoices where id='${c.inv1.id}'`);
  check(`${c.id}: editing the invoice keeps its snapshot byte-for-byte`, ed.status === 200 && after === psql(`select md5('${JSON.stringify(c.snap1).replace(/'/g, "''")}'::jsonb::text)`), `${ed.status}`);
  const direct = (() => { try { psql(`update invoices set issuance_snapshot='{"version":1,"capturedAt":"x","bankAccounts":[],"companyTerms":""}'::jsonb where id='${c.inv1.id}'`); return "changed"; } catch { return "refused"; } })();
  check(`${c.id}: the database refuses to change the snapshot`, direct === "refused");
  const api = (await json(await c.api(`/api/admin/invoices/${c.inv1.id}`))).invoice || {};
  check(`${c.id}: the invoice API returns the snapshot`, api.issuanceSnapshot?.bankAccounts?.[0]?.bankName === c.bank);
}
// legacy invoice: a row without a snapshot (as every invoice created before the migration)
for (const c of Object.values(CO)) {
  const legacyId = `legacy-${RUN}-${c.id}`;
  psql(`insert into invoices (id, invoice_number, customer_name, invoice_date, grand_total, subtotal, balance_due, payment_status, invoice_status, company_id, created_by) values ('${legacyId}','LEG-${RUN}-${c.id}','Legacy customer','2026-01-01',100,100,100,'Unpaid','active','${c.id}','${c.user}')`);
  c.legacyId = legacyId;
  const lp = await printOf(c, legacyId);
  check(`${c.id}: a legacy invoice is labelled "legacy_current_settings" and prints from the CURRENT settings`, lp.status === 200 && lp.header === "legacy_current_settings" && lp.html.includes(c.bank2) && !lp.html.includes(c.bank + "<"), `${lp.status} ${lp.header}`);
  check(`${c.id}: the legacy invoice has no invented snapshot`, psql(`select issuance_snapshot is null from invoices where id='${legacyId}'`) === "t");
}

// ------------------------------------------------------------------ B. local QR
console.log("\nB. local QR");
for (const c of Object.values(CO)) {
  check(`${c.id}: the invoice QR is a local image; no QR service is referenced`, /data:image\/svg\+xml/.test(c.print1) && !/qrserver|googleapis\.com\/chart/.test(c.print1));
  const hosts = [...c.print1.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).host);
  check(`${c.id}: the only external hosts in the printed invoice are fonts (${[...new Set(hosts)].join(", ") || "none"})`, hosts.every((h) => /fonts\.(googleapis|gstatic)\.com$/.test(h)));
}

// ------------------------------------------------------------------ C. AutoSizer is disabled for pilot companies (API); the founding company keeps it
console.log("\nC. AutoSizer");
const FOUNDING = { user: "t_admin" }; { const l = await login(FOUNDING.user); FOUNDING.api = caller(l.token); FOUNDING.token = l.token; }
check("the founding company's administrator signs in", Boolean(FOUNDING.token));
for (const c of Object.values(CO)) {
  const g = await c.api("/api/admin/autosizer-presets");
  const pu = await c.api("/api/admin/autosizer-presets", { method: "PUT", body: JSON.stringify({ autoSizerPresets: {} }) });
  check(`${c.id}: the AutoSizer presets API is refused (read ${g.status}, write ${pu.status})`, g.status === 404 && pu.status === 404);
  const lead = await json(await c.api("/api/leads", { method: "POST", body: JSON.stringify({ name: `${c.name} sizer lead`, email: `sz${RUN}${c.id}@example.test`, phone: "0314" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral" }) }));
  c.sizerLead = lead.id;
  const boq = [{ type: "item", name: "x", description: "x", qty: 1, unit: "pcs", rate: 1000, total: 1000 }];
  const q = await c.api(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ quote_type: "auto_sizer", systemSizekW: 5, totalCost: 1000, boqItems: boq }) });
  const qb = await json(q);
  check(`${c.id}: saving an AutoSizer quote is refused with module_disabled (${q.status})`, q.status === 403 && qb.code === "module_disabled", JSON.stringify(qb).slice(0, 160));
  const m = await c.api(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ quote_type: "manual_boq", systemSizekW: 5, totalCost: 1000, boqItems: boq }) });
  check(`${c.id}: a manual BOQ quote is still accepted (${m.status})`, m.status < 300);
  const pdf = await c.api(`/api/export/pdf/auto-sizer/${lead.id}`);
  check(`${c.id}: the AutoSizer PDF route is refused (${pdf.status})`, pdf.status === 404);
  const st = await json(await c.api("/api/state"));
  check(`${c.id}: the boot payload tells the interface AutoSizer is off and the identity is neutral`, st.modules?.autoSizer === false && st.documentIdentity?.neutral === true);
}
{
  const g = await FOUNDING.api("/api/admin/autosizer-presets");
  check(`the founding company can still read the AutoSizer presets (${g.status})`, g.status === 200);
  const st = await json(await FOUNDING.api("/api/state"));
  check("the founding company's boot payload keeps AutoSizer on", st.modules?.autoSizer === true && st.documentIdentity?.neutral === false);
}

// ------------------------------------------------------------------ D. after-sales group (deliveries, warranties, handover) is disabled for pilot companies
console.log("\nD. after-sales group disabled for pilot companies");
const AFTER = [
  ["GET", "/api/admin/deliveries/dashboard/summary"], ["GET", "/api/admin/deliveries/dch-x"], ["POST", "/api/admin/deliveries"], ["GET", "/api/admin/deliveries/dch-x/challan-pdf"],
  ["GET", "/api/admin/deliveries/dch-x/certificate"], ["GET", "/api/admin/delivery-dashboard/contracted-customers"], ["GET", "/api/admin/invoices/inv-x/deliveries"],
  ["GET", "/api/admin/project-deliveries"], ["GET", "/api/admin/project-completion/gaps"], ["POST", "/api/admin/customer-warranties"], ["GET", "/api/admin/warranty-claims"],
  ["GET", "/api/admin/customers/c-x/warranty-certificate"], ["GET", "/api/export/pdf/warranty-handover/d-x"], ["GET", "/api/technical/project-deliveries/me"],
  ["GET", "/api/customer-portal/deliveries/me"], ["GET", "/api/customer-portal/warranties/me"], ["POST", "/api/warranties/w-x/claims"],
];
for (const c of Object.values(CO)) {
  const rs = [];
  for (const [m, pth] of AFTER) { const r = await c.api(pth, { method: m, ...(m === "POST" ? { body: "{}" } : {}) }); rs.push([m + " " + pth, r.status, (await json(r)).code]); }
  check(`${c.id}: all ${AFTER.length} after-sales endpoints are refused by the company gate (404 not_available), read or write`, rs.every(([, st, code]) => st === 404 && code === "not_available"), JSON.stringify(rs.filter(([, st, code]) => !(st === 404 && code === "not_available"))));
  const st = await json(await c.api("/api/state"));
  check(`${c.id}: the boot payload tells the interface the after-sales group is off`, st.modules?.afterSales === false);
}
{
  const rs = [];
  for (const [m, pth] of AFTER) { const r = await FOUNDING.api(pth, { method: m, ...(m === "POST" ? { body: "{}" } : {}) }); rs.push([m + " " + pth, r.status, (await json(r)).code]); }
  check("the founding company is still routed to the same endpoints (the gate does not refuse any of them)", rs.every(([, , code]) => code !== "not_available"), JSON.stringify(rs.filter(([, , code]) => code === "not_available")));
  const st = await json(await FOUNDING.api("/api/state"));
  check("the founding company's boot payload keeps the after-sales group on", st.modules?.afterSales === true);
}
// Document layouts (challan, delivery certificate, warranty certificate, handover) are leak-tested without a database: server/saas/documentLeak.test.ts.

// ------------------------------------------------------------------ E. subscription expiry at request time; storage limit
console.log("\nE. subscription expiry and storage limit");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OP = caller((await login("platform_op")).token);
const opSend = async (path, body) => OP(path, { method: "PATCH", body: JSON.stringify(body) });
const dayStr = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
for (const c of Object.values(CO)) psql(`insert into saas_subscriptions (id, company_id, plan_id, status, current_period_start, current_period_end) values ('sub-${c.id}-${RUN}','${c.id}','pilot','active','${dayStr(-5)}','${dayStr(30)}') on conflict (company_id) do update set status='active', current_period_end='${dayStr(30)}', limit_overrides='{}'::jsonb`);
await sleep(6000); // the subscription is cached for 5 seconds
const newLead = (c, tag) => c.api("/api/leads", { method: "POST", body: JSON.stringify({ name: `${c.name} ${tag}`, email: `${tag}${RUN}${c.id}@example.test`, phone: "0315" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral" }) });
{
  const a = CO.alpha, b = CO.beta;
  check("alpha, inside its paid period, can write", (await newLead(a, "inperiod")).status === 201);
  // ended 10 days ago: past the 3-day grace period
  psql(`update saas_subscriptions set current_period_end='${dayStr(-10)}' where company_id='co_alpha'`);
  await sleep(6000);
  const rd = await a.api("/api/admin/invoices"), st = await a.api("/api/state"), inv = await a.api(`/api/admin/invoices/${a.inv1.id}`);
  check(`alpha, past its end date + grace, can still READ (invoice list ${rd.status}, boot ${st.status}, invoice ${inv.status})`, rd.status === 200 && st.status === 200 && inv.status === 200);
  const pdf = await a.api(`/api/export/pdf/invoice/${a.inv1.id}`);
  check(`alpha can still print an invoice (${pdf.status})`, pdf.status === 200);
  const w = {
    create: await newLead(a, "expired"),
    edit: await a.api(`/api/admin/invoices/${a.inv1.id}`, { method: "PATCH", body: JSON.stringify({ notes: "x" }) }),
    pay: await a.api(`/api/admin/invoices/${a.inv1.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 1, paymentMethod: "Cash", paymentDate: dayStr(0) }) }),
    del: await a.api(`/api/admin/invoices/${a.inv1.id}`, { method: "DELETE" }),
    settings: await a.api("/api/company/settings/branding", { method: "PUT", body: JSON.stringify({ companyName: "x" }) }),
  };
  const wb = {}; for (const [k, r] of Object.entries(w)) wb[k] = [r.status, (await json(r)).code];
  check(`alpha, past its end date + grace, is refused every write with 402 subscription_expired ${JSON.stringify(wb)}`, Object.values(wb).every(([s, code]) => s === 402 && code === "subscription_expired"));
  check("nothing was written by those refused calls", psql(`select count(*) from invoice_payments where invoice_id='${a.inv1.id}' and amount=1`) === "0" && psql(`select coalesce(notes,'') <> 'x' from invoices where id='${a.inv1.id}'`) === "t");
  check("beta, whose subscription is valid, is unaffected at the same moment", (await newLead(b, "unaffected")).status === 201);
  const si = await login(a.user);
  check("alpha's staff can still sign in while expired", Boolean(si.token));
  // inside the grace period
  psql(`update saas_subscriptions set current_period_end='${dayStr(-1)}' where company_id='co_alpha'`);
  await sleep(6000);
  const gr = await newLead(a, "grace");
  check(`inside the grace period alpha can still write, and the response says so (${gr.status}, ${gr.headers.get("x-subscription-state")})`, gr.status === 201 && gr.headers.get("x-subscription-state") === "grace");
  // expired again, then renewed by the operator: takes effect without a restart or a job
  psql(`update saas_subscriptions set current_period_end='${dayStr(-10)}' where company_id='co_alpha'`);
  await sleep(6000);
  check("expired again: writes refused", (await newLead(a, "again")).status === 402);
  const renew = await opSend("/api/platform/companies/co_alpha", { periodEnd: dayStr(30) });
  check(`the operator can renew an expired company (${renew.status})`, renew.status === 200);
  await sleep(6000);
  check("after the renewal alpha can write again, within seconds, with no restart or job", (await newLead(a, "renewed")).status === 201);
  const fo = await FOUNDING.api("/api/leads", { method: "POST", body: JSON.stringify({ name: `founding ${RUN}`, email: `f${RUN}@example.test`, phone: "0316" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral" }) });
  check(`the founding company has no subscription row and is never limited (${fo.status})`, fo.status === 201);
}
// storage limit: its own journey (storage-quota.mjs): concurrent uploads at the boundary, every upload route, usage that cannot be verified, no limit set.
// leave the subscriptions in a clean, valid state for the other journeys. The application caches a company's limits for 15 seconds, so wait that
// out: the next journey must not meet this journey's "0 MB" limit.
await sleep(16000);
psql(`update saas_subscriptions set current_period_end='${dayStr(30)}', limit_overrides='{}'::jsonb where company_id in ('co_alpha','co_beta')`);

// ------------------------------------------------------------------ F. company settings: permissions and audit history
console.log("\nF. company settings: permissions and history");
for (const c of Object.values(CO)) {
  const gs = await json(await c.salesApi("/api/company/settings"));
  check(`${c.id}: a sales user can read the settings but is told it cannot edit`, gs.permissions?.canEdit === false && gs.permissions?.role === "Sales Executive");
  const gsa = await json(await c.api("/api/company/settings"));
  check(`${c.id}: the administrator is told it can edit`, gsa.permissions?.canEdit === true);
  const forbidden = [
    await c.salesApi("/api/company/settings/branding", { method: "PUT", body: JSON.stringify({ companyName: "HACK" }) }),
    await c.salesApi("/api/company/settings/bank-accounts", { method: "PUT", body: JSON.stringify({ accounts: [] }) }),
    await c.salesApi("/api/company/settings/terms", { method: "PUT", body: JSON.stringify({ terms: [] }) }),
    await c.salesApi("/api/company/settings/prices", { method: "PUT", body: JSON.stringify({ currencySettings: "x" }) }),
    await c.salesApi("/api/company/settings/history"),
  ];
  check(`${c.id}: a sales user is refused every change and the history (${forbidden.map((r) => r.status).join(",")})`, forbidden.every((r) => r.status === 403));
  check(`${c.id}: nothing was changed by the refused calls`, !JSON.stringify(await json(await c.api("/api/company/settings"))).includes("HACK"));
}
for (const c of Object.values(CO)) {
  const marker = `${c.id}-${RUN}`;
  const r1 = await json(await c.api("/api/company/settings/branding", { method: "PUT", body: JSON.stringify({ companyName: c.name, officeAddress: `Office ${marker}`, terms: c.terms }) }));
  const r2 = await json(await c.api("/api/company/settings/bank-accounts", { method: "PUT", body: JSON.stringify({ accounts: [acct(`AuditBank${marker}`, 333)] }) }));
  const r3 = await json(await c.api("/api/company/settings/terms", { method: "PUT", body: JSON.stringify({ terms: [`Clause one ${marker}`, `Clause two ${marker}`] }) }));
  const r4 = await json(await c.api("/api/company/settings/prices", { method: "PUT", body: JSON.stringify({ currencySettings: "PKR", taxSettings: `Tax note ${marker}`, quoteValidityDays: 21 }) }));
  check(`${c.id}: four changes by the administrator each recorded an audit row`, [r1, r2, r3, r4].every((r) => r.auditRecorded === true));
  const h = await json(await c.api("/api/company/settings/history?limit=20"));
  const mine = (h.history || []).filter((e) => JSON.stringify(e).includes(marker));
  check(`${c.id}: the history lists the changes, newest first, with who, when, section and before/after`, h.available === true && mine.length === 4 && mine[0].section === "prices" && mine.every((e) => e.by === c.user && e.role && e.at && e.summary) && new Date(h.history[0].at) >= new Date(h.history[1].at), JSON.stringify(h).slice(0, 300));
  const bank = mine.find((e) => e.section === "bank_accounts");
  check(`${c.id}: the bank-account entry holds the account before and after the change`, Array.isArray(bank?.before) && JSON.stringify(bank?.after).includes(`AuditBank${marker}`) && /^Bank accounts changed: .*(added|removed|edited)/.test(bank?.summary || "") && !(bank?.summary || "").includes(`AuditBank${marker}`));
  check(`${c.id}: every history row is stored under ${c.id}`, psql(`select count(*) from company_settings_audit where company_id <> '${c.id}' and (summary like '%${marker}%' or after_value::text like '%${marker}%')`) === "0");
  check(`${c.id}: the history cannot be edited or deleted, even by the database owner`, (() => { for (const q of [`update company_settings_audit set summary='x' where company_id='${c.id}'`, `delete from company_settings_audit where company_id='${c.id}'`]) { try { psql(q); return false; } catch {} } return true; })());
}
{
  const ha = JSON.stringify(await json(await CO.alpha.api("/api/company/settings/history?limit=200"))), hb = JSON.stringify(await json(await CO.beta.api("/api/company/settings/history?limit=200")));
  check("neither company's history contains the other's entries", !ha.includes(`co_beta-${RUN}`) && !hb.includes(`co_alpha-${RUN}`) && ha.includes(`co_alpha-${RUN}`) && hb.includes(`co_beta-${RUN}`));
  const fs = await FOUNDING.api("/api/company/settings/history");
  check(`the history endpoint answers the founding company too, with its own (empty or own) history (${fs.status})`, fs.status === 200 && !JSON.stringify(await json(fs)).includes(RUN));
}

console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
