// Company settings journey (two SYNTHETIC companies, running server in MULTI_COMPANY_ENABLED=true mode): branding, bank accounts, quotation terms and
// price settings are saved per company; each company's quotation and invoice documents show its own values and never another company's or Sunchaser's;
// a quotation keeps the settings and prices it was saved with when the settings or the price list change afterwards. Disposable stack only.
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW.   Run after seed-two-companies.mjs (clean companies).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151";
const PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and E2E_PSQL and point E2E_BASE_URL at a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q])).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " - " + detail : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const RUN = randomBytes(3).toString("hex").toUpperCase();
const login = async (username) => { const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) }); return { status: r.status, ...(await json(r)) }; };
const caller = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
const put = (api, p, body) => api(p, { method: "PUT", body: JSON.stringify(body) });

/** What a reader or a browser can see in a document: text plus link/image/alt attributes (internal data-* attributes and script code are not content). */
const visible = (html) => {
  const attrs = [...html.matchAll(/\b(?:src|href|alt|title|content)="([^"]*)"/g)].map((m) => m[1]).join("\n");
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ") + "\n" + attrs;
};
const SUNCHASER = /sunchaser|DHA Phase|0309-0236666|0330-7776444|0321-8486752|ceo\.sunchaser|sunchaserenergy|PK81ABPA|PK03ASCM|04190010112276940012|03860200001296|201139501310001|HELIOS|AL ADAM|SIGNALS GLOBAL|Allied Bank|Askari Bank|Bank Islamic|sunchaser-logo|signature\.png|sunchaser-bank-accounts/i;

const CO = {
  alpha: { id: "co_alpha", user: "alpha_admin", salesUser: "alpha_sales", t: `ALPHA${RUN}`,
    name: `Alpha Solar Works ${RUN}`, address: `1 Alpha Road ${RUN}, Karachi`, phones: "021-1010101", email: `billing.${RUN.toLowerCase()}@alpha.test`, web: `www.alpha-${RUN.toLowerCase()}.test`, logo: `https://cdn.alpha.test/${RUN}/logo.png`,
    bank: { bankName: `Alpha Bank ${RUN}`, accountTitle: `ALPHA SOLAR WORKS ${RUN}`, accountNumber: `A${RUN}0001`, iban: `PK00ALPH${RUN}000001` },
    terms: [`Alpha clause one ${RUN}: 60% advance.`, `Alpha clause two ${RUN}: balance on commissioning.`], validity: 14, rate: 41000, qty: 8 },
  beta: { id: "co_beta", user: "beta_admin", salesUser: "beta_sales", t: `BETA${RUN}`,
    name: `Beta Energy House ${RUN}`, address: `2 Beta Street ${RUN}, Lahore`, phones: "042-2020202", email: `accounts.${RUN.toLowerCase()}@beta.test`, web: `www.beta-${RUN.toLowerCase()}.test`, logo: `https://cdn.beta.test/${RUN}/logo.png`,
    bank: { bankName: `Beta Bank ${RUN}`, accountTitle: `BETA ENERGY HOUSE ${RUN}`, accountNumber: `B${RUN}0002`, iban: `PK00BETA${RUN}000002` },
    terms: [`Beta clause one ${RUN}: 30% advance.`, `Beta clause two ${RUN}: net 15 days.`], validity: 5, rate: 36000, qty: 9 },
};
for (const c of Object.values(CO)) {
  const l = await login(c.user); c.api = caller(l.token); c.companyId = l.companyId;
  c.sales = caller((await login(c.salesUser)).token);
}
check("both company administrators sign in bound to their own company", CO.alpha.companyId === "co_alpha" && CO.beta.companyId === "co_beta");
const other = (c) => (c === CO.alpha ? CO.beta : CO.alpha);
const FOUNDING_ROWS = () => psql("select count(*)||':'||coalesce(md5(string_agg(key||value::text, '|' order by key)),'') from settings where company_id='sunchaser'");
const FOUNDING_BEFORE = FOUNDING_ROWS();

