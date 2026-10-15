// Company isolation does not depend on the feature flag. SYNTHETIC companies, disposable stack. See server/saas/tenantIsolationGuard.ts.
// With pilot companies in the database, a process of this build that is NOT in multi-company mode (flag unset, no tenant key) must refuse to serve:
// every data route answers 503 `tenant_isolation_unavailable`, for founding-company users, pilot users and sessions that were issued before, and nothing is
// read or written. It must also pause when it cannot find out (database unreachable), keep pausing across a restart and across schema rollbacks that leave the
// companies table in place, and resume by itself once the other companies' data is gone. With the flag on, sessions issued before work as before, isolated.
//   Env: E2E_BASE_URL_ON, E2E_RUN_APP (script that starts the application: <port> <true|false> [KEY=VALUE..]), E2E_REPORT_DIR, E2E_S3_DIR, E2E_PSQL, TEST_PW,
//        PGHOST/PGPORT/PGUSER/PGDATABASE (+PGPASSWORD) for the migration runner. Optional E2E_REPAIR_BUNDLE: the repair build (PR #111), to MEASURE what an older backend does.   Seed first.
import "./lib/fresh-connections.mjs";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ON = process.env.E2E_BASE_URL_ON, PW = process.env.TEST_PW, RUN_APP = process.env.E2E_RUN_APP, LOGDIR = process.env.E2E_REPORT_DIR || ".", S3DIR = process.env.E2E_S3_DIR;
if (!ON || !PW || !RUN_APP || !S3DIR || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(ON)) { console.error("Set E2E_BASE_URL_ON, TEST_PW, E2E_RUN_APP, E2E_S3_DIR, E2E_PSQL."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-v", "ON_ERROR_STOP=1", "-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const runner = (...a) => { try { return execFileSync("node", ["scripts/migrations/run.mjs", ...a, "--yes"], { stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e) { throw new Error(`runner ${a.join(" ")} failed: ${String(e.stderr || e.stdout || e.message).split("\n").filter(Boolean).slice(0, 6).join(" | ")}`); } };
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 500) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const RUN = randomBytes(3).toString("hex").toUpperCase();
const X_PORT = Number(process.env.E2E_ISOLATION_PORT || 3190), X = `http://127.0.0.1:${X_PORT}`;
const pdf = (bytes, tag) => { const head = Buffer.from(`%PDF-1.4\n% ${tag}\n`), tail = Buffer.from("\n%%EOF\n"); return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length - tail.length), 0x20), tail]); };

// ---------------------------------------------------------------- processes this journey starts itself
const procs = new Set();
const startApp = async (port, multi, log, ...extra) => {
  const out = fs.openSync(path.join(LOGDIR, log), "w");
  const child = spawn("bash", [RUN_APP, String(port), multi ? "true" : "false", ...extra], { stdio: ["ignore", out, out], env: process.env });
  procs.add(child);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).status === 200) return child; } catch { /* not yet */ } await sleep(1000); }
  throw new Error(`the application on :${port} did not come up (see ${log})`);
};
const stopApp = async (child) => { child.kill("SIGTERM"); for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await sleep(500); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); procs.delete(child); };
process.on("exit", () => { for (const c of procs) { try { c.kill("SIGKILL"); } catch { /* gone */ } } });

