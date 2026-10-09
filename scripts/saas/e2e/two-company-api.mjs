// Black-box journey: two SYNTHETIC companies against a running server in MULTI_COMPANY_ENABLED=true mode.
// Disposable stack only. Env: E2E_BASE_URL, E2E_PSQL, TEST_PW. Seed first: seed-two-companies.mjs.
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3611";
const PW = process.env.TEST_PW;
if (!PW || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and point E2E_BASE_URL at a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q])).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " — " + detail : ""}`); };

const login = async (username) => { const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const call = (token) => (path, init = {}) => fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const phone = (p) => p + String(Math.floor(1000000 + Math.random() * 8999999));

// ---------- 1. sign-in and company selection ----------
const L = {};
for (const u of ["alpha_admin", "alpha_sales", "beta_admin", "beta_sales", "both_user", "nobody", "alpha_portal", "beta_portal", "t_admin"]) L[u] = await login(u);
check("alpha_admin signs in bound to co_alpha", L.alpha_admin.companyId === "co_alpha" && L.alpha_admin.companies?.length === 1, JSON.stringify(L.alpha_admin.companies));
check("beta_admin signs in bound to co_beta", L.beta_admin.companyId === "co_beta");
check("Sunchaser staff sign in bound to the founding company", L.t_admin.companyId === "sunchaser");
check("a user in two companies gets the list and no company yet", L.both_user.companies?.length === 2 && !L.both_user.companyId);
check("a portal customer is bound to the company that owns their customer record", L.beta_portal.companyId === "co_beta" && L.alpha_portal.companyId === "co_alpha");
check("a user with no membership signs in with an empty company list", Array.isArray(L.nobody.companies) && L.nobody.companies.length === 0);

const A = call(L.alpha_admin.token), B = call(L.beta_admin.token), S = call(L.t_admin.token), ASales = call(L.alpha_sales.token);
const noCompany = await call(L.both_user.token)("/api/leads", { method: "POST", body: JSON.stringify({ name: "x", email: "x@example.test", phone: phone("0300"), leadSource: "Direct/Referral" }) });
check("a multi-company user without a chosen company is asked to choose (409)", noCompany.status === 409 && (await json(noCompany)).code === "company_selection_required", String(noCompany.status));
const pick = await call(L.both_user.token)("/api/auth/select-company", { method: "POST", body: JSON.stringify({ companyId: "co_beta" }) });
const picked = await json(pick);
check("select-company issues a token for a company the user belongs to", pick.status === 200 && picked.companyId === "co_beta" && picked.role === "Sales Executive", String(pick.status));
const wrong = await call(L.alpha_admin.token)("/api/auth/select-company", { method: "POST", body: JSON.stringify({ companyId: "co_beta" }) });
check("select-company refuses a company the user is not in (403)", wrong.status === 403, String(wrong.status));
const noMember = await call(L.nobody.token)("/api/leads", { method: "POST", body: JSON.stringify({ name: "x", email: "x@example.test", phone: phone("0300"), leadSource: "Direct/Referral" }) });
check("a Super Admin with no membership cannot reach company routes (403)", noMember.status === 403, String(noMember.status));

// ---------- 2. leads ----------
const mkLead = async (api, name) => { const r = await api("/api/leads", { method: "POST", body: JSON.stringify({ name, email: `${name.replace(/\W+/g, ".")}@example.test`, phone: phone("0311"), leadSource: "Direct/Referral" }) }); return { status: r.status, ...(await json(r)) }; };
const LA = await mkLead(A, "Alpha Client One"), LB = await mkLead(B, "Beta Client One"), LS = await mkLead(S, "Sunchaser Client One");
check("each company can create a lead", [LA, LB, LS].every((l) => l.id), JSON.stringify([LA.status, LB.status, LS.status]));
check("leads are stored under the creating company", psql(`select company_id from leads where id='${LA.id}'`) === "co_alpha" && psql(`select company_id from leads where id='${LB.id}'`) === "co_beta" && psql(`select company_id from leads where id='${LS.id}'`) === "sunchaser");
const stateOf = async (api) => json(await api("/api/state"));
const sA = await stateOf(A), sB = await stateOf(B), sS = await stateOf(S);
const ids = (s) => new Set((s.leads || []).map((l) => l.id));
check("alpha's boot state contains its lead and none of beta's or Sunchaser's", ids(sA).has(LA.id) && !ids(sA).has(LB.id) && !ids(sA).has(LS.id), `state keys ${Object.keys(sA).length}, leads ${ids(sA).size}, err ${sA.error || ""}`);
check("beta's boot state contains only beta's lead", ids(sB).has(LB.id) && !ids(sB).has(LA.id) && !ids(sB).has(LS.id));
check("Sunchaser's boot state contains its lead and none from the pilot companies", ids(sS).has(LS.id) && !ids(sS).has(LA.id) && !ids(sS).has(LB.id));
const put = await B(`/api/leads/${LA.id}`, { method: "PUT", body: JSON.stringify({ status: "Contacted", name: "HACKED" }) });
check("beta cannot update alpha's lead", put.status >= 400 && psql(`select name from leads where id='${LA.id}'`) === "Alpha Client One", String(put.status));
const del = await B(`/api/leads/${LA.id}`, { method: "DELETE" });
check("beta cannot delete alpha's lead", del.status >= 400 && psql(`select count(*) from leads where id='${LA.id}' and deleted_at is null`) === "1", String(del.status));
const asg = await B(`/api/leads/${LA.id}/assign`, { method: "PUT", body: JSON.stringify({ assignedSalesperson: "u-beta-sales" }) });
check("beta cannot assign alpha's lead", asg.status >= 400, String(asg.status));
const sv = await B(`/api/leads/${LA.id}/smart-quote-versions`);
check("beta cannot read alpha's quotation versions", sv.status === 404 || sv.status === 403, String(sv.status));
const qp = await B(`/api/leads/${LA.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: 8, totalCost: 100000, boqItems: [{ type: "item", name: "x", qty: 1, unit: "pcs", rate: 1, total: 1 }] }) });
check("beta cannot create a quotation on alpha's lead", qp.status >= 400 && psql(`select count(*) from quotations where lead_id='${LA.id}'`) === "0", String(qp.status));

