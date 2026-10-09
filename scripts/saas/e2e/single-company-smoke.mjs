// Flag-off equivalence: with MULTI_COMPANY_ENABLED unset/false the existing single-company behaviour is unchanged.
// Disposable stack only. Env: E2E_BASE_URL, E2E_PSQL, TEST_PW (synthetic users t_admin, t_sales).
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3611";
const PW = process.env.TEST_PW;
if (!PW || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and point E2E_BASE_URL at a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q])).toString().trim();
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " — " + d : ""}`); };
const login = async (u) => (await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) })).json());
const call = (t) => (p, i = {}) => fetch(BASE + p, { ...i, headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(i.headers || {}) } });
const j = async (r) => { try { return await r.json(); } catch { return {}; } };

const adm = await login("t_admin"), sales = await login("t_sales");
check("login works and the response has no company fields (unchanged shape)", Boolean(adm.token) && adm.companies === undefined && adm.companyId === undefined);
const A = call(adm.token);
const lead = await j(await A("/api/leads", { method: "POST", body: JSON.stringify({ name: "Flag Off Client", email: "flagoff@example.test", phone: "0301" + Math.floor(1000000 + Math.random() * 8999999), leadSource: "Direct/Referral" }) }));
check("lead creation works", Boolean(lead.id), JSON.stringify(lead).slice(0, 120));
check("the lead is stored under the founding company (migrated default)", psql(`select company_id from leads where id='${lead.id}'`) === "sunchaser");
const qr = await A(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: 10, panelType: "Synthetic 500W", inverterType: "Synthetic 5kW", batteryCapacity: "None", totalCost: 250000, structureType: "L2", installationCharges: 0, netMeteringCharges: 0, paymentTerms: "50/40/10", warrantyTerms: "Standard", termsAndConditions: "Synthetic", boqItems: [{ type: "item", name: "Panels", description: "x", qty: 10, unit: "pcs", rate: 10000, total: 100000 }, { type: "item", name: "Inverter", description: "x", qty: 1, unit: "pcs", rate: 150000, total: 150000 }] }) });
check("quotation creation works", qr.status < 300, String(qr.status));
const contract = await j(await A(`/api/leads/${lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) }));
const inv = contract.contractProvision?.invoiceId;
check("contracting creates the invoice", Boolean(inv));
const pay = await A(`/api/admin/invoices/${inv}/payments`, { method: "POST", body: JSON.stringify({ amount: 50000, paymentMethod: "Cash", paymentDate: "2026-10-09", clientRequestId: "flagoff-pay-0001" }) });
check("payment recording works", pay.status < 300, String(pay.status));
const pdf = await A(`/api/export/pdf/invoice/${inv}`);
check("invoice PDF export works", pdf.status === 200 && (await pdf.arrayBuffer()).byteLength > 1000, String(pdf.status));
const state = await j(await A("/api/state"));
check("boot state contains the lead", (state.leads || []).some((l) => l.id === lead.id));
check("user administration works for the founding admin", (await A("/api/admin/users")).status === 200);
check("a Sales Executive still has their normal access", (await call(sales.token)("/api/state")).status === 200);
check("unauthenticated requests are still refused", (await fetch(`${BASE}/api/state`)).status === 401);
check("the select-company endpoint does not exist when the flag is off", (await A("/api/auth/select-company", { method: "POST", body: JSON.stringify({ companyId: "sunchaser" }) })).status === 404);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