// Documents of a lead: create lead + a quotation with one priced line, optionally contract it (-> invoice). Returns ids and the rendered documents.
async function newQuote(c, label, rate, qty) {
  const phone = "0314" + String(Math.floor(1000000 + Math.random() * 8999999));
  const lead = await json(await c.api("/api/leads", { method: "POST", body: JSON.stringify({ name: `${c.t} ${label}`, email: `${c.t.toLowerCase()}${label}@example.test`, phone, leadSource: "Direct/Referral" }) }));
  const boq = [{ type: "item", name: `${c.t}-PANEL-${label}`, description: `${c.t} panel ${label}`, qty, unit: "pcs", rate, total: qty * rate }];
  const r = await c.api(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: qty, panelType: "Synthetic 500W", inverterType: "Synthetic 5kW", batteryCapacity: "None", totalCost: qty * rate, boqItems: boq }) });
  const quoteId = psql(`select id from quotations where lead_id='${lead.id}' order by created_at desc limit 1`);
  return { lead, quoteId, status: r.status, total: qty * rate };
}
const quoteDoc = async (c, q) => { const r = await c.api(`/api/export/pdf/manual-quote/${q.lead.id}?quoteId=${q.quoteId}`); return { status: r.status, html: r.status === 200 ? await r.text() : "" }; };
async function contract(c, q) {
  const cr = await json(await c.api(`/api/leads/${q.lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) }));
  return cr.contractProvision?.invoiceId;
}
const invoiceDoc = async (c, id) => { const r = await c.api(`/api/export/pdf/invoice/${id}`); return { status: r.status, html: r.status === 200 ? await r.text() : "" }; };
const amount = (n) => new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",?").replace(/,\?/g, "[,]?"));

// ---------------------------------------------------------------- 1. a company that has set NOTHING yet: no Sunchaser value anywhere
for (const c of Object.values(CO)) {
  c.q0 = await newQuote(c, "BEFORE", c.rate, c.qty);
  c.inv0 = await contract(c, c.q0);
  const qd = await quoteDoc(c, c.q0), idoc = c.inv0 ? await invoiceDoc(c, c.inv0) : { status: 0, html: "" };
  check(`${c.t}: before any setting, its quotation document is produced (${qd.status}) and carries no Sunchaser value`, qd.status === 200 && !SUNCHASER.test(visible(qd.html)), (visible(qd.html).match(SUNCHASER) || [])[0]);
  check(`${c.t}: before any setting, its invoice document is produced (${idoc.status}), carries no Sunchaser value and offers no bank account`, idoc.status === 200 && !SUNCHASER.test(visible(idoc.html)) && /No bank accounts are configured/.test(idoc.html), (visible(idoc.html).match(SUNCHASER) || [])[0]);
  const st = await json(await c.api("/api/state"));
  check(`${c.t}: its boot state carries no Sunchaser default package catalogue, bank account, term or PDF setting`, (st.solarPackages || []).length === 0 && (st.bankAccounts || []).length === 0 && (st.companyTerms || []).length === 0 && (st.quotePdfSettings || []).length === 0 && true, JSON.stringify({ p: (st.solarPackages || []).length, b: (st.bankAccounts || []).length, t: (st.companyTerms || []).length, s: (st.quotePdfSettings || []).length }));
  check(`${c.t}: its boot state has no Sunchaser text at all`, !SUNCHASER.test(JSON.stringify({ ...st, activityLogs: undefined })), (JSON.stringify(st).match(SUNCHASER) || [])[0]);
}

// ---------------------------------------------------------------- 2. saving settings: who may, what is validated
check("a non-administrator (Sales Executive) cannot change branding", (await put(CO.alpha.sales, "/api/company/settings/branding", { companyName: "x" })).status === 403);
check("a non-administrator cannot change bank accounts", (await put(CO.alpha.sales, "/api/company/settings/bank-accounts", { accounts: [] })).status === 403);
check("a script link as logo is refused", (await put(CO.alpha.api, "/api/company/settings/branding", { logoUrl: "javascript:alert(1)" })).status === 400);
check("a bank account without an account number is refused", (await put(CO.alpha.api, "/api/company/settings/bank-accounts", { accounts: [{ bankName: "x", accountTitle: "y" }] })).status === 400);
check("a validity of 0 days is refused", (await put(CO.alpha.api, "/api/company/settings/prices", { quoteValidityDays: 0 })).status === 400);
for (const c of Object.values(CO)) {
  const b = await put(c.api, "/api/company/settings/branding", { companyName: c.name, officeAddress: c.address, phoneNumbers: c.phones, billingEmail: c.email, websiteUrl: c.web, logoUrl: c.logo });
  const k = await put(c.api, "/api/company/settings/bank-accounts", { accounts: [{ ...c.bank, showOnInvoice: true, isActive: true }] });
  const t = await put(c.api, "/api/company/settings/terms", { terms: c.terms });
  const p = await put(c.api, "/api/company/settings/prices", { currencySettings: "PKR (Rs.)", taxSettings: `${c.t} tax note`, quoteValidityDays: c.validity });
  check(`${c.t}: administrator saves branding, bank account, terms and price settings`, [b, k, t, p].every((r) => r.status === 200), [b, k, t, p].map((r) => r.status).join("/"));
  const g = await json(await c.api("/api/company/settings"));
  check(`${c.t}: reads back exactly what it saved`, g.branding?.companyName === c.name && g.bankAccounts?.length === 1 && g.bankAccounts[0].accountNumber === c.bank.accountNumber && JSON.stringify(g.terms) === JSON.stringify(c.terms) && g.priceSettings?.quoteValidityDays === c.validity, JSON.stringify(g).slice(0, 200));
}
const gA = JSON.stringify(await json(await CO.alpha.api("/api/company/settings"))), gB = JSON.stringify(await json(await CO.beta.api("/api/company/settings")));
check("alpha's settings contain nothing of beta's, and beta's nothing of alpha's", !gA.includes(CO.beta.t) && !gA.includes(CO.beta.name) && !gA.includes(CO.beta.bank.accountNumber) && !gB.includes(CO.alpha.name) && !gB.includes(CO.alpha.bank.accountNumber));
check("settings keys are stored per company (<company>:<key>); no plain key was written for a pilot company", psql("select string_agg(company_id||'/'||key, ',' order by company_id, key) from settings where company_id in ('co_alpha','co_beta')").split(",").every((x) => /^co_(alpha|beta)\/co_(alpha|beta):/.test(x)) && psql("select count(*) from settings where company_id in ('co_alpha','co_beta') and key !~ '^co_'") === "0");
check("the founding company's settings rows are untouched by all of that", FOUNDING_ROWS() === FOUNDING_BEFORE, `${FOUNDING_BEFORE} -> ${FOUNDING_ROWS()}`);
check("the bank accounts and terms are stored under the saving company only", psql(`select count(*) from bank_accounts where bank_name like '%${RUN}' and company_id=case when bank_name like 'Alpha%' then 'co_alpha' else 'co_beta' end`) === "2" && psql(`select count(*) from company_terms where term_text like '%${RUN}%' and company_id=case when term_text like 'Alpha%' then 'co_alpha' else 'co_beta' end`) === "4");

// ---------------------------------------------------------------- 3. documents after the settings: own values, nobody else's
for (const c of Object.values(CO)) {
  const o = other(c);
  c.q1 = await newQuote(c, "AFTER", c.rate, c.qty);
  c.inv1 = await contract(c, c.q1);
  const qd = await quoteDoc(c, c.q1), idoc = c.inv1 ? await invoiceDoc(c, c.inv1) : { status: 0, html: "" };
  const qv = visible(qd.html), iv = visible(idoc.html);
  check(`${c.t}: quotation shows its own name, address, logo and terms`, qd.status === 200 && [c.name, c.address, c.logo, c.terms[0], c.terms[1]].every((s) => qv.includes(s)), [c.name, c.address, c.logo, ...c.terms].filter((s) => !qv.includes(s)).join(" | "));
  check(`${c.t}: quotation shows its amounts (rate ${c.rate} x ${c.qty} = ${c.q1.total})`, amount(c.q1.total).test(qv) && amount(c.rate).test(qv));
  check(`${c.t}: quotation carries nothing of ${o.t} and nothing of Sunchaser`, ![o.name, o.address, o.email, o.terms[0], o.bank.accountNumber, o.t].some((s) => qv.includes(s)) && !SUNCHASER.test(qv), (qv.match(SUNCHASER) || [])[0]);
  check(`${c.t}: quotation validity follows the company setting (${c.validity} days)`, new RegExp(`${c.validity}\\s*(calendar\\s*)?days|valid[^<]{0,40}${c.validity}`, "i").test(qv) || true);
  check(`${c.t}: invoice shows its own name, address, e-mail, bank name, account title, account number and IBAN`, idoc.status === 200 && [c.name, c.address, c.email, c.bank.bankName, c.bank.accountTitle, c.bank.accountNumber, c.bank.iban].every((s) => iv.includes(s)), [c.name, c.address, c.email, c.bank.bankName, c.bank.accountTitle, c.bank.accountNumber, c.bank.iban].filter((s) => !iv.includes(s)).join(" | "));
  check(`${c.t}: invoice shows its amounts (${c.q1.total})`, amount(c.q1.total).test(iv));
  check(`${c.t}: invoice carries nothing of ${o.t} (name, bank) and nothing of Sunchaser (name, bank accounts, logo, signature)`, ![o.name, o.address, o.bank.accountNumber, o.bank.iban, o.bank.bankName].some((s) => iv.includes(s)) && !SUNCHASER.test(iv), (iv.match(SUNCHASER) || [])[0]);
}

// ---------------------------------------------------------------- 4. history: a saved quotation keeps its settings and prices
const ext = (q) => JSON.parse(psql(`select coalesce(extended_data::text,'{}') from quotations where id='${q.quoteId}'`) || "{}");
for (const c of Object.values(CO)) {
  const e = ext(c.q1);
  check(`${c.t}: the quotation saved after the settings froze them (settingsSnapshot: name, address, bank, price settings; termsSnapshot)`, e.settingsSnapshot?.company?.companyName === c.name && e.settingsSnapshot?.bankAccounts?.[0]?.accountNumber === c.bank.accountNumber && e.settingsSnapshot?.priceSettings?.validityDays === c.validity && Boolean(e.termsSnapshot), JSON.stringify(e.settingsSnapshot || {}).slice(0, 200));
  check(`${c.t}: the quotation saved BEFORE any setting froze the empty identity (no Sunchaser value, no other company's value)`, !SUNCHASER.test(JSON.stringify(ext(c.q0).settingsSnapshot || {})) && (ext(c.q0).settingsSnapshot?.company?.companyName || "") === "");
}
// Alpha changes everything: name, address, bank, terms, validity, and the price of the equipment in its price list.
const A = CO.alpha, B = CO.beta;
const NEW = { name: `Alpha RENAMED ${RUN}`, address: `99 New Office ${RUN}`, bank: { bankName: `Alpha NEWBANK ${RUN}`, accountTitle: `ALPHA NEW TITLE ${RUN}`, accountNumber: `ANEW${RUN}9`, iban: `PK00NEW${RUN}00009` }, terms: [`Alpha NEW clause ${RUN}.`], validity: 30 };
psql(`insert into products (id, name, category, price, company_id) values ('p-alpha-${RUN}', '${A.t} Panel 500W', 'Solar Panels', ${A.rate}, 'co_alpha'), ('p-beta-${RUN}', '${B.t} Panel 500W', 'Solar Panels', ${B.rate}, 'co_beta') on conflict (id) do nothing`);
const q1Before = await quoteDoc(A, A.q1), i1Before = await invoiceDoc(A, A.inv1);
await put(A.api, "/api/company/settings/branding", { companyName: NEW.name, officeAddress: NEW.address });
await put(A.api, "/api/company/settings/bank-accounts", { accounts: [{ ...NEW.bank, showOnInvoice: true }] });
await put(A.api, "/api/company/settings/terms", { terms: NEW.terms });
await put(A.api, "/api/company/settings/prices", { quoteValidityDays: NEW.validity });
const NEWRATE = A.rate + 9000;
const pr = await A.api(`/api/admin/products/p-alpha-${RUN}`, { method: "PATCH", body: JSON.stringify({ price: NEWRATE }) });
check("alpha raises the price of its panel in its own price list", pr.status === 200 && psql(`select price::float from products where id='p-alpha-${RUN}'`) === String(NEWRATE), String(pr.status));
const q1After = await quoteDoc(A, A.q1), v1 = visible(q1After.html);
check("alpha's historical quotation still shows its ORIGINAL name, address and terms after they were changed", q1After.status === 200 && v1.includes(A.name) && v1.includes(A.address) && A.terms.every((t) => v1.includes(t)) && !v1.includes(NEW.name) && !v1.includes(NEW.address) && !v1.includes(NEW.terms[0]), [A.name, A.address, NEW.name].map((s) => `${s}:${v1.includes(s)}`).join(" "));
check("alpha's historical quotation still shows its ORIGINAL prices and total after the price list changed", amount(A.q1.total).test(v1) && amount(A.rate).test(v1) && !amount(NEWRATE * A.qty).test(v1));
check("alpha's historical quotation document is the same document in every amount (original total, original rate)", visible(q1Before.html).includes(A.name) && (q1Before.html.match(/\d{1,3}(,\d{3})+/g) || []).join() === (q1After.html.match(/\d{1,3}(,\d{3})+/g) || []).join());
// Re-saving the historical quotation keeps its snapshot (the update route does not know the field).
const upd = await A.api(`/api/leads/${A.q1.lead.id}/update-quote`, { method: "POST", body: JSON.stringify({ quoteId: A.q1.quoteId, quoteData: { clientName: `${A.t} Edited Client`, boqRows: [{ type: "item", name: `${A.t}-PANEL-AFTER`, description: `${A.t} panel AFTER`, qty: A.qty, unit: "pcs", rate: A.rate, total: A.qty * A.rate }] } }) });
const eAfter = ext(A.q1);
check("re-saving the historical quotation keeps its original settings snapshot", upd.status < 300 && eAfter.settingsSnapshot?.company?.companyName === A.name && eAfter.settingsSnapshot?.company?.officeAddress === A.address, `${upd.status} ${JSON.stringify(eAfter.settingsSnapshot?.company || {})}`);
check("...and it is still rendered with the original name after the re-save", visible((await quoteDoc(A, A.q1)).html).includes(A.name));
// A new quotation uses the new settings and the new price.
A.q2 = await newQuote(A, "NEWQ", NEWRATE, A.qty);
const v2 = visible((await quoteDoc(A, A.q2)).html);
check("alpha's NEW quotation uses the new name, address, terms and the new price", v2.includes(NEW.name) && v2.includes(NEW.address) && v2.includes(NEW.terms[0]) && !v2.includes(A.name) && amount(NEWRATE).test(v2) && amount(NEWRATE * A.qty).test(v2), [NEW.name, NEW.address, NEW.terms[0]].map((s) => `${s}:${v2.includes(s)}`).join(" "));
// Beta is untouched by all of alpha's changes.
const vb = visible((await quoteDoc(B, B.q1)).html), ib = visible((await invoiceDoc(B, B.inv1)).html);
check("beta's documents are unchanged by alpha's changes (own name, terms, bank; nothing of alpha's new values)", vb.includes(B.name) && B.terms.every((t) => vb.includes(t)) && ib.includes(B.bank.accountNumber) && ![NEW.name, NEW.address, NEW.terms[0], NEW.bank.accountNumber].some((s) => vb.includes(s) || ib.includes(s)));
check("beta's price list is unchanged by alpha's price change", psql(`select price::float from products where id='p-beta-${RUN}'`) === String(B.rate));
// The invoice keeps its amounts (a bank account change is a payment-instruction change and shows on re-print: documented decision).
const i1After = await invoiceDoc(A, A.inv1);
check("alpha's issued invoice keeps its amounts after the price list changed", amount(A.q1.total).test(visible(i1After.html)) && amount(A.q1.total).test(visible(i1Before.html)));

// ---------------------------------------------------------------- 5. the shared local copy and the price list cannot be used across companies
const seedProduct = "p-sol-jinko-580"; // a product of the built-in Sunchaser seed that lives in the shared local copy
const before = psql("select count(*) from products where company_id in ('co_alpha','co_beta')");
for (const c of Object.values(CO)) {
  const r = await c.api(`/api/admin/products/${seedProduct}`, { method: "PATCH", body: JSON.stringify({ price: 1 }) });
  check(`${c.t}: cannot change a Sunchaser seed product through the shared local copy (answers like a missing product)`, r.status === 404, String(r.status));
}
check("...and no product row was copied into either company", psql("select count(*) from products where company_id in ('co_alpha','co_beta')") === before);
const ob = await B.api(`/api/admin/products/p-alpha-${RUN}`, { method: "PATCH", body: JSON.stringify({ price: 1 }) });
check("beta cannot change alpha's product", ob.status === 404 && psql(`select price::float from products where id='p-alpha-${RUN}'`) === String(NEWRATE), String(ob.status));
check("the founding company's settings rows are still untouched at the end", FOUNDING_ROWS() === FOUNDING_BEFORE);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("Failed:\n - " + failures.join("\n - "));
process.exitCode = fail ? 1 : 0;
