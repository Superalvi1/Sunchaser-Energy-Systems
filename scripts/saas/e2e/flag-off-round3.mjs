// Flag-off equivalence for the round-3 and round-4 changes (MULTI_COMPANY_ENABLED unset): what a single-company deployment sees. Disposable stack only;
// needs a second application instance of the same build started without the flag and without the tenant key. Part of the CI job "pilot-journeys"
// (scripts/saas/ci/run-pilot-journeys.sh starts that instance after the multi-company journeys); run by hand the same way.
//   Env: E2E_BASE_URL (the flag-off instance), E2E_PSQL, TEST_PW (synthetic users t_admin, t_sales).
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3152", PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW, E2E_PSQL and a local E2E_BASE_URL."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 250) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const login = async (u) => json(await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const adm = await login("t_admin"), sales = await login("t_sales");
const api = (t) => (p, i = {}) => fetch(BASE + p, { ...i, headers: { "content-type": "application/json", authorization: "Bearer " + t, ...(i.headers || {}) } });
const A = api(adm.token), S = api(sales.token);

const pi = await json(await fetch(BASE + "/api/auth/platform-info"));
check("the sign-in screens are told this is NOT a multi-company platform (they keep the Sunchaser screens)", pi.multiCompany === false && !("platformName" in pi), JSON.stringify(pi));
const st = await json(await A("/api/state"));
check("the boot state carries no module flags and no identity mark (nothing changes in the interface)", !("modules" in st) && !("documentIdentity" in st));
const presets = await A("/api/admin/autosizer-presets");
check(`AutoSizer presets are available as before (${presets.status})`, presets.status === 200);
const lead = await json(await A("/api/leads", { method: "POST", body: JSON.stringify({ name: "Flag-off sizer lead", email: "fo@example.test", phone: "03170000001", leadSource: "Direct/Referral" }) }));
const boq = [{ type: "item", name: "x", description: "x", qty: 1, unit: "pcs", rate: 1000, total: 1000 }];
const sizer = await A(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ quote_type: "auto_sizer", systemSizekW: 5, totalCost: 1000, boqItems: boq }) });
const sb = await json(sizer);
check(`saving an AutoSizer quote is not refused by the module gate (${sizer.status}; the existing "temporarily disabled" rule, if any, is unchanged)`, sb.code !== "module_disabled", JSON.stringify(sb).slice(0, 160));
for (const [m, p] of [["GET", "/api/admin/deliveries/dashboard/summary"], ["GET", "/api/admin/project-deliveries"], ["GET", "/api/admin/warranty-claims"], ["GET", "/api/inbox/threads"]]) {
  const r = await A(p, { method: m }); const b = await json(r);
  check(`${m} ${p} is not refused by the company gate (${r.status})`, b.code !== "not_available");
}
const inv = await json(await A("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: "Flag-off customer", customerPhone: "03170000002", items: [{ itemName: "x", description: "x", qty: 1, unit: "pcs", rate: 100, taxPercent: 0, discountAmount: 0 }] }) }));
check("an invoice is created", Boolean(inv.invoice?.id));
const snap = psql(`select coalesce(issuance_snapshot::text,'') from invoices where id='${inv.invoice?.id}'`);
console.log(`   (snapshot stored in single-company mode when t6 is applied: ${snap ? "yes" : "no"}; ${snap ? snap.slice(0, 140) : ""})`);
const pr = await A(`/api/export/pdf/invoice/${inv.invoice?.id}`); const html = await pr.text();
check(`the invoice prints (${pr.status}) with the founding company's own name and no neutral-company wording`, pr.status === 200 && /Sunchaser/i.test(html));
// ---- round 4: the new gates and limits must not exist when the flag is off
for (const [m, p, body] of [["GET", "/api/interactive-proposals"], ["GET", `/api/leads/${lead.id}/design-session`], ["POST", "/api/ai/chat", "{}"], ["POST", "/api/gemini/chat", "{}"]]) {
  const r = await A(p, { method: m, ...(body ? { body } : {}) }); const b = await json(r);
  check(`${m} ${p.replace(lead.id, "<lead>")} is not refused by the company gate (${r.status})`, b.code !== "not_available", `${r.status} ${JSON.stringify(b).slice(0, 120)}`);
}
const stTwo = await json(await A("/api/state"));
check("no module flag named designTools or assistants is sent (nothing is hidden)", !("modules" in stTwo));
const noLimitImg = await A("/api/upload", { method: "POST", body: JSON.stringify({ base64Data: "data:image/png;base64," + Buffer.alloc(300).toString("base64"), filename: `flagoff-${Date.now()}.png` }) });
const nb = await json(noLimitImg);
check(`the image upload still writes to the public uploads folder as before (${noLimitImg.status} ${nb.url})`, noLimitImg.status === 200 && /^\/uploads\//.test(nb.url || ""));
{
  const fs = await import("node:fs");
  for (const d of ["public/uploads", "dist/public/uploads"]) { try { for (const f of fs.readdirSync(d)) if (f.startsWith("flagoff-")) fs.rmSync(`${d}/${f}`, { force: true }); } catch { /* no such folder */ } }
}
const doc = await A("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId: "does-not-exist", documentType: "other", fileName: "x.pdf", mimeType: "application/pdf", base64Data: Buffer.from("%PDF-1.4\n%%EOF").toString("base64") }) });
const db2 = await json(doc);
check(`a document upload is never answered with a storage-limit refusal (${doc.status} ${db2.code || ""})`, !["storage_limit_exceeded", "storage_unverified", "storage_limit_not_set"].includes(db2.code));
check("a Sales Executive still cannot reach the company settings screen API for writing", (await S("/api/company/settings/branding", { method: "PUT", body: JSON.stringify({ companyName: "x" }) })).status >= 400);
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
