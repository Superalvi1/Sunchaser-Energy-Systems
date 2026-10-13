// Deploy-order check: the new backend must keep working on a database where migrations t6 (invoice issuance snapshot) and t7 (storage limit,
// settings history) are NOT applied yet, because the backend may be deployed before the migrations. The two migrations are rolled back through the
// runner, the behaviour is checked, and they are applied again (also when a check throws). Disposable stack only.
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW, PGHOST/PGPORT/PGUSER/PGDATABASE (+PGPASSWORD) for the migration runner.   Seed first: seed-two-companies.mjs
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151", PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || !process.env.PGDATABASE || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW, E2E_PSQL, PG* and a local E2E_BASE_URL."); process.exit(2); }
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 250) : ""}`); };
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q]), { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const runner = (...a) => execFileSync("node", ["scripts/migrations/run.mjs", ...a, "--yes"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (u) => (await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) })).json());
const reload = async () => { psql("notify pgrst, 'reload schema'"); await sleep(3000); };

try {
  runner("rollback", "--to", "t6-invoice-issuance-snapshot");
  await reload();
  check("t6 and t7 are rolled back (no snapshot column, no history table, no storage-limit column)", psql(`select (select count(*) from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='issuance_snapshot')::text || (select count(*) from information_schema.tables where table_schema='public' and table_name='company_settings_audit')::text || (select count(*) from information_schema.columns where table_schema='public' and table_name='saas_plans' and column_name='max_storage_mb')::text`) === "000");
  const t = (await login("alpha_admin")).token, o = (await login("platform_op")).token;
  const api = (p, i = {}) => fetch(BASE + p, { ...i, headers: { "content-type": "application/json", authorization: "Bearer " + t, ...(i.headers || {}) } });
  const inv = await api("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerName: "Compat customer", customerPhone: "03001111111", items: [{ itemName: "x", description: "x", qty: 1, unit: "pcs", rate: 100, taxPercent: 0, discountAmount: 0 }] }) });
  const ij = await inv.json().catch(() => ({}));
  check(`an invoice is still created (${inv.status}); it simply has no snapshot (a legacy invoice)`, inv.status === 201 && ij.invoice?.id && !ij.invoice?.issuanceSnapshot);
  const pr = await api(`/api/export/pdf/invoice/${ij.invoice?.id}`);
  check(`it prints, labelled legacy (${pr.status}, ${pr.headers.get("x-invoice-issuance")})`, pr.status === 200 && pr.headers.get("x-invoice-issuance") === "legacy_current_settings");
  const br = await api("/api/company/settings/branding", { method: "PUT", body: JSON.stringify({ companyName: "Compat Co" }) });
  const bj = await br.json().catch(() => ({}));
  check(`settings still save, and the response says no history row was written (${br.status}, auditRecorded ${bj.auditRecorded})`, br.status === 200 && bj.auditRecorded === false);
  const hs = await api("/api/company/settings/history"); const hj = await hs.json().catch(() => ({}));
  check(`the history endpoint answers "not available" instead of failing (${hs.status})`, hs.status === 200 && hj.available === false && Array.isArray(hj.history) && hj.history.length === 0);
  const ov = await fetch(BASE + "/api/platform/overview", { headers: { authorization: "Bearer " + o } });
  check(`the operator overview still loads (${ov.status})`, ov.status === 200);
  const up = await api("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId: ij.invoice?.customerId, documentType: "other", title: "compat", fileName: "c.pdf", mimeType: "application/pdf", base64Data: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64") }) });
  check(`uploads still work with no storage limit column (${up.status})`, up.status === 201);
  const lead = await api("/api/leads", { method: "POST", body: JSON.stringify({ name: "Compat lead", email: "compat@example.test", phone: "03002222222", leadSource: "Direct/Referral" }) });
  check(`other writes are unaffected (${lead.status})`, lead.status === 201);
} finally {
  runner("apply");
  await reload();
}
check("t6 and t7 are applied again", psql(`select (select count(*) from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='issuance_snapshot')::text || (select count(*) from information_schema.tables where table_schema='public' and table_name='company_settings_audit')::text`) === "11");
console.log(`\n${pass} passed, ${fail} failed${fail ? "\nFAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