// ---------- 3. quotation -> invoice -> payment ----------
const boq = [{ type: "item", name: "Panels", description: "Synthetic", qty: 10, unit: "pcs", rate: 10000, total: 100000 }, { type: "item", name: "Inverter", description: "Synthetic", qty: 1, unit: "pcs", rate: 150000, total: 150000 }];
const qa = await A(`/api/leads/${LA.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: 10, panelType: "Synthetic 500W", inverterType: "Synthetic 5kW", batteryCapacity: "None", totalCost: 250000, structureType: "L2", installationCharges: 0, netMeteringCharges: 0, paymentTerms: "50/40/10", warrantyTerms: "Standard", termsAndConditions: "Synthetic", boqItems: boq }) });
check("alpha can create a quotation on its own lead", qa.status < 300, String(qa.status));
const contracted = await json(await A(`/api/leads/${LA.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) }));
const invId = contracted.contractProvision?.invoiceId;
check("contracting alpha's lead creates alpha's invoice", Boolean(invId) && psql(`select company_id from invoices where id='${invId}'`) === "co_alpha", JSON.stringify(contracted.contractProvision || {}).slice(0, 160));
if (invId) {
  const g = await B(`/api/admin/invoices/${invId}`);
  check("beta cannot read alpha's invoice", g.status === 404 || g.status === 403, String(g.status));
  const list = await json(await B("/api/admin/invoices"));
  check("beta's invoice list does not contain alpha's invoice", !JSON.stringify(list).includes(invId));
  const alist = await json(await A("/api/admin/invoices"));
  check("alpha's invoice list contains its invoice", JSON.stringify(alist).includes(invId));
  const pay = await B(`/api/admin/invoices/${invId}/payments`, { method: "POST", body: JSON.stringify({ amount: 1000, paymentMethod: "Cash", paymentDate: "2026-10-09", clientRequestId: "beta-attack-0001" }) });
  check("beta cannot record a payment on alpha's invoice", pay.status >= 400 && psql(`select count(*) from invoice_payments where invoice_id='${invId}'`) === "0", String(pay.status));
  const patch = await B(`/api/admin/invoices/${invId}`, { method: "PATCH", body: JSON.stringify({ notes: "HACKED" }) });
  check("beta cannot edit alpha's invoice", patch.status >= 400, String(patch.status));
  const pdf = await B(`/api/export/pdf/invoice/${invId}`);
  check("beta cannot export alpha's invoice PDF", pdf.status === 404 || pdf.status === 403, String(pdf.status));
  const delInv = await B(`/api/admin/invoices/${invId}`, { method: "DELETE" });
  check("beta cannot delete alpha's invoice", delInv.status >= 400 && psql(`select count(*) from invoices where id='${invId}'`) === "1", String(delInv.status));
  const okPay = await A(`/api/admin/invoices/${invId}/payments`, { method: "POST", body: JSON.stringify({ amount: 50000, paymentMethod: "Cash", paymentDate: "2026-10-09", clientRequestId: "alpha-pay-0001" }) });
  check("alpha can record a payment on its own invoice, stored under alpha", okPay.status < 300 && psql(`select company_id from invoice_payments where invoice_id='${invId}'`) === "co_alpha", String(okPay.status));
  const aPdf = await A(`/api/export/pdf/invoice/${invId}`);
  check("alpha can export its own invoice PDF", aPdf.status === 200 && (await aPdf.arrayBuffer()).byteLength > 1000, String(aPdf.status));
}