// ---------------------------------------------------------------- helpers
const login = async (base, u) => json(await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const call = (base, token) => (p, init = {}) => fetch(base + p, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
const counts = () => psql(`select concat_ws(':', (select count(*) from leads), (select count(*) from invoices), (select count(*) from customers), (select count(*) from invoice_payments), (select count(*) from customer_documents), (select count(*) from activity_logs), (select count(*) from users), (select count(*) from projects))`);
const objectsFp = () => sha(fs.readdirSync(S3DIR).sort().map((f) => f + ":" + sha(fs.readFileSync(path.join(S3DIR, f)))).join("|"));
const PAUSED = (r, b) => r.status === 503 && b?.code === "tenant_isolation_unavailable";

// ================================================================ A. flag ON: sessions, data of two kinds of company
console.log("A. Multi-company mode ON: three sessions are issued and each company writes its data");
const F = await login(ON, "t_admin"), A = await login(ON, "alpha_admin"), P = await login(ON, "alpha_portal");
check("sessions issued by the flag-on process: a founding administrator, a pilot administrator, a pilot portal customer", Boolean(F.token && A.token && P.token), JSON.stringify([F.error, A.error, P.error]));
const fOn = call(ON, F.token), aOn = call(ON, A.token);
const mkInvoice = async (api, who) => json(await api("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: `isolation customer ${who} ${RUN}`, customerPhone: "03000000000", items: [{ itemName: "item", description: "item", qty: 1, unit: "pcs", rate: 100000, taxPercent: 0, discountAmount: 0 }] }) }));
const lead = async (api, name) => json(await api("/api/leads", { method: "POST", body: JSON.stringify({ name, email: `${name.replace(/\W/g, "").toLowerCase()}@example.test`, phone: "03" + Math.floor(100000000 + Math.random() * 899999999), leadSource: "Direct/Referral" }) }));
const ALPHA_LEAD = `PILOTLEAD ${RUN}`, FOUND_LEAD = `FOUNDLEAD ${RUN}`;
const aLead = await lead(aOn, ALPHA_LEAD), fLead = await lead(fOn, FOUND_LEAD);
const aInv = await mkInvoice(aOn, "alpha"), fInv = await mkInvoice(fOn, "founding");
const aDoc = await (await aOn("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId: aInv.invoice?.customerId, documentType: "other", title: `alphadoc ${RUN}`, fileName: "alphadoc.pdf", mimeType: "application/pdf", base64Data: pdf(3000, "alphadoc").toString("base64") }) })).json();
const fDoc = await (await fOn("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId: fInv.invoice?.customerId, documentType: "other", title: `founddoc ${RUN}`, fileName: "founddoc.pdf", mimeType: "application/pdf", base64Data: pdf(3000, "founddoc").toString("base64") }) })).json();
check("each company created a lead, an invoice and an uploaded file", Boolean(aLead.id && fLead.id && aInv.invoice?.id && fInv.invoice?.id && aDoc.id && fDoc.id), JSON.stringify([aLead.id, fLead.id, aInv.invoice?.id, fInv.invoice?.id, aDoc.id, fDoc.id]));
const aList = await json(await aOn(`/api/admin/customer-documents/${aInv.invoice?.customerId}`)), fList = await json(await fOn(`/api/admin/customer-documents/${fInv.invoice?.customerId}`));
const aFileUrl = (aList.documents || []).find((d) => d.id === aDoc.id)?.fileUrl, fFileUrl = (fList.documents || []).find((d) => d.id === fDoc.id)?.fileUrl;
check("the files download through the flag-on process (signed link) and the other company's session cannot read them", Boolean(aFileUrl && fFileUrl) && (await fetch(new URL(aFileUrl, ON))).status === 200 && (await fetch(new URL(fFileUrl, ON))).status === 200);
const aState = await json(await aOn("/api/state")), fState = await json(await fOn("/api/state"));
check("flag ON baseline: the pilot administrator sees its lead and not the founding lead; the founding administrator the reverse", (aState.leads || []).some((l) => l.name === ALPHA_LEAD) && !(aState.leads || []).some((l) => l.name === FOUND_LEAD) && (fState.leads || []).some((l) => l.name === FOUND_LEAD) && !(fState.leads || []).some((l) => l.name === ALPHA_LEAD));
const CANARIES = [ALPHA_LEAD, FOUND_LEAD, `isolation customer alpha ${RUN}`, `isolation customer founding ${RUN}`, "alphadoc", "founddoc"];

// ================================================================ B. the same build, flag OFF, pilot data present
console.log("\nB. A process of this build with the flag OFF (no tenant key) on the same database");
const rows0 = counts(), obj0 = objectsFp();
let x = await startApp(X_PORT, false, "isolation-flagoff-1.log");
const h = await json(await fetch(`${X}/health`));
check("it starts and answers /health, reporting that serving is paused", h.status === "ok" && h.tenantIsolation?.paused === true && h.tenantIsolation?.reason === "tenant_data_present", JSON.stringify(h));
const ms = await json(await fetch(`${X}/api/maintenance-status`));
check("/api/maintenance-status says paused, tenant_data_present", ms.paused === true && ms.reason === "tenant_data_present", JSON.stringify(ms));
check("the log says why, in plain words", /SERVING PAUSED|Serving is PAUSED/.test(fs.readFileSync(path.join(LOGDIR, "isolation-flagoff-1.log"), "utf8")));
check("the static app shell is still delivered (it holds no company data)", (await fetch(`${X}/`)).status === 200);

const HOLDERS = { "founding administrator (session issued earlier)": F.token, "pilot administrator (session issued earlier)": A.token, "pilot portal customer (session issued earlier)": P.token, "no session": null };
const PDF_ID = aInv.invoice?.id, F_PDF_ID = fInv.invoice?.id;
const REQUESTS = [
  ["read: state", "GET", "/api/state"], ["read: leads", "GET", "/api/leads"], ["read: invoice of the pilot company", "GET", `/api/admin/invoices/${PDF_ID}`], ["read: invoice of the founding company", "GET", `/api/admin/invoices/${F_PDF_ID}`],
  ["read: customer documents", "GET", `/api/admin/customer-documents/${aInv.invoice?.customerId}`], ["read: finance dashboard", "GET", "/api/admin/finance/dashboard"],
  ["read: portal data", "GET", "/api/customer-portal/me"], ["read: portal documents", "GET", "/api/customer-portal/documents/me"],
  ["search: leads", "GET", `/api/leads?search=${encodeURIComponent("PILOTLEAD")}`], ["search: invoices", "GET", `/api/admin/invoices?search=${encodeURIComponent(`isolation customer`)}`], ["search: customers", "GET", `/api/customers/search?q=isolation`],
  ["export: leads", "GET", "/api/export/leads"], ["export: invoices", "GET", "/api/export/invoices"], ["export: customers", "GET", "/api/export/customers"], ["export: documents", "GET", "/api/export/customer_documents"], ["export: whole-database backup", "GET", "/api/backup/export"],
  ["pdf: pilot invoice", "GET", `/api/export/pdf/invoice/${PDF_ID}`], ["pdf: founding invoice", "GET", `/api/export/pdf/invoice/${F_PDF_ID}`], ["pdf: quotation of a lead", "GET", `/api/export/pdf/manual-quote/${aLead.id}`],
  ["file: pilot document, signed link", "GET", aFileUrl], ["file: founding document, signed link", "GET", fFileUrl], ["file: authorised access route", "GET", `/api/company/files/customer-documents/${encodeURIComponent("x")}`], ["file: /uploads", "GET", "/uploads/anything.pdf"],
  ["write: create lead", "POST", "/api/leads", { name: `WRITEPROBE ${RUN}`, email: `wp${RUN}@example.test`, phone: "0300" + Math.floor(1000000 + Math.random() * 8999999), leadSource: "Direct/Referral" }],
  ["write: update lead", "PUT", `/api/leads/${aLead.id}`, { status: "Contacted" }], ["write: delete lead", "DELETE", `/api/leads/${fLead.id}`],
  ["write: create invoice", "POST", "/api/admin/invoices", { customerName: `WRITEPROBE ${RUN}`, customerPhone: "03000000000", items: [{ itemName: "i", description: "i", qty: 1, unit: "pcs", rate: 1, taxPercent: 0, discountAmount: 0 }] }],
  ["write: payment", "POST", `/api/admin/invoices/${PDF_ID}/payments`, { amount: 1, paymentMethod: "Cash", paymentDate: new Date().toISOString().slice(0, 10), clientRequestId: `iso-${RUN}` }],
  ["write: upload a file", "POST", "/api/admin/customer-documents/upload", { customerId: aInv.invoice?.customerId, documentType: "other", title: `WRITEPROBE ${RUN}`, fileName: "w.pdf", mimeType: "application/pdf", base64Data: pdf(2000, "w").toString("base64") }],
];
let swept = 0, sweptBad = [];
for (const [who, token] of Object.entries(HOLDERS)) {
  const api = call(X, token);
  for (const [label, method, p, body] of REQUESTS) {
    if (!p) continue;
    const r = await api(p, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text(); let b = {}; try { b = JSON.parse(text); } catch { /* not json */ }
    const leaked = CANARIES.filter((c) => text.includes(c));
    swept++;
    if (!PAUSED(r, b) || leaked.length) sweptBad.push(`${who} / ${label}: ${r.status} ${text.slice(0, 80)}${leaked.length ? " LEAKED " + leaked : ""}`);
  }
}
check(`${swept} requests (reads, searches, exports incl. the whole-database backup, PDFs, file downloads, writes) by 4 kinds of caller: every one answered 503 tenant_isolation_unavailable and none contained any company's data`, sweptBad.length === 0, sweptBad.slice(0, 4).join(" || "));
for (const u of ["t_admin", "alpha_admin", "alpha_portal"]) {
  const r = await fetch(`${X}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) });
  const b = await json(r);
  check(`sign-in of ${u} on the paused process is refused with the maintenance error (no token issued)`, PAUSED(r, b) && !b.token, JSON.stringify(b).slice(0, 120));
}
{ const r = await fetch(`${X}/api/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); const b = await json(r); check("the public WhatsApp webhook is paused too (the sender retries)", PAUSED(r, b), String(r.status)); }
await sleep(7000);   // a background interval (sales agent, backup) would have acted by now
check("NOTHING was read or written: row counts of leads, invoices, customers, payments, documents, activity log, users and projects are identical, and so is every stored object", counts() === rows0 && objectsFp() === obj0, `${rows0} -> ${counts()}`);
check("no write probe exists in the database", psql(`select count(*) from leads where name like 'WRITEPROBE%'`) === "0" && psql(`select count(*) from invoices where customer_name like 'WRITEPROBE%'`) === "0");

// ================================================================ C. restart, still flag OFF
console.log("\nC. Restart of the flag-off process");
await stopApp(x); x = await startApp(X_PORT, false, "isolation-flagoff-2.log");
{
  const r = await call(X, F.token)("/api/state"), b = await json(r);
  const r2 = await call(X, A.token)("/api/leads"), b2 = await json(r2);
  check("after the restart the earlier founding and pilot sessions are still refused with the maintenance error, not served", PAUSED(r, b) && PAUSED(r2, b2), `${r.status} ${r2.status}`);
  check("the restarted process reports paused at /health", (await json(await fetch(`${X}/health`))).tenantIsolation?.paused === true);
}

// ================================================================ D. flag ON again, sessions issued earlier
console.log("\nD. Back to multi-company mode: sessions issued before still work, each company sees only its own");
{
  const s1 = await json(await fOn("/api/state")), s2 = await json(await aOn("/api/state"));
  check("founding session (issued before the pause): sees its lead, not the pilot's", (s1.leads || []).some((l) => l.name === FOUND_LEAD) && !(s1.leads || []).some((l) => l.name === ALPHA_LEAD));
  check("pilot session (issued before the pause): sees its lead, not the founding company's", (s2.leads || []).some((l) => l.name === ALPHA_LEAD) && !(s2.leads || []).some((l) => l.name === FOUND_LEAD));
  const w = await aOn("/api/leads", { method: "POST", body: JSON.stringify({ name: `AFTER ${RUN}`, email: `af${RUN}@example.test`, phone: "0311" + Math.floor(1000000 + Math.random() * 8999999), leadSource: "Direct/Referral" }) });
  check("writes work again and land in the right company", w.status < 300 && psql(`select company_id from leads where name='AFTER ${RUN}'`) === "co_alpha");
  const pdfr = await aOn(`/api/export/pdf/invoice/${PDF_ID}`), file = await fetch(new URL(aFileUrl, ON));
  check("a PDF and a file download work again", pdfr.status === 200 && file.status === 200);
  const cross = await aOn(`/api/admin/invoices/${F_PDF_ID}`);
  check("cross-company read is still refused with the flag on", cross.status === 404 || cross.status === 403, String(cross.status));
}

// ================================================================ E. cannot verify => paused (never an unfiltered fallback)
console.log("\nE. A flag-off process that cannot reach the database");
{
  const y = await startApp(X_PORT + 1, false, "isolation-unverified.log", "RAILWAY_POSTGREST_URL=http://127.0.0.1:1");
  const base = `http://127.0.0.1:${X_PORT + 1}`;
  const hh = await json(await fetch(`${base}/health`)), r = await call(base, F.token)("/api/state"), b = await json(r);
  check("it reports paused / unverified and every data route answers 503 (no local-file fallback, no data)", hh.tenantIsolation?.paused === true && hh.tenantIsolation?.reason === "unverified" && PAUSED(r, b), JSON.stringify([hh, r.status, b]).slice(0, 300));
  await stopApp(y);
}

// ================================================================ G. schema rollback states with pilot data present
console.log("\nG. Schema rollback while pilot companies exist: t8..t2 rolled back; t1 and t1b (the companies table and the barrier) stay");
const reload = async () => { psql("notify pgrst, 'reload schema'"); await sleep(3500); };
try {
  runner("rollback", "--to", "t2-ownership"); await reload();
  const tables = psql(`select to_regclass('public.companies') is not null and to_regprocedure('app.saas_pre_request()') is not null`);
  const z = await startApp(X_PORT, false, "isolation-after-rollback.log");
  const r = await call(X, F.token)("/api/state"), b = await json(r), hz = await json(await fetch(`${X}/health`));
  check("after rolling back t8..t2 (companies table and barrier present) the flag-off process is still paused and serves nothing", tables === "t" && PAUSED(r, b) && hz.tenantIsolation?.reason === "tenant_data_present", JSON.stringify([tables, r.status, hz]).slice(0, 300));
  await stopApp(z);
  let refused = "";
  try { runner("rollback", "--to", "t1b-tenancy-barrier"); } catch (e) { refused = String(e); }
  check("rolling back t1b (the barrier) is REFUSED while the marker is on or any pilot company exists", /Rollback refused/i.test(refused), refused.slice(0, 240));
  let refused1 = "";
  try { runner("rollback", "--to", "t1-company-foundation"); } catch (e) { refused1 = String(e); }
  check("rolling back t1 (which would remove the companies table) is refused too", /Rollback refused/i.test(refused1), refused1.slice(0, 240));
  check("both are still applied afterwards", psql(`select to_regprocedure('app.saas_pre_request()') is not null and to_regclass('public.companies') is not null`) === "t");
  await reload();
} finally {
  try { runner("apply"); await reload(); } catch (e) { console.log("could not re-apply in cleanup: " + String(e).slice(0, 200)); }
}

// ================================================================ H. processes that do NOT know about companies: the DATABASE refuses them
console.log("\nH. Older backends, scripts and flag-off processes: refused by the database itself");
{
  const pr = process.env.E2E_POSTGREST_URL, sk = process.env.E2E_SERVICE_KEY;
  if (pr && sk) {
    const raw = async (path, mode) => { const r = await fetch(pr + path, { headers: { apikey: sk, authorization: `Bearer ${sk}`, ...(mode ? { "x-isolation-mode": mode } : {}) } }); const t = await r.text(); return { status: r.status, text: t }; };
    const TABLES = ["leads", "invoices", "customers", "users", "customer_documents", "activity_logs", "invoice_payments", "projects", "quotations"];
    let bad = [];
    for (const t of TABLES) for (const mode of [undefined, "single", "global-only"]) { const r = await raw(`/${t}?limit=5`, mode); if (r.status !== 503 || CANARIES.some((c) => r.text.includes(c))) bad.push(`${t}/${mode || "none"}: ${r.status}`); }
    check(`${TABLES.length * 3} direct requests with the SERVICE key and no header / header single / header global-only (an older backend, a script, a flag-off process) all answered 503 by the database; no body held company data`, bad.length === 0, bad.slice(0, 3).join("; "));
    const okMulti = await raw("/leads?limit=1", "multi");
    check("the same key with the multi-company declaration is served (the barrier is not a blanket refusal)", okMulti.status === 200, String(okMulti.status));
    const st = await raw("/rpc/saas_isolation_status", undefined);
    check("the status question is answered even with no header (so every process can find out)", st.status === 200 || st.status === 405, String(st.status));
  } else console.log("SKIP: E2E_POSTGREST_URL / E2E_SERVICE_KEY not set");
  if (process.env.E2E_REPAIR_BUNDLE && fs.existsSync(process.env.E2E_REPAIR_BUNDLE)) {
    const old = await startApp(X_PORT + 2, false, "isolation-older-backend.log", `APP_BUNDLE=${process.env.E2E_REPAIR_BUNDLE}`);
    const base = `http://127.0.0.1:${X_PORT + 2}`;
    const fl = await login(base, "t_admin");
    let seen = false, statuses = [];
    if (fl.token) for (const p of ["/api/state", "/api/leads", `/api/admin/invoices/${PDF_ID}`]) { const r = await call(base, fl.token)(p); const t = await r.text(); statuses.push(r.status); if (CANARIES.some((c) => t.includes(c))) seen = true; }
    console.log(`OBSERVED: the repair build (no isolation code) against this tenant-populated database: sign-in ${fl.token ? "succeeded" : "was refused"}, statuses ${statuses.join(",") || "-"}, pilot or founding data seen: ${seen}`);
    check("the REPAIR build (an older backend with no isolation code) cannot read or write any company data here: the database refuses it", seen === false && !statuses.includes(200), JSON.stringify({ token: Boolean(fl.token), statuses }));
    await stopApp(old);
  } else console.log("SKIP: E2E_REPAIR_BUNDLE not set (the repair build is not available here)");
}

// ================================================================ F. deleting a companies row clears nothing; only the explicit procedure does
console.log("\nF. The companies rows are deleted by hand: access stays closed. Data removed: still closed until the marker is cleared deliberately");
{
  const z = await startApp(X_PORT, false, "isolation-recovery.log");
  check("(before) paused", (await json(await fetch(`${X}/health`))).tenantIsolation?.paused === true);
  // someone deletes the companies rows by hand (foreign keys bypassed) while the tenant rows are still there
  psql(`set session_replication_role = replica; delete from companies where id <> 'sunchaser'; set session_replication_role = origin`);
  check("the companies rows are gone, the tenant rows are not", psql(`select count(*) from companies where id <> 'sunchaser'`) === "0" && Number(psql(`select count(*) from leads where company_id <> 'sunchaser'`)) > 0);
  await sleep(7000);   // longer than one check interval
  const hh = await json(await fetch(`${X}/health`)), r = await call(X, F.token)("/api/state"), b = await json(r);
  check("the running flag-off process STAYS paused (the persistent marker; the deep check also sees the orphaned rows)", hh.tenantIsolation?.paused === true && PAUSED(r, b), JSON.stringify(hh));
  const z2 = await startApp(X_PORT + 3, false, "isolation-restart-no-companies.log");
  const hz = await json(await fetch(`http://127.0.0.1:${X_PORT + 3}/health`));
  check("a freshly STARTED flag-off process is paused too (the restart reads the marker, not the companies table)", hz.tenantIsolation?.paused === true, JSON.stringify(hz));
  await stopApp(z2);
  const raw = await fetch(`${process.env.E2E_POSTGREST_URL}/leads?limit=1`, { headers: { apikey: process.env.E2E_SERVICE_KEY, authorization: `Bearer ${process.env.E2E_SERVICE_KEY}` } });
  check("an unaware service-role request is still refused by the database", raw.status === 503, String(raw.status));
  let dis = ""; try { psql("select app.tenancy_disable()"); } catch (e) { dis = String(e.stderr || e); }
  check("clearing the marker is refused while another company's rows exist", /tenancy_disable refused/.test(dis), dis.slice(0, 200));
  execFileSync("node", ["--import", "tsx", "scripts/saas/e2e/seed-two-companies.mjs", "--cleanup"], { stdio: "ignore" });
  await sleep(7000);
  const h3 = await json(await fetch(`${X}/health`));
  check("the other companies' data is removed, the marker is still on: the process STAYS paused (nothing resumes by itself)", h3.tenantIsolation?.paused === true && h3.tenantIsolation?.reason === "tenancy_marker", JSON.stringify(h3));
  check("clearing the marker with no other company and no other company's row succeeds", psql("select app.tenancy_disable()") === "single");
  let resumed = false; for (let i = 0; i < 20 && !resumed; i++) { await sleep(1000); resumed = (await json(await fetch(`${X}/health`))).tenantIsolation?.paused === false; }
  check("the same running process resumes serving without a restart", resumed);
  const r2 = await call(X, F.token)("/api/state"), b2 = await json(r2);
  check("the founding administrator's earlier session works again on the flag-off process and shows founding data only", r2.status === 200 && (b2.leads || []).some((l) => l.name === FOUND_LEAD) && !(b2.leads || []).some((l) => l.name === ALPHA_LEAD));
  const rp = await call(X, A.token)("/api/state");
  check("the removed pilot company's session no longer works", rp.status === 401 || rp.status === 403 || rp.status === 404, String(rp.status));
  let mk = ""; try { psql("insert into companies (id, slug, name, status) values ('co_late','co-late','Late','active')"); } catch (e) { mk = String(e.stderr || e); }
  check("and a new pilot company is refused again until the marker is switched on and the barrier verified", /refused: the tenancy marker/.test(mk), mk.slice(0, 200));
  await stopApp(z);
}

// ================================================================ W. no exposure window: a flag-off process is serving, then the marker is switched on
console.log("\nW. A flag-off process is SERVING (marker off). The marker is switched on. Its very next requests are refused: no waiting for its next check");
{
  const w = await startApp(X_PORT, false, "isolation-window.log");
  const FT = (await login(X, "t_admin")).token;
  const before = await call(X, FT)("/api/state");
  check("(before) the flag-off process serves the founding administrator", before.status === 200);
  psql("select app.tenancy_enable()");
  // no sleep: the process has not polled (its interval is 5 s). Fire requests for 3 s.
  const t0 = Date.now(); let served = 0, refusedN = 0, leaked = [];
  while (Date.now() - t0 < 3000) {
    for (const p of ["/api/state", "/api/leads", `/api/admin/invoices/${F_PDF_ID}`]) {
      const r = await call(X, FT)(p); const t = await r.text();
      if (r.status === 200) served++; else refusedN++;
      if (r.status === 200 && CANARIES.some((c) => t.includes(c))) leaked.push(p);
    }
  }
  check(`in the first 3 seconds after the marker was switched on (before any check of the process): ${refusedN} requests refused, ${served} served, 0 with data`, refusedN > 0 && served === 0 && leaked.length === 0, JSON.stringify({ served, refusedN, leaked }));
  await sleep(6000);
  const hw = await json(await fetch(`${X}/health`));
  check("and then the process itself reports paused (the marker)", hw.tenantIsolation?.paused === true && hw.tenantIsolation?.reason === "tenancy_marker", JSON.stringify(hw));
  check("the marker was cleared again by the explicit procedure for the next journey", psql("select app.tenancy_disable()") === "single");
  await stopApp(w);
}
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
