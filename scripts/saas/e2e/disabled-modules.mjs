// Disabled modules, called as the REAL pilot users of two SYNTHETIC companies (a company administrator, a sales user, a portal customer), against a
// running multi-company server on a disposable stack. Every API path of a module that is off for pilot companies must answer "not found" with the
// code not_available BEFORE any handler runs - for every user, every method - while the founding company still reaches the same paths.
//   modules: AutoSizer, after-sales (delivery, warranty, handover), WhatsApp inbox and connection, interactive proposals / Proposal Studio / Roof Studio,
//            AI assistant and the portal sizing wizard
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW.   Seed first: seed-two-companies.mjs, reset-founding-test-passwords.mjs
import { execFileSync } from "node:child_process";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151";
const PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and E2E_PSQL and point E2E_BASE_URL at a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " - " + String(detail).slice(0, 300) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const login = async (u) => json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const caller = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) } });

const USERS = {
  "alpha administrator": "alpha_admin", "alpha sales user": "alpha_sales", "beta administrator": "beta_admin", "alpha portal customer": "alpha_portal", "beta portal customer": "beta_portal",
};
const who = {};
for (const [label, u] of Object.entries(USERS)) { const l = await login(u); who[label] = { api: l.token ? caller(l.token) : null, role: l.user?.role || l.role }; }
const founding = await login(process.env.FOUNDING_USER || "t_admin");
const F = caller(founding.token);
check("the pilot users and the founding administrator sign in", Object.values(who).every((w) => w.api) && Boolean(founding.token));

