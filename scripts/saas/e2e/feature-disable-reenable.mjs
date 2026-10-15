// What switching the multi-company feature OFF does while pilot companies exist: the process PAUSES (maintenance error), changes nothing, and the pilot is served again when it is switched on. SYNTHETIC data, disposable stack.
// Two server processes of the SAME build on one database and one object store: ON (multi-company flag on) and OFF (flag unset, no tenant key).
// The flag is a switch for the application; it does not touch the database, the object store or the pilot companies' data. This journey records exactly what each
// side can then see and do, so that the rollback boundary in docs/ops/COMBINED_DEPLOYMENT_AND_ROLLBACK.md is a measured one: THE FLAG IS A SWITCH, NOT A ROLLBACK.
//   Env: E2E_BASE_URL_ON, E2E_BASE_URL (the OFF instance), E2E_S3_DIR, RAILWAY_S3_ENDPOINT, E2E_PSQL, TEST_PW.   Seed first.
import "./lib/fresh-connections.mjs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ON = process.env.E2E_BASE_URL_ON, OFF = process.env.E2E_BASE_URL, PW = process.env.TEST_PW, S3DIR = process.env.E2E_S3_DIR;
if (!ON || !OFF || !PW || !S3DIR || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(OFF)) { console.error("Set E2E_BASE_URL_ON, E2E_BASE_URL (flag-off), TEST_PW, E2E_S3_DIR, E2E_PSQL."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-v", "ON_ERROR_STOP=1", "-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 400) : ""}`); };
const obs = (n) => console.log(`OBSERVED: ${n}`);
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const RUN = randomBytes(3).toString("hex").toUpperCase(), MB = 1024 * 1024, CACHE_WAIT = Number(process.env.STORAGE_TEST_WAIT_MS || 3500);
const login = async (base, u) => json(await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const api = (base, t) => (p, init = {}) => fetch(base + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(init.headers || {}) } });
const objs = (co) => fs.readdirSync(S3DIR).filter((f) => decodeURIComponent(f).includes(`/c/${co}/`));
const usedBytes = (co) => objs(co).reduce((n, f) => n + fs.statSync(path.join(S3DIR, f)).size, 0);
const objectMap = (co) => Object.fromEntries(objs(co).sort().map((f) => [decodeURIComponent(f), sha(fs.readFileSync(path.join(S3DIR, f)))]));
const pdf = (bytes, tag) => { const head = Buffer.from(`%PDF-1.4\n% ${tag}\n`), tail = Buffer.from("\n%%EOF\n"); return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length - tail.length), 0x20), tail]); };

const aOn = api(ON, (await login(ON, "alpha_admin")).token), opOn = api(ON, (await login(ON, "platform_op")).token), fOn = api(ON, (await login(ON, "t_admin")).token);
const inv = await json(await aOn("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: `disable customer ${RUN}`, customerPhone: "03000000000", items: [{ itemName: "item", description: "item", qty: 1, unit: "pcs", rate: 100000, taxPercent: 0, discountAmount: 0 }] }) }));
const customerId = inv.invoice?.customerId;
const lead = await json(await aOn("/api/leads", { method: "POST", body: JSON.stringify({ name: `PILOTLEAD ${RUN}`, email: `pl${RUN}@example.test`, phone: "0317" + Math.floor(1000000 + Math.random() * 8999999), leadSource: "Direct/Referral" }) }));
const before = usedBytes("co_alpha"), L = Math.ceil(before / MB) + 1, free = L * MB - before, S = Math.floor(free / 5.5), N = Math.floor(free / S);
await opOn("/api/platform/companies/co_alpha", { method: "PATCH", body: JSON.stringify({ limitOverrides: { max_storage_mb: L } }) });
await sleep(CACHE_WAIT);
const upload = (a, tag) => a("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId, documentType: "other", title: `${tag} ${RUN}`, fileName: `${tag}.pdf`, mimeType: "application/pdf", base64Data: pdf(S, tag).toString("base64") }) });
let stored = 0; for (let i = 0; i < N; i++) if ((await upload(aOn, `dfile${i}`)).status === 201) stored++;
check(`setup (flag ON): alpha stores ${N} files up to its ${L} MB limit; the next is refused 402`, stored === N && (await upload(aOn, "over")).status === 402);
const OBJ0 = objectMap("co_alpha");
const alphaRows = () => psql(`select (select count(*) from leads where company_id='co_alpha')||':'||(select count(*) from invoices where company_id='co_alpha')||':'||(select count(*) from customer_documents where company_id='co_alpha')`);
const ROWS0 = alphaRows();
const sunRows = () => psql(`select (select count(*) from leads where company_id='sunchaser')||':'||(select count(*) from invoices where company_id='sunchaser')`);
const SUN0 = sunRows();

// ============================================================ the switch is OFF: the same database, the same files
// With pilot companies present, a process that is not in multi-company mode PAUSES (server/saas/tenantIsolationGuard.ts): it neither serves nor changes anything.
console.log("\nFlag OFF (a second process of the same build, flag unset, no tenant key), pilot data present");
const offHealth = await json(await fetch(`${OFF}/health`));
check("[status label] the flag-off process reports that serving is paused because other companies' data exists", offHealth.tenantIsolation?.paused === true && offHealth.tenantIsolation?.reason === "tenant_data_present", JSON.stringify(offHealth));
{
  const t = await login(OFF, "t_admin");
  check("the founding administrator cannot sign in on it: 503 tenant_isolation_unavailable, no token (the maintenance error, not an unfiltered session)", !t.token && t.code === "tenant_isolation_unavailable", JSON.stringify(t).slice(0, 200));
  const fTok = (await login(ON, "t_admin")).token, aTok = (await login(ON, "alpha_admin")).token;
  let bad = [];
  for (const [who, tok] of [["founding (earlier session)", fTok], ["pilot (earlier session)", aTok]]) for (const [m, pth, body] of [["GET", "/api/state"], ["GET", `/api/admin/invoices/${inv.invoice?.id}`], ["GET", `/api/admin/customer-documents/${customerId}`], ["GET", `/api/export/pdf/invoice/${inv.invoice?.id}`], ["POST", "/api/leads", { name: `NOPE ${RUN}`, email: `nope${RUN}@example.test`, phone: "0309999999", leadSource: "Direct/Referral" }]]) {
      const r = await api(OFF, tok)(pth, { method: m, ...(body ? { body: JSON.stringify(body) } : {}) }); const b = await json(r);
      if (!(r.status === 503 && b.code === "tenant_isolation_unavailable") || JSON.stringify(b).includes(`PILOTLEAD ${RUN}`)) bad.push(`${who} ${m} ${pth} ${r.status}`);
    }
  check("earlier sessions of the founding company and of the pilot company: reads, an invoice PDF, document list and a write are all refused 503 and show no pilot data", bad.length === 0, bad.join("; "));
}
check("the pilot company's files are untouched by the switch (same keys, same bytes) and its rows are untouched; nothing was written by the refused requests", JSON.stringify(objectMap("co_alpha")) === JSON.stringify(OBJ0) && alphaRows() === ROWS0 && psql(`select count(*) from leads where name like 'NOPE%'`) === "0");
// the pilot's files and the quota, served again when the switch is turned back on
console.log("\nFlag ON again");
const aOn2 = api(ON, (await login(ON, "alpha_admin")).token);
const list = await json(await aOn2(`/api/admin/customer-documents/${customerId}`));
let ok = 0; for (const d of (list.documents || []).filter((x) => new RegExp(`^dfile\\d ${RUN}$`).test(x.title || ""))) { const g = await fetch(new URL(d.fileUrl, ON).toString()); if (g.status === 200 && sha(Buffer.from(await g.arrayBuffer())) === sha(pdf(S, (d.fileName || "").replace(/\.pdf$/, "")))) ok++; }
check(`alpha's ${N} files download byte-identical through the flag-on process`, ok === N, String(ok));
const again = await upload(aOn2, "over-again"); const ab = await json(again);
check(`quota accounting is unchanged: the boundary is where it was (402, limit ${L} MB), the founding company's activity did not use alpha's room`, again.status === 402 && ab.code === "storage_limit_exceeded" && ab.limitMb === L, JSON.stringify(ab).slice(0, 160));
check("nothing moved between companies while the switch was off", sunRows() === SUN0);
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