// ---------- 4. documents ----------
const custA = psql(`select customer_id from leads where id='${LA.id}'`) || psql(`select id from customers where company_id='co_alpha' limit 1`);
const doc = (api, customerId) => api("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId, documentType: "other", title: "Synthetic doc", fileName: "note.pdf", mimeType: "application/pdf", base64Data: Buffer.from("%PDF-1.4\n% synthetic\n%%EOF\n").toString("base64"), clientUploadId: "doc-" + Math.random().toString(36).slice(2) }) });
if (custA) {
  const own = await doc(A, custA);
  check("alpha can upload a document for its customer", own.status < 300, `${own.status} ${(await own.text()).slice(0, 120)}`);
  const foreign = await doc(B, custA);
  check("beta cannot upload a document onto alpha's customer", foreign.status >= 400, String(foreign.status));
  const lst = await B(`/api/admin/customer-documents/${custA}`);
  const lstBody = await json(lst);
  check("beta cannot list alpha customer's documents", lst.status >= 400 || (Array.isArray(lstBody.documents ?? lstBody) && (lstBody.documents ?? lstBody).length === 0), String(lst.status));
  check("the stored document belongs to alpha", psql(`select company_id from customer_documents where customer_id='${custA}' limit 1`) === "co_alpha");
}

// ---------- 5. features that are not company-scoped are invisible to other companies ----------
for (const [path, label] of [["/api/admin/users", "user administration"], ["/api/admin/roles", "role administration"], ["/api/marketplace/admin/products", "marketplace admin"], ["/api/diagnostics/phase7-columns", "diagnostics"], ["/api/backup/export", "full backup export"], ["/api/learning/courses", "learning studio"]]) {
  const r = await B(path);
  check(`beta cannot reach ${label} (${path})`, r.status === 404 || r.status === 403, String(r.status));
}
const sunUsers = await S("/api/admin/users");
check("the founding company still reaches user administration", sunUsers.status === 200, String(sunUsers.status));
check("an unknown API path is refused for companies", (await B("/api/brand-new-module")).status === 403);

// ---------- 6. things a caller must not be able to choose ----------
const spoofHdr = await B("/api/state", { headers: { "x-company-id": "co_alpha" } });
const spoofBody = await json(spoofHdr);
check("an x-company-id header sent by a client is ignored", !JSON.stringify(spoofBody.leads || []).includes(LA.id));
const spoofQuery = await json(await B("/api/state?companyId=co_alpha&company_id=co_alpha"));
check("a companyId query parameter is ignored", !JSON.stringify(spoofQuery.leads || []).includes(LA.id));
const forged = await fetch(`${BASE}/api/state`, { headers: { authorization: "Bearer " + L.beta_admin.token.split(".").slice(0, 2).join(".") + "." + "A".repeat(43) } });
check("a token with a tampered signature is rejected", forged.status === 401, String(forged.status));
const payloadB64 = L.beta_admin.token.split(".")[1];
const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
const swapped = L.beta_admin.token.split(".")[0] + "." + Buffer.from(JSON.stringify({ ...claims, cid: "co_alpha" })).toString("base64url") + "." + L.beta_admin.token.split(".")[2];
check("a token whose company claim was edited is rejected", (await fetch(`${BASE}/api/state`, { headers: { authorization: `Bearer ${swapped}` } })).status === 401);

// ---------- 7. portal customers ----------
const PB = call(L.beta_portal.token);
const meB = await PB("/api/customer-portal/me");
check("a portal customer can reach their own portal route", meB.status < 500, String(meB.status));
check("a portal customer cannot reach staff routes", (await PB("/api/admin/invoices")).status === 403);

// ---------- 8. membership and company status take effect ----------
psql(`update company_memberships set status='suspended' where user_id='u-alpha-sales'`);
await new Promise((r) => setTimeout(r, 6500)); // membership cache is 5 s
check("a suspended membership loses access within seconds", (await ASales("/api/state")).status === 403);
psql(`update company_memberships set status='active' where user_id='u-alpha-sales'`);
psql(`update companies set status='suspended' where id='co_beta'`);
await new Promise((r) => setTimeout(r, 6500));
const sus = await B("/api/state");
check("a suspended company is locked out with a clear code", sus.status === 403 && (await json(sus)).code === "company_inactive", String(sus.status));
check("the other company is unaffected by that suspension", (await A("/api/state")).status === 200);
psql(`update companies set status='active' where id='co_beta'`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("Failed:\n - " + failures.join("\n - "));
process.exitCode = fail ? 1 : 0;
