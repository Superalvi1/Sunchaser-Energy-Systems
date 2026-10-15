// Concurrent contracting: many leads of TWO SYNTHETIC companies are contracted at the same moment (each contract provisions a customer and an invoice).
// Evidence for the intermittent "restore journey fails while filling the companies" finding: every row id the contract path generated from the clock
// (inv-<ms>, item-<ms>-<n>, cust-inv-<ms>) collides when two requests build one in the same millisecond, and the second request fails with a duplicate-key
// error. With unique ids every contract must succeed and every invoice must exist exactly once.
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW.   Seed first: seed-two-companies.mjs
import "./lib/fresh-connections.mjs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and E2E_PSQL and point E2E_BASE_URL at a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 500) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const login = async (u) => json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const caller = (t) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(init.headers || {}) } });
const RUN = randomBytes(3).toString("hex");
const COS = [{ id: "co_alpha", user: "alpha_admin" }, { id: "co_beta", user: "beta_admin" }];
for (const c of COS) c.api = caller((await login(c.user)).token);

const ROUNDS = Number(process.env.ROUNDS || 12), PER_COMPANY = Number(process.env.PER_COMPANY || 3);
// 1. leads with a quotation each (sequentially: this part is not under test)
const jobs = [];
for (let r = 0; r < ROUNDS; r++) for (const c of COS) for (let k = 0; k < PER_COMPANY; k++) {
  const lead = await json(await c.api("/api/leads", { method: "POST", body: JSON.stringify({ name: `Concurrent ${c.id} ${r}-${k} ${RUN}`, email: `cc${r}${k}${RUN}${c.id}@example.test`, phone: "0317" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral" }) }));
  const boq = [{ type: "item", name: "PANEL", description: "panel", qty: 2, unit: "pcs", rate: 1000, total: 2000 }];
  await c.api(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: 2, panelType: "Synthetic", inverterType: "Synthetic", batteryCapacity: "None", totalCost: 2000, boqItems: boq }) });
  jobs.push({ c, lead, round: r });
}
check(`${jobs.length} leads with a quotation exist (${ROUNDS} rounds x 2 companies x ${PER_COMPANY})`, jobs.every((j) => j.lead.id));

// 2. contract them in rounds, all of one round at the same instant
const results = [];
for (let r = 0; r < ROUNDS; r++) {
  const batch = jobs.filter((j) => j.round === r);
  const out = await Promise.all(batch.map(async (j) => { const res = await j.c.api(`/api/leads/${j.lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) }); const b = await json(res); return { j, status: res.status, body: b }; }));
  results.push(...out);
}
const failed = results.filter((x) => x.status >= 300 || !x.body.contractProvision?.invoiceId);
for (const f of failed.slice(0, 5)) console.log("   CONTRACT-FAILURE-RECORD " + JSON.stringify({ company: f.j.c.id, status: f.status, body: JSON.stringify(f.body).slice(0, 300) }));
check(`all ${results.length} simultaneous contracts succeed and each provisions an invoice (${failed.length} failed)`, failed.length === 0, failed.slice(0, 3).map((f) => `${f.status} ${JSON.stringify(f.body).slice(0, 160)}`).join(" | "));
const ids = results.map((x) => x.body.contractProvision?.invoiceId).filter(Boolean);
check("every invoice id is unique", new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} repeated`);
const inDb = Number(psql(`select count(*) from invoices where id in (${ids.map((i) => `'${i}'`).join(",") || "''"})`));
check(`every provisioned invoice exists exactly once in the database (${inDb} of ${ids.length})`, inDb === ids.length);
const lonely = psql(`select count(*) from invoices i where i.id in (${ids.map((i) => `'${i}'`).join(",") || "''"}) and not exists (select 1 from invoice_items x where x.invoice_id=i.id)`);
check("every invoice has its line items", lonely === "0", lonely);
const owners = psql(`select count(*) from invoices where id in (${ids.map((i) => `'${i}'`).join(",") || "''"}) and company_id not in ('co_alpha','co_beta')`);
check("every invoice belongs to the company that contracted it (no cross-company row)", owners === "0");
// 3. Rows that are written as a side effect of the contract and whose failure is NOT reported to the caller. Two such inserts (the activity-log row `log-<ms>` and the
//    project row `project-<ms>`) ignored the database's answer: a clash on the clock-built id dropped the row silently, with HTTP 200 and no log line. That is the
//    only explanation found for a restore run in which one company ended with one row fewer than the other and no check failed. Each contracted lead must have
//    exactly one "Contract-to-Invoice" activity-log row and exactly one project.
const leadIds = results.map((x) => x.j.lead.id).filter(Boolean);
const inList = leadIds.map((i) => `'${i}'`).join(",") || "''";
const logged = Number(psql(`select count(distinct l.id) from leads l where l.id in (${inList}) and exists (select 1 from activity_logs a where a.action='Contract-to-Invoice' and a.details like 'Lead ' || l.id || ' %')`));
check(`every contracted lead has its "Contract-to-Invoice" activity-log row (${logged} of ${leadIds.length})`, logged === leadIds.length, `${leadIds.length - logged} activity-log rows were silently lost`);
const withProject = Number(psql(`select count(distinct lead_id) from projects where lead_id in (${inList})`));
check(`every contracted lead has its project row (${withProject} of ${leadIds.length})`, withProject === leadIds.length, `${leadIds.length - withProject} project rows were silently lost`);
const custOfInv = `select distinct customer_id from invoices where id in (${ids.map((i) => `'${i}'`).join(",") || "''"})`;
const nCust = Number(psql(`select count(*) from (${custOfInv}) c`));
const withVault = Number(psql(`select count(distinct customer_id) from customer_documents where document_type='invoice' and customer_id in (${custOfInv})`));
check(`every invoice's customer has the invoice in their document vault (${withVault} of ${nCust}; the vault row used to be lost with only a warning when two ids met)`, withVault === nCust, `${nCust - withVault} vault rows lost`);
const dupProjects = psql(`select count(*) from (select lead_id from projects where lead_id in (${inList}) group by 1 having count(*)>1) x`);
check("no lead has two projects", dupProjects === "0", dupProjects);
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
