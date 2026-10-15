// Real-browser (Chromium) AND API check of two pilot rules, against a running MULTI_COMPANY_ENABLED server that serves the built SPA (build with an EMPTY
// VITE_API_BASE_URL) on a disposable stack with a fault-injectable object-store stand-in. SYNTHETIC data. Screenshots go to OUT_DIR.
//   A  storage limit, as a pilot administrator experiences it: uploading a client document through the real uploader
//        A1 at the limit: the upload is refused with the plain-language message, nothing is stored, the earlier file is still listed and downloads
//        A2 the store cannot be checked (listing down): a retryable message, nothing is stored; after the store recovers the Retry button saves the file once
//        A3 the same two situations asked of the API directly, with the codes, headers and retryable flags the screen relies on
//   B  the per-lead design tools (interactive proposal link, Roof Studio, Proposal Studio, sizing wizard) for the SAME lead and quotation:
//        B1 a pilot administrator and a pilot sales user open the lead's client workspace and its Proposals tab: no interactive-link button, no Roof Studio,
//           no sizing tab; and the page never CALLS a design-tool endpoint while they do
//        B2 the founding company's sales user, on the same build, DOES have the interactive-link button, the sizing tab and Roof Studio (so the absence above is
//           not an artefact of a build that never showed them)
//        B3 the design-tool endpoints for that very lead and quotation answer 404 not_available to a pilot administrator, a pilot sales user and a pilot
//           portal customer, and do not to the founding company
//   Env: E2E_BASE_URL, E2E_PSQL, E2E_S3_DIR (the stand-in's objects directory; "fault" is read from its parent), TEST_PW, PLAYWRIGHT_BROWSERS_PATH.
//        The server must run with STORAGE_USAGE_CACHE_MS / STORAGE_LIMIT_CACHE_MS shortened (the runner does).  Seed first: seed-two-companies.mjs
import "./lib/fresh-connections.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW, OUT = process.env.OUT_DIR || "docs/saas/evidence/round5/screens", S3DIR = process.env.E2E_S3_DIR;
if (!PW || !S3DIR || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW, E2E_S3_DIR, E2E_PSQL and a local E2E_BASE_URL."); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const FAULT = path.join(S3DIR, "..", "fault");
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 500) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024, RUN = Date.now().toString(36).toUpperCase(), CACHE_WAIT = Number(process.env.STORAGE_TEST_WAIT_MS || 3500);
const setFault = (mode) => (mode ? fs.writeFileSync(FAULT, mode + "\n") : fs.rmSync(FAULT, { force: true }));
process.on("exit", () => setFault(null));
const objs = (co) => fs.readdirSync(S3DIR).filter((f) => decodeURIComponent(f).includes(`/c/${co}/`));
const usedBytes = (co) => objs(co).reduce((n, f) => n + fs.statSync(path.join(S3DIR, f)).size, 0);
const pdf = (bytes, tag) => { const head = Buffer.from(`%PDF-1.4\n% ${tag}\n`), tail = Buffer.from("\n%%EOF\n"); return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length - tail.length), 0x20), tail]); };