// a lead of the founding company to name in paths (a pilot user must not be able to use it either way)
const lead = await json(await F("/api/leads", { method: "POST", body: JSON.stringify({ name: "Module gate probe", email: "probe@example.test", phone: "0318" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral" }) }));
const L = lead.id || "lead-probe";

const MODULES = {
  AutoSizer: [["GET", "/api/admin/autosizer-presets"], ["PUT", "/api/admin/autosizer-presets", {}], [`GET`, `/api/export/pdf/auto-sizer/${L}`], ["GET", `/api/export/pdf/auto-sizer/${L}/download`]],
  "after-sales (delivery, warranty, handover)": [
    ["GET", "/api/admin/deliveries"], ["POST", "/api/admin/deliveries", {}], ["GET", "/api/admin/deliveries/dch-1"], ["GET", "/api/admin/deliveries/dch-1/challan-pdf"], ["GET", "/api/admin/delivery-dashboard/contracted-customers"],
    ["GET", "/api/admin/invoices/inv-1/deliveries"], ["GET", "/api/admin/invoices/inv-1/delivery-summary"], ["GET", "/api/admin/project-deliveries"], ["GET", "/api/admin/project-completion/gaps"],
    ["GET", "/api/admin/customer-warranties"], ["GET", "/api/admin/warranty-claims"], ["GET", "/api/technical/project-deliveries/me"], ["GET", "/api/warranties/w1/claims"],
    ["GET", "/api/customer-portal/deliveries/me"], ["GET", "/api/customer-portal/project-delivery/me"], ["GET", "/api/customer-portal/warranties/me"], ["POST", "/api/customer-portal/warranty-claim", {}],
    ["GET", "/api/export/pdf/warranty-handover/d1"],
  ],
  "WhatsApp inbox and connection": [
    ["GET", "/api/inbox/threads"], ["GET", "/api/inbox"], ["POST", "/api/inbox/threads/t1/messages", {}], ["GET", "/api/conversations"], ["GET", "/api/conversations/c1/messages"],
    ["GET", "/api/admin/whatsapp"], ["GET", "/api/admin/whatsapp/status"], ["GET", "/api/whatsapp-agent/status"],
  ],
  "interactive proposals, Proposal Studio, Roof Studio": [
    ["GET", "/api/interactive-proposals"], ["POST", "/api/interactive-proposals", {}], ["POST", "/api/interactive-proposals/ip1/revoke", {}],
    ["GET", `/api/leads/${L}/design-session`], ["PUT", `/api/leads/${L}/design-session`, {}], ["POST", "/api/export/pdf/design-studio-proposal/download", {}],
  ],
  "AI assistant and portal sizing wizard": [["POST", "/api/ai/chat", {}], ["POST", "/api/gemini/chat", {}], ["POST", "/api/gemini/sizing-recommendations", {}], ["POST", "/api/gemini/generate-proposal", {}]],
};

let calls = 0;
for (const [module, list] of Object.entries(MODULES)) {
  console.log(`\n${module}`);
  const bad = [];
  for (const [label, w] of Object.entries(who)) {
    for (const [m, p, body] of list) {
      const r = await w.api(p, { method: m, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const b = await json(r);
      calls++;
      // 404 with the gate's code, and a body that is exactly the gate's: no handler ran, nothing about the module leaked. A PORTAL CUSTOMER on a
      // staff-only path is stopped even earlier by the staff-route check (403), which is a stricter refusal of the same request.
      const gate = r.status === 404 && b.code === "not_available" && Object.keys(b).sort().join() === "code,error";
      const staffOnly = label.includes("portal customer") && r.status === 403 && /Not authorized for staff routes/.test(b.error || "") && Object.keys(b).join() === "error";
      if (!gate && !staffOnly) bad.push(`${label}: ${m} ${p} -> ${r.status} ${JSON.stringify(b).slice(0, 100)}`);
    }
  }
  check(`${module}: all ${list.length} paths are refused (404 not_available; a portal customer on a staff-only path gets the earlier 403) for all ${Object.keys(who).length} pilot users, before any handler (${list.length * Object.keys(who).length} calls)`, bad.length === 0, bad.slice(0, 4).join(" || "));
}

// the saved-quote route that has its own refusal (an AutoSizer quote)
{
  const A = who["alpha administrator"].api;
  const lead2 = await json(await A("/api/leads", { method: "POST", body: JSON.stringify({ name: "AutoSizer gate", email: "as@example.test", phone: "0319" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral" }) }));
  const boq = [{ type: "item", name: "x", description: "x", qty: 1, unit: "pcs", rate: 1000, total: 1000 }];
  const r = await A(`/api/leads/${lead2.id}/create-quote`, { method: "POST", body: JSON.stringify({ quote_type: "auto_sizer", systemSizekW: 5, totalCost: 1000, boqItems: boq }) });
  const b = await json(r);
  check(`an AutoSizer quote cannot be saved by a pilot administrator: ${r.status} ${b.code}`, r.status === 403 && b.code === "module_disabled", JSON.stringify(b).slice(0, 160));
  check("...and no quotation row was written for that lead", psql(`select count(*) from quotations where lead_id='${lead2.id}'`) === "0");
  const manual = await A(`/api/leads/${lead2.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, totalCost: 1000, boqItems: boq }) });
  check(`the Manual BOQ quote on the same lead still works (${manual.status})`, manual.status < 300);
}

// the same paths ARE reachable by the founding company (control: the gate is the company, not the path)
{
  console.log("\nfounding company (control)");
  const probes = [["GET", "/api/admin/autosizer-presets"], ["GET", "/api/interactive-proposals"], ["GET", "/api/admin/deliveries/dashboard/summary"], ["GET", "/api/inbox/threads"], ["GET", `/api/leads/${L}/design-session`]];
  const refused = [];
  for (const [m, p] of probes) { const r = await F(p, { method: m }); const b = await json(r); if (b.code === "not_available") refused.push(`${m} ${p}`); }
  check("the founding administrator is never answered with not_available on the same module paths", refused.length === 0, refused.join(", "));
}

// what the interface is told (hidden controls), for a staff user and a portal customer
{
  const A = who["alpha administrator"].api, P = who["alpha portal customer"].api;
  const st = await json(await A("/api/state"));
  check("a pilot staff user's boot payload turns every unfinished module off", st.modules && st.modules.autoSizer === false && st.modules.afterSales === false && st.modules.designTools === false && st.modules.assistants === false, JSON.stringify(st.modules));
  const me = await json(await P("/api/customer-portal/me"));
  check("a pilot company's portal customer is told the same, and that this is not the founding company", me.modules && Object.values(me.modules).every((v) => v === false) && me.documentIdentity?.neutral === true, JSON.stringify({ modules: me.modules, id: me.documentIdentity }));
  const fst = await json(await F("/api/state"));
  check("the founding administrator's payload keeps every module on", fst.modules && Object.values(fst.modules).every((v) => v === true), JSON.stringify(fst.modules));
}

// the portal's company details: a customer sees their own company's public face and nothing else
{
  console.log("\nportal branding endpoint");
  const A = who["alpha administrator"].api;
  await A("/api/company/settings/branding", { method: "PUT", body: JSON.stringify({ companyName: "Alpha Portal Co", phoneNumbers: "021-5550000", terms: "SECRET-TERMS-TEXT", googleReviewUrl: "https://g.page/r/alpha-co" }) });
  const mine = await json(await who["alpha portal customer"].api("/api/customer-portal/branding"));
  const b = mine.branding || {};
  check("a portal customer gets their own company's name, phone and review link", b.companyName === "Alpha Portal Co" && b.phoneNumbers === "021-5550000" && b.googleReviewUrl === "https://g.page/r/alpha-co" && b.legacyDefaults === false, JSON.stringify(b).slice(0, 200));
  check("...and not the terms text, signature, invoice logo or bank-accounts image", !("terms" in b) && !("signatureUrl" in b) && !("invoiceLogoUrl" in b) && !("bankAccountsImageUrl" in b) && !JSON.stringify(mine).includes("SECRET-TERMS-TEXT"), JSON.stringify(Object.keys(b)));
  const theirs = await json(await who["beta portal customer"].api("/api/customer-portal/branding"));
  check("another company's portal customer gets that company's details, never alpha's", theirs.branding && theirs.branding.companyName !== "Alpha Portal Co" && !JSON.stringify(theirs).includes("021-5550000") && !JSON.stringify(theirs).includes("alpha-co"), JSON.stringify(theirs).slice(0, 200));
  const staff = await A("/api/customer-portal/branding");
  const anon = await fetch(`${BASE}/api/customer-portal/branding`);
  check(`staff are not served the customer endpoint (${staff.status}) and an unauthenticated call is refused (${anon.status})`, staff.status === 403 && anon.status === 401);
}

console.log(`\n${calls} calls made as pilot users`);
console.log(`${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