const login = async (u) => json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const api = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) } });
const tokens = {}; for (const u of ["alpha_admin", "alpha_sales", "alpha_portal", "platform_op", "t_admin", "t_sales"]) tokens[u] = (await login(u)).token;
const A = api(tokens.alpha_admin), OP = api(tokens.platform_op), FA = api(tokens.t_admin);
check("the users sign in: alpha administrator, sales, portal customer, the operator, and the founding administrator and sales user", Object.values(tokens).every(Boolean));
const setLimit = (mb) => OP(`/api/platform/companies/co_alpha`, { method: "PATCH", body: JSON.stringify({ limitOverrides: { max_storage_mb: mb } }) });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const fresh = async () => { const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(20000); return { ctx, page }; };
async function signIn(page, user) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("button:visible", { hasText: "Client/Staff Sign In" }).first().click();
  await page.getByPlaceholder("username").fill(user);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
}
const labels = async (page) => (await page.locator("button:visible").evaluateAll((els) => els.map((e) => `${(e.innerText || "").replace(/\s+/g, " ").trim()} ${e.getAttribute("aria-label") || ""} ${e.getAttribute("title") || ""}`.trim()))).filter(Boolean);
const bodyText = (page) => page.locator("body").innerText();
const newLead = async (apiFn, name, extra = {}) => {
  const lead = await json(await apiFn("/api/leads", { method: "POST", body: JSON.stringify({ name, email: `r5${RUN}${Math.floor(Math.random() * 1e6)}@example.test`, phone: "0317" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral", ...extra }) }));
  const q = await apiFn(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: 2, panelType: "Synthetic", inverterType: "Synthetic", batteryCapacity: "None", totalCost: 2000, boqItems: [{ type: "item", name: "PANEL", description: "panel", qty: 2, unit: "pcs", rate: 1000, total: 2000 }] }) });
  const qb = await json(q);
  return { ...lead, quoteStatus: q.status, quoteId: qb.quote?.id || qb.id || qb.quoteId || (qb.quotes || []).slice(-1)[0]?.id };
};
// open a lead's client workspace from the lead list ("CRM Database" for an administrator, "My CRM Leads" for a sales user)
async function openWorkspace(page, tabRe, name) {
  await page.locator("button:visible", { hasText: tabRe }).first().click();
  await page.waitForTimeout(1500);
  await page.getByText(name, { exact: false }).first().click();
  await page.waitForTimeout(1200);
  await page.locator("button:visible", { hasText: "View saved proposals" }).first().click();
  await page.locator("button:visible", { hasText: /^Documents$/ }).first().waitFor();
}
const tab = async (page, name) => { await page.locator("button:visible", { hasText: new RegExp(`^${name}$`) }).first().click(); await page.waitForTimeout(1800); };

// ================================================================ A. storage limit as the administrator sees it
console.log("\nA. storage limit in the browser");
const adminLead = await newLead(A, `R5 Storage ${RUN}`);
check("setup: a lead with a customer profile exists for the administrator's document upload", Boolean(adminLead.id), JSON.stringify(adminLead).slice(0, 200));
const customerId = psql(`select coalesce(customer_id,'') from leads where id='${adminLead.id}'`);
{
  // an earlier file (via the API) that must stay listed and downloadable, and exactly 100 KB of room under a 1 MB limit
  const used = usedBytes("co_alpha");
  const L = Math.max(1, Math.ceil((used + 200_000) / MB));
  const FILE_KB = 300;
  const keep = Math.max(1000, L * MB - used - 100 * 1024);
  await setLimit(L + 50); await sleep(CACHE_WAIT);
  const first = await json(await A("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId, documentType: "other", title: `R5 earlier file ${RUN}`, fileName: `r5-earlier-${RUN}.pdf`, mimeType: "application/pdf", base64Data: pdf(keep, "earlier").toString("base64") }) }));
  check("setup: an earlier document is stored for the customer", Boolean(first.id), JSON.stringify(first).slice(0, 200));
  await setLimit(L); await sleep(CACHE_WAIT);
  const room = L * MB - usedBytes("co_alpha");
  check(`setup: the limit is ${L} MB and the company has ${(room / 1024).toFixed(0)} KB of room, less than the ${FILE_KB} KB file the browser will upload`, room < FILE_KB * 1024 && room > 0, `${room}`);

  const { ctx, page } = await fresh();
  const calls = [];
  page.on("response", (r) => { if (/customer-documents\/upload/.test(r.url())) calls.push(r.status()); });
  await signIn(page, "alpha_admin");
  await openWorkspace(page, /CRM Database/, adminLead.name);
  await tab(page, "Documents");
  const upload = (name, kb) => page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "application/pdf", buffer: pdf(kb * 1024, name) });
  const before = objs("co_alpha").length, docsBefore = Number(psql(`select count(*) from customer_documents where customer_id='${customerId}'`));

  // A1 at the limit
  await upload(`r5-full-${RUN}.pdf`, FILE_KB);
  await page.getByRole("alert").first().waitFor();
  let t = await bodyText(page);
  check("A1 at the limit: the screen shows the plain-language refusal (the plan allows N MB; existing files are safe)", /Your plan allows \d+ MB of stored files/i.test(t) && /existing files are safe/i.test(t) && /raise the limit|delete files/i.test(t), t.slice(-600));
  check("A1 ...and not a success message; the server answered 402", !/uploaded successfully/i.test(t) && calls.includes(402), `${calls}`);
  check("A1 ...nothing was stored: no new object, no new document row", objs("co_alpha").length === before && Number(psql(`select count(*) from customer_documents where customer_id='${customerId}'`)) === docsBefore);
  await page.getByRole("alert").first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/r5-01-upload-at-limit.png` });
  // the earlier file is still listed and downloads
  await page.locator("button:visible", { hasText: "Refresh files" }).first().click(); await page.waitForTimeout(1500);
  t = await bodyText(page);
  const link = await page.locator("a", { hasText: "Open / download file" }).first().getAttribute("href");
  const dl = link ? await fetch(link.startsWith("http") ? link : BASE + link) : { status: 0 };
  const dlBody = link ? Buffer.from(await dl.arrayBuffer()) : Buffer.alloc(0);
  check(`A1 ...the earlier file is still listed and an authorised download still works while the company is at its limit (${dl.status})`, t.includes(`R5 earlier file ${RUN}`) && dl.status === 200 && dlBody.subarray(0, 5).toString() === "%PDF-");

  // A2 the store cannot be checked
  await setLimit(L + 50); await sleep(CACHE_WAIT);
  setFault("list"); await sleep(CACHE_WAIT);
  calls.length = 0;
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(3000);
  await openWorkspace(page, /CRM Database/, adminLead.name); await tab(page, "Documents");
  const objA2 = objs("co_alpha").length;
  await upload(`r5-retry-${RUN}.pdf`, 60);
  await page.getByRole("alert").first().waitFor();
  t = await bodyText(page);
  check("A2 store unreachable: the screen says usage could not be checked, nothing was lost, existing files are unaffected, try again in a minute", /could not check your storage usage/i.test(t) && /nothing was lost/i.test(t) && /try the upload again/i.test(t), t.slice(-500));
  check("A2 ...the server answered 503, no object was written, and the screen offers Retry upload", calls.includes(503) && objs("co_alpha").length === objA2 && (await page.locator("button:visible", { hasText: "Retry upload" }).count()) === 1, `${calls}`);
  await page.getByRole("alert").first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/r5-02-upload-store-unreachable.png` });
  setFault(null); await sleep(CACHE_WAIT);
  await page.locator("button:visible", { hasText: "Retry upload" }).first().click();
  await page.getByText(/uploaded successfully/i).first().waitFor();
  await page.locator("button:visible", { hasText: "Refresh files" }).first().click(); await page.waitForTimeout(1500);
  const saved = Number(psql(`select count(*) from customer_documents where customer_id='${customerId}' and file_name='r5-retry-${RUN}.pdf'`));
  check("A2 after the store recovers, Retry upload saves the file exactly once (one object, one row, listed on screen)", saved === 1 && objs("co_alpha").length === objA2 + 1 && (await bodyText(page)).includes(`r5-retry-${RUN}.pdf`), `rows ${saved}`);
  await page.getByText(/uploaded successfully/i).first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/r5-03-upload-after-retry.png` });
  await ctx.close();

  // A3 the API directly: the contract the screen relies on
  await setLimit(L); await sleep(CACHE_WAIT);
  const roomNow = L * MB - usedBytes("co_alpha");
  const big = await A("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId, documentType: "other", title: "api over", fileName: "over.pdf", mimeType: "application/pdf", base64Data: pdf(Math.max(roomNow + 4096, 120_000), "over").toString("base64") }) });
  const bb = await json(big);
  check(`A3 API over the limit: 402 storage_limit_exceeded, retryable false, limitMb ${L}`, big.status === 402 && bb.code === "storage_limit_exceeded" && bb.retryable === false && bb.limitMb === L, JSON.stringify(bb).slice(0, 200));
  await setLimit(L + 50); await sleep(CACHE_WAIT); setFault("list"); await sleep(CACHE_WAIT);
  const down = await A("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId, documentType: "other", title: "api down", fileName: "down.pdf", mimeType: "application/pdf", base64Data: pdf(5000, "down").toString("base64") }) });
  const db = await json(down);
  check("A3 API with the store unreachable: 503 storage_unverified, retryable true, Retry-After", down.status === 503 && db.code === "storage_unverified" && db.retryable === true && Number(down.headers.get("retry-after")) > 0, `${down.status} ${JSON.stringify(db).slice(0, 160)}`);
  setFault(null);
}

// ================================================================ B. per-lead design tools
console.log("\nB. per-lead design tools (interactive proposal link, Roof Studio, sizing)");
const DESIGN = /^\/api\/(interactive-proposals|leads\/[^/]+\/design-session|export\/pdf\/design-studio-proposal|ai|gemini)(\/|$)/;
const adminLead2 = await newLead(A, `R5 Design admin ${RUN}`);
const salesLead = await newLead(A, `R5 Design sales ${RUN}`);
await A(`/api/leads/${salesLead.id}/assign`, { method: "PUT", body: JSON.stringify({ salespersonName: "Alpha Sales" }) });
const foundLead = await newLead(FA, `R5 Design founding ${RUN}`);
await FA(`/api/leads/${foundLead.id}/assign`, { method: "PUT", body: JSON.stringify({ salespersonName: "Test Sales Exec" }) });
check("setup: a lead with a saved quotation exists for the pilot administrator, the pilot sales user and the founding sales user", [adminLead2, salesLead, foundLead].every((l) => l.id && l.quoteStatus === 200), JSON.stringify([adminLead2, salesLead, foundLead].map((l) => [l.id, l.quoteStatus])));

async function inspect(user, tabRe, lead, label) {
  const { ctx, page } = await fresh();
  const calledDesign = [];
  page.on("request", (rq) => { try { if (DESIGN.test(new URL(rq.url()).pathname)) calledDesign.push(new URL(rq.url()).pathname); } catch { /* not a URL */ } });
  await signIn(page, user);
  const firstScreen = await labels(page);
  await openWorkspace(page, tabRe, lead.name);
  await tab(page, "Proposals");
  const proposals = await labels(page), text = await bodyText(page);
  await page.screenshot({ path: `${OUT}/r5-${label}-proposals.png` });
  // the quotation workspace of a sales user ("Solar Sizing & Calculator"): with the lead selected, every button it offers
  let workspace = [];
  const sizing = page.locator("button:visible", { hasText: /Solar Sizing/ }).first();
  if (await sizing.count()) {
    await sizing.click(); await page.waitForTimeout(2000);
    await page.getByText(lead.name, { exact: false }).first().click().catch(() => {}); await page.waitForTimeout(1500);
    workspace = await labels(page);
    await page.screenshot({ path: `${OUT}/r5-${label}-quotation-workspace.png` });
  }
  const out = { firstScreen, proposals, workspace, text, calledDesign, tabs: proposals.filter((l) => /^(Overview|Details|Proposals|Payments|System|Support|Documents)\b/.test(l)) };
  await ctx.close();
  return out;
}
const everything = (o) => [...o.firstScreen, ...o.proposals, ...o.workspace];
const hasInteractive = (o) => everything(o).some((l) => /Interactive link|interactive client link/i.test(l));
const hasRoof = (o) => everything(o).some((l) => /Roof Studio|Proposal Studio/i.test(l));
const hasAutoSizer = (o) => everything(o).some((l) => /Auto Sizer|After Sales Admin/i.test(l));
const hasQuoteWorkspace = (o) => o.workspace.some((l) => /Manual BOQ Builder|Quote Templates|Save Customer Quote/i.test(l));

const adm = await inspect("alpha_admin", /CRM Database/, adminLead2, "admin");
check("B1 pilot administrator: the lead's client workspace opened on the Proposals tab (the quotation is listed; the other tabs are there)", adm.tabs.length >= 5 && /5 kW/.test(adm.text), adm.tabs.join("|"));
check("B1 ...no interactive-link button for the quotation, no Roof Studio, no Proposal Studio", !hasInteractive(adm) && !hasRoof(adm), adm.proposals.join(" | ").slice(0, 400));
check("B1 ...and the page called no design-tool endpoint while it loaded and was inspected", adm.calledDesign.length === 0, adm.calledDesign.join(","));
const sls = await inspect("alpha_sales", /My CRM Leads/, salesLead, "sales");
check("B1 pilot sales user: the assigned lead's client workspace opened on the Proposals tab", sls.tabs.length >= 5 && /5 kW/.test(sls.text), sls.tabs.join("|"));
check("B1 ...and the quotation workspace (\"Solar Sizing & Calculator\", which is where quotations are written) opened for the lead", hasQuoteWorkspace(sls), sls.workspace.join(" | ").slice(0, 500));
check("B1 ...no interactive-link button, no Roof Studio / Proposal Studio, no Auto Sizer or After Sales Admin anywhere in the lead's workspace, proposals tab or first screen", !hasInteractive(sls) && !hasRoof(sls) && !hasAutoSizer(sls), everything(sls).join(" | ").slice(0, 600));
check("B1 ...and the page called no design-tool endpoint", sls.calledDesign.length === 0, sls.calledDesign.join(","));

// B2 the same build for the founding company: the buttons ARE there
const fnd = await inspect("t_sales", /My CRM Leads/, foundLead, "founding");
check("B2 founding sales user, same build: the interactive-link button is on the quotation", fnd.proposals.some((l) => /Interactive link/i.test(l)), fnd.proposals.join(" | ").slice(0, 400));
check("B2 ...and Roof Studio and Auto Sizer are offered in the same quotation workspace (so the pilot's lack of them is the module switch, not the build)", fnd.workspace.some((l) => /Roof Studio/i.test(l)) && fnd.workspace.some((l) => /Auto Sizer/i.test(l)), fnd.workspace.join(" | ").slice(0, 500));

// B3 the API, for the very same lead and quotation
const probes = (lead) => [
  ["GET", `/api/leads/${lead.id}/design-session`], ["PUT", `/api/leads/${lead.id}/design-session`, { notes: "x" }],
  ["POST", "/api/interactive-proposals", { leadId: lead.id, quoteId: lead.quoteId }], ["GET", "/api/interactive-proposals"],
  ["POST", "/api/export/pdf/design-studio-proposal/download", { leadId: lead.id }],
];
const run = async (tokenOwner, lead) => Promise.all(probes(lead).map(async ([m, p, b]) => { const r = await api(tokens[tokenOwner])(p, { method: m, ...(b ? { body: JSON.stringify(b) } : {}) }); const body = await json(r); return { m, p, status: r.status, code: body.code }; }));
for (const [who, lead] of [["alpha_admin", adminLead2], ["alpha_sales", salesLead]]) {
  const rs = await run(who, lead);
  check(`B3 ${who}: all ${rs.length} design-tool calls for the lead/quotation the screen showed answer 404 not_available`, rs.every((r) => r.status === 404 && r.code === "not_available"), JSON.stringify(rs.map((r) => [r.m, r.p.slice(0, 40), r.status, r.code])));
}
{
  // a portal customer is refused by the staff-only rule before the module rule (403); either way nothing is served
  const rs = await run("alpha_portal", salesLead);
  check(`B3 alpha_portal (a customer): all ${rs.length} design-tool calls are refused (403 staff only, or 404 not_available), none is served`, rs.every((r) => r.status === 403 || (r.status === 404 && r.code === "not_available")), JSON.stringify(rs.map((r) => [r.m, r.p.slice(0, 40), r.status, r.code])));
}
{
  const rs = await run("t_admin", foundLead);
  check("B3 positive control, the founding administrator: the same calls are NOT answered 404 not_available (the routes exist for the founding company)", rs.every((r) => !(r.status === 404 && r.code === "not_available")), JSON.stringify(rs.map((r) => [r.m, r.p.slice(0, 40), r.status, r.code])));
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
