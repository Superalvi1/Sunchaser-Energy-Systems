// Company export and restore, with documents: restoring ONE company changes nothing of another. Two SYNTHETIC companies are filled through the API
// (settings, lead -> quotation -> contract -> invoice -> payments, uploaded documents), company alpha is exported, damaged, and restored; every table
// and every stored object of beta and of the founding company must be byte-identical before and after. Disposable stack only.
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW, PG* (superuser of the disposable server), the RAILWAY_S3_* variables of the stack.
//   Run with:  node --import tsx scripts/saas/e2e/company-restore.mjs      after seed-two-companies.mjs (clean companies)
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { companyFingerprint } from "../../../server/saas/companyBackup.ts";
import { deleteRailwayObject, listRailwayObjects, putRailwayObject, getRailwayObject } from "../../../server/storage/railwayObjectStorage.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, "..", "..", "..");
const CLASSIFICATION = path.join(REPO, "scripts/saas/table-classification.json");
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151";
const PW = process.env.TEST_PW;
const psqlArgs = (process.env.E2E_PSQL || "").split(" ");
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE) || !process.env.RAILWAY_S3_BUCKET) { console.error("Set TEST_PW, E2E_PSQL, the RAILWAY_S3_* variables and a local E2E_BASE_URL."); process.exit(2); }
const arg = (f) => { const i = psqlArgs.indexOf(f); return i >= 0 ? psqlArgs[i + 1] : undefined; };
const PG = { host: arg("-h"), port: Number(arg("-p") || 5432), user: arg("-U") || "postgres", database: arg("-d") };
const pgEnv = (db = PG.database) => ({ ...process.env, PGHOST: PG.host, PGPORT: String(PG.port), PGUSER: PG.user, PGDATABASE: db });
const psql = (q, db = PG.database) => execFileSync("psql", ["-h", PG.host, "-p", String(PG.port), "-U", PG.user, "-d", db, "-tAc", q]).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " - " + String(detail).slice(0, 300) : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const RUN = randomBytes(3).toString("hex").toUpperCase();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "restore-e2e-")); fs.chmodSync(WORK, 0o700);
process.on("exit", () => { try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {} });

const login = async (u) => (await json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) })));
const caller = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) } });
const put = (api, p, body) => api(p, { method: "PUT", body: JSON.stringify(body) });
const miniPdf = (text) => {
  const body = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
};

const CO = {
  alpha: { id: "co_alpha", user: "alpha_admin", t: `ALPHA${RUN}`, name: `Alpha Solar Works ${RUN}`, rate: 41000, qty: 8 },
  beta: { id: "co_beta", user: "beta_admin", t: `BETA${RUN}`, name: `Beta Energy House ${RUN}`, rate: 36000, qty: 9 },
};
for (const c of Object.values(CO)) { const l = await login(c.user); c.api = caller(l.token); c.token = l.token; }

// ------------------------------------------------------------------------------------------ 1. fill both companies through the API
// Evidence for an intermittent failure: every step of the fill keeps its HTTP status; a step that is not 2xx prints a record at once.
const record = (c, step, r, body) => { c.steps = c.steps || []; c.steps.push({ step, status: r.status }); if (r.status >= 300) console.log("STEP-FAILURE-RECORD " + JSON.stringify({ at: new Date().toISOString(), company: c.id, step, status: r.status, body: JSON.stringify(body ?? "").slice(0, 400) })); return r; };
async function fill(c) {
  await put(c.api, "/api/company/settings/branding", { companyName: c.name, officeAddress: `1 ${c.t} Road`, phoneNumbers: "021-1", billingEmail: `${c.t.toLowerCase()}@example.test`, websiteUrl: `www.${c.t.toLowerCase()}.test` });
  await put(c.api, "/api/company/settings/bank-accounts", { accounts: [{ bankName: `${c.t} Bank`, accountTitle: `${c.t} TITLE`, accountNumber: `${c.t}001`, iban: `PK00${c.t}0001`, showOnInvoice: true }] });
  await put(c.api, "/api/company/settings/terms", { terms: [`${c.t} term one.`, `${c.t} term two.`] });
  await put(c.api, "/api/company/settings/prices", { quoteValidityDays: 12, currencySettings: "PKR (Rs.)" });
  const phone = "0316" + String(Math.floor(1000000 + Math.random() * 8999999));
  const leadRes = await c.api("/api/leads", { method: "POST", body: JSON.stringify({ name: `${c.t} Customer`, email: `${c.t.toLowerCase()}@example.test`, phone, leadSource: "Direct/Referral" }) });
  c.lead = await json(leadRes); record(c, "create lead", leadRes, c.lead);
  const boq = [{ type: "item", name: `${c.t}-PANEL`, description: `${c.t} panel`, qty: c.qty, unit: "pcs", rate: c.rate, total: c.qty * c.rate }];
  const quoteRes = await c.api(`/api/leads/${c.lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: c.qty, panelType: "Synthetic 500W", inverterType: "Synthetic 5kW", batteryCapacity: "None", totalCost: c.qty * c.rate, boqItems: boq }) });
  record(c, "create quotation", quoteRes, quoteRes.status >= 300 ? await quoteRes.clone().text() : "");
  const contractRes = await c.api(`/api/leads/${c.lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) });
  const cr = await json(contractRes); record(c, "contract (provisions customer and invoice)", contractRes, cr.contractProvision ?? cr);
  c.invoiceId = cr.contractProvision?.invoiceId; c.customerId = cr.contractProvision?.customerId || psql(`select customer_id from leads where id='${c.lead.id}'`);
  c.total = c.qty * c.rate;
  const payRes = await c.api(`/api/admin/invoices/${c.invoiceId}/payments`, { method: "POST", body: JSON.stringify({ amount: Math.round(c.total * 0.3), paymentMethod: "Cash", paymentDate: new Date().toISOString().slice(0, 10), clientRequestId: `${c.t}-p1` }) });
  record(c, "payment", payRes, payRes.status >= 300 ? await payRes.clone().text() : "");
  c.docs = [];
  for (const i of [1, 2]) {
    const bytes = miniPdf(`${c.t}CANARYFILE${i}`);
    const t0 = Date.now(), at = new Date().toISOString();
    const ur = await c.api("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId: c.customerId, documentType: "other", title: `${c.t} document ${i}`, fileName: `${c.t}-${i}.pdf`, mimeType: "application/pdf", base64Data: bytes.toString("base64"), clientUploadId: `${c.t.toLowerCase()}-up-${i}` }) });
    const raw = await ur.text();
    let r = {}; try { r = JSON.parse(raw); } catch { /* not JSON: kept in the record below */ }
    if (!r.id) {
      // Evidence for an intermittent failure: the whole response, and the state of the thing the request depends on (the customer row it names).
      const h = {}; for (const k of ["content-type", "retry-after", "x-subscription-state", "x-request-id"]) if (ur.headers.get(k)) h[k] = ur.headers.get(k);
      const rec = { at, elapsedMs: Date.now() - t0, company: c.id, upload: i, status: ur.status, headers: h, body: raw.slice(0, 600), customerIdSent: c.customerId, customerRowExists: psql(`select count(*) from customers where id='${c.customerId}' and company_id='${c.id}'`), leadCustomerId: psql(`select coalesce(customer_id,'') from leads where id='${c.lead.id}'`), documentsOfCustomer: psql(`select count(*) from customer_documents where customer_id='${c.customerId}'`) };
      c.uploadProblem = `${c.id} upload ${i}: HTTP ${ur.status} ${raw.slice(0, 160)}`;
      console.log("UPLOAD-FAILURE-RECORD " + JSON.stringify(rec));
    }
    c.docs.push({ id: r.id, bytes, hash: sha(bytes) });
  }
  c.number = psql(`select invoice_number from invoices where id='${c.invoiceId}'`);
}
await Promise.all([fill(CO.alpha), fill(CO.beta)]);
const A = CO.alpha, B = CO.beta;
const filled = (c) => ({ invoice: Boolean(c.invoiceId), documents: c.docs.every((d) => d.id), payments: c.invoiceId ? psql(`select count(*) from invoice_payments where invoice_id='${c.invoiceId}'`) : "no invoice" });
check("both companies are filled: invoice, payment, quotation, two documents, settings", [A, B].every((c) => { const f = filled(c); return f.invoice && f.documents && f.payments === "1"; }),
  [A, B].map((c) => `${c.id}: ${JSON.stringify(filled(c))} steps=${JSON.stringify(c.steps || [])}${c.uploadProblem ? " " + c.uploadProblem : ""}`).join(" | "));
const keysOf = async (c) => (await Promise.all(["customer-documents", "quote-assets"].map((ns) => listRailwayObjects(ns, `c/${c.id}/`)))).flat().length;
check("each company has stored documents under its own prefix", (await keysOf(A)) >= 2 && (await keysOf(B)) >= 2);

const FP = (id) => companyFingerprint(PG, id, CLASSIFICATION);
const fpA0 = await FP(A.id), fpB0 = await FP(B.id), fpS0 = await FP("sunchaser");
const rowsOf = (fp) => Object.values(fp.tables).reduce((s, v) => s + Number(v.split(":")[0]), 0);
check(`fingerprints taken (alpha ${rowsOf(fpA0)} rows / ${Object.keys(fpA0.objects).length} objects, beta ${rowsOf(fpB0)} / ${Object.keys(fpB0.objects).length}, founding ${rowsOf(fpS0)} rows)`, rowsOf(fpA0) > 20 && rowsOf(fpB0) > 20 && Object.keys(fpA0.objects).length >= 2,
  // when it fails: which tables hold a different number of rows for the two companies (they are filled identically)
  Object.keys({ ...fpA0.tables, ...fpB0.tables }).filter((t) => String(fpA0.tables[t] || "0").split(":")[0] !== String(fpB0.tables[t] || "0").split(":")[0]).map((t) => `${t}: alpha ${String(fpA0.tables[t] || "0").split(":")[0]} / beta ${String(fpB0.tables[t] || "0").split(":")[0]}`).join("; "));

// ------------------------------------------------------------------------------------------ 2. export alpha
const cli = (args, env = {}) => spawnSync("node", ["--import", "tsx", path.join(REPO, "scripts/saas/company-backup.mjs"), ...args], { encoding: "utf8", env: { ...pgEnv(), ...env }, cwd: REPO });
const OUT = path.join(WORK, "alpha-export");
let r = cli(["export", "--company", A.id, "--out", OUT]);
check("export of alpha succeeds", r.status === 0, r.stderr || r.stdout);
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
const rowCount = (n) => manifest.tables.find((t) => t.name === n)?.rows;
check("manifest: leads, customers, quotations, invoices, lines, payments, documents, settings, bank accounts, terms and the numbering counter are in", ["leads", "customers", "quotations", "invoices", "invoice_items", "invoice_payments", "customer_documents", "settings", "bank_accounts", "company_terms", "document_counters"].every((n) => rowCount(n) >= 1), JSON.stringify(manifest.tables.map((t) => `${t.name}:${t.rows}`)));
check("manifest: both documents are in the archive with their sha256", manifest.objects.length >= 2 && A.docs.every((d) => manifest.objects.some((o) => o.sha256 === d.hash)));
check("manifest: the archive is in dependency order (parents before children)", manifest.tables.findIndex((t) => t.name === "customers") < manifest.tables.findIndex((t) => t.name === "customer_documents") && manifest.tables.findIndex((t) => t.name === "invoices") < manifest.tables.findIndex((t) => t.name === "invoice_payments"));
r = cli(["verify", "--dir", OUT]);
check("verify accepts the untouched archive", r.status === 0 && /OK/.test(r.stdout), r.stderr + r.stdout);
const allText = (dir) => { const out = []; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(fs.readFileSync(path.join(d, e.name)).toString("latin1")))); walk(dir); return out.join("\n"); };
const archiveText = allText(OUT);
check("the archive holds nothing of beta (its name, canaries, ids) and no password hash", ![B.t, B.name, B.invoiceId, B.lead.id, B.customerId].some((s) => archiveText.includes(s)) && !/"password"/.test(fs.readFileSync(path.join(OUT, "identity/memberships.json"), "utf8")));
check("the archive's membership file lists only alpha's members", JSON.parse(fs.readFileSync(path.join(OUT, "identity/memberships.json"), "utf8")).every((m) => m.company_id === A.id));

// encrypted archive: unreadable without the passphrase, restorable with it
const ENC = path.join(WORK, "alpha.enc");
r = cli(["export", "--company", A.id, "--out", path.join(WORK, "alpha-export-2"), "--encrypt-env", "BACKUP_PASS", "--archive", ENC], { BACKUP_PASS: `pass-${RUN}` });
check("encrypted archive is written", r.status === 0 && fs.existsSync(ENC), r.stderr + r.stdout);
check("the encrypted archive contains none of alpha's names or canaries in the clear", !fs.readFileSync(ENC).toString("latin1").includes(A.t));
r = cli(["restore", "--archive", ENC, "--decrypt-env", "BACKUP_PASS", "--company", A.id], { BACKUP_PASS: "wrong-passphrase" });
check("a wrong passphrase is refused", r.status !== 0 && /passphrase|damaged/i.test(r.stderr), r.stderr + r.stdout);
r = cli(["restore", "--archive", ENC, "--decrypt-env", "BACKUP_PASS", "--company", A.id], { BACKUP_PASS: `pass-${RUN}` });
check("the right passphrase gives a dry run that changes nothing", r.status === 0 && /DRY RUN/.test(r.stdout), r.stderr + r.stdout);

// ------------------------------------------------------------------------------------------ 3. damage alpha (and only alpha)
await deleteRailwayObject("customer-documents", manifest.objects.find((o) => o.sha256 === A.docs[0].hash).key);
const stray = `c/${A.id}/stray-${RUN}.txt`;
await putRailwayObject("customer-documents", stray, Buffer.from("stray object created after the export"), "text/plain");
psql(`set session_replication_role = replica; delete from invoice_payments where invoice_id='${A.invoiceId}'; delete from invoice_items where invoice_id='${A.invoiceId}'; delete from invoices where id='${A.invoiceId}'; update leads set name='HACKED ${RUN}' where id='${A.lead.id}'; delete from bank_accounts where company_id='${A.id}'; update settings set value='{"damaged":true}' where company_id='${A.id}' and key like '%company_branding'; delete from customer_documents where id='${A.docs[1].id}'; update document_counters set last_value=0 where company_id='${A.id}'; insert into company_terms (id, term_text, sort_order, company_id) values ('junk-${RUN}','junk',99,'${A.id}')`);
const fpADamaged = await FP(A.id);
check("alpha is damaged: invoice and payments gone, lead renamed, bank accounts gone, a document row and an object gone, counter reset, junk added", JSON.stringify(fpADamaged) !== JSON.stringify(fpA0) && psql(`select count(*) from invoices where id='${A.invoiceId}'`) === "0");
check("beta and the founding company are unchanged by the damage (digests of every table and object)", JSON.stringify(await FP(B.id)) === JSON.stringify(fpB0) && JSON.stringify((await FP("sunchaser")).tables) === JSON.stringify(fpS0.tables));
// sensitivity of the comparison itself (negative control): one changed row of beta is detected
psql(`update leads set name=name||'x' where id='${B.lead.id}'`);
check("negative control: a single changed row of beta IS detected by the fingerprint", JSON.stringify(await FP(B.id)) !== JSON.stringify(fpB0));
psql(`update leads set name=left(name, length(name)-1) where id='${B.lead.id}'`);
check("...and reverting it restores the identical fingerprint", JSON.stringify(await FP(B.id)) === JSON.stringify(fpB0));

// ------------------------------------------------------------------------------------------ 4. things that must be refused, and a dry run that changes nothing
r = cli(["restore", "--dir", OUT, "--company", A.id]);
check("dry run (no --yes) reports the plan and changes nothing", r.status === 0 && /DRY RUN/.test(r.stdout) && JSON.stringify(await FP(A.id)) === JSON.stringify(fpADamaged), r.stderr + r.stdout);
r = cli(["restore", "--dir", OUT, "--company", B.id, "--yes"]);
check("alpha's archive is refused for company beta", r.status !== 0 && /belongs to company co_alpha/.test(r.stderr), r.stderr + r.stdout);
const copy = (name) => { const d = path.join(WORK, name); fs.cpSync(OUT, d, { recursive: true }); return d; };
let d = copy("tampered"); fs.appendFileSync(path.join(d, "data/leads.jsonl"), "\n");
r = cli(["restore", "--dir", d, "--company", A.id, "--yes"]);
check("a changed data file is refused (checksum)", r.status !== 0 && /Checksum mismatch/.test(r.stderr), r.stderr);
d = copy("extra"); fs.writeFileSync(path.join(d, "data/extra.jsonl"), "{}\n");
r = cli(["restore", "--dir", d, "--company", A.id, "--yes"]);
check("an extra file in the archive is refused", r.status !== 0 && /do(es)? not list/.test(r.stderr), r.stderr);
d = copy("nomanifest"); fs.rmSync(path.join(d, "manifest.json"));
r = cli(["restore", "--dir", d, "--company", A.id, "--yes"]);
check("an archive without manifest is refused", r.status !== 0 && /manifest/.test(r.stderr), r.stderr);
d = copy("badcolumn"); { const m = JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8")); m.tables.find((t) => t.name === "leads").columns.push("no_such_column"); fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(m)); }
r = cli(["restore", "--dir", d, "--company", A.id, "--yes"]);
check("a schema that differs from the target is refused", r.status !== 0 && /no column no_such_column/.test(r.stderr), r.stderr);
d = copy("foreignrow"); { // a row of ANOTHER company smuggled into alpha's archive, with the manifest made consistent
  const f = path.join(d, "data/leads.jsonl"); const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); lines[0].company_id = B.id;
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n"; fs.writeFileSync(f, body);
  const m = JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8")); m.files["data/leads.jsonl"] = sha(body); m.tables.find((t) => t.name === "leads").sha256 = sha(body); fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(m)); }
r = cli(["restore", "--dir", d, "--company", A.id, "--yes"]);
check("a row of another company inside the archive is refused", r.status !== 0 && /belongs to co_beta/.test(r.stderr), r.stderr);
check("none of those refusals changed anything: alpha is still in its damaged state, beta and founding identical", JSON.stringify((await FP(A.id)).tables) === JSON.stringify(fpADamaged.tables) && JSON.stringify(await FP(B.id)) === JSON.stringify(fpB0) && JSON.stringify((await FP("sunchaser")).tables) === JSON.stringify(fpS0.tables));

// ------------------------------------------------------------------------------------------ 5. the real restore
const startedAt = Date.now();
r = cli(["restore", "--dir", OUT, "--company", A.id, "--yes"]);
check(`restore of alpha applies (${Date.now() - startedAt} ms)`, r.status === 0 && /RESTORED/.test(r.stdout), r.stderr + r.stdout);
console.log(r.stdout.split("\n").map((l) => "   " + l).join("\n"));
const fpA1 = await FP(A.id);
const tablesEqual = JSON.stringify(fpA1.tables) === JSON.stringify(fpA0.tables);
check("alpha's tables are identical to the export (every table's digest)", tablesEqual, Object.keys(fpA0.tables).filter((k) => fpA0.tables[k] !== fpA1.tables[k]).join(", "));
const wantObjects = Object.fromEntries(Object.entries(fpA0.objects));
check("alpha's stored documents are identical to the export (the deleted one is back; the stray one made after the export is kept)", Object.entries(wantObjects).every(([k, v]) => fpA1.objects[k] === v) && Object.keys(fpA1.objects).some((k) => k.endsWith(`stray-${RUN}.txt`)));
check("BETA is byte-identical before and after (every table and every stored object)", JSON.stringify(await FP(B.id)) === JSON.stringify(fpB0));
check("the FOUNDING company's tables are identical before and after", JSON.stringify((await FP("sunchaser")).tables) === JSON.stringify(fpS0.tables));
check("alpha's invoice is back with its number, total and its payment, and the lead name is back", psql(`select invoice_number||':'||grand_total::float||':'||paid_amount::float from invoices where id='${A.invoiceId}'`) === `${A.number}:${A.total}:${Math.round(A.total * 0.3)}` && psql(`select name from leads where id='${A.lead.id}'`) === `${A.t} Customer` && psql(`select count(*) from company_terms where id='junk-${RUN}'`) === "0");
check("alpha's numbering counter is back at 1 (it was reset to 0 by the damage), so the next invoice number cannot repeat the restored one", psql(`select last_value from document_counters where company_id='${A.id}' and kind='invoice'`) === "1");
// the application sees it again
const a2 = caller((await login(A.user)).token);
const inv = await json(await a2(`/api/admin/invoices/${A.invoiceId}`));
check("alpha signs in and reads the restored invoice through the application", (inv.invoice || inv).invoiceNumber === A.number || (inv.invoice || inv).invoice_number === A.number, JSON.stringify(inv).slice(0, 200));
const docList = await json(await a2(`/api/admin/customer-documents/${A.customerId}`));
const restoredDoc = (docList.documents || []).find((x) => x.id === A.docs[1].id) || (docList.documents || [])[0];
let okFiles = 0;
for (const doc of A.docs) {
  const row = (docList.documents || []).find((x) => x.id === doc.id);
  const link = row?.fileUrl; if (!link) continue;
  const got = await fetch(BASE + new URL(link, BASE).pathname + new URL(link, BASE).search);
  if (got.status === 200 && sha(Buffer.from(await got.arrayBuffer())) === doc.hash) okFiles++;
}
check("alpha downloads BOTH restored documents through fresh links and they are byte-identical to what was uploaded", okFiles === 2 || (docList.documents || []).length === 0 ? okFiles === 2 : false, `${okFiles} of 2`);
const b2 = caller((await login(B.user)).token);
check("beta still reads its own invoice and cannot read alpha's restored one", (await b2(`/api/admin/invoices/${B.invoiceId}`)).status === 200 && (await b2(`/api/admin/invoices/${A.invoiceId}`)).status === 404);
const nl = await json(await a2("/api/leads", { method: "POST", body: JSON.stringify({ name: `${A.t} After`, email: "after@example.test", phone: "0317" + String(Math.floor(1000000 + Math.random() * 8999999)), leadSource: "Direct/Referral" }) }));
check("alpha keeps working after the restore: a new lead is created", Boolean(nl.id));

// ------------------------------------------------------------------------------------------ 6. pruning is explicit
// (beta signed in and read in step 5, which writes its own activity log: take beta's baseline again, then prove the next restores leave it alone)
const fpB1 = await FP(B.id);
r = cli(["restore", "--dir", OUT, "--company", A.id, "--yes", "--prune-objects"]);
const fpA2 = await FP(A.id);
check("--prune-objects removes the object the export does not contain and nothing else", r.status === 0 && !Object.keys(fpA2.objects).some((k) => k.endsWith(`stray-${RUN}.txt`)) && JSON.stringify(fpA2.objects) === JSON.stringify(fpA0.objects), r.stderr);
check("...and beta's objects and tables are still identical (against beta's baseline taken just before)", JSON.stringify(await FP(B.id)) === JSON.stringify(fpB1));
check("restoring twice gives the same result (idempotent)", JSON.stringify((await FP(A.id)).tables) === JSON.stringify(fpA0.tables));

// ------------------------------------------------------------------------------------------ 7. a different database: an empty target built from the release schema + tenant migrations
const TARGET = `t_restore_${RUN.toLowerCase()}`;
try {
  execFileSync("bash", [path.join(REPO, "scripts/saas/tests/mkdb.sh"), TARGET], { env: { ...process.env, E2E_ADMIN: `-h ${PG.host} -p ${PG.port} -U ${PG.user}` } });
  const runner = (a) => spawnSync("node", [path.join(REPO, "scripts/migrations/run.mjs"), ...a], { encoding: "utf8", env: pgEnv(TARGET), cwd: REPO });
  psql(`create schema if not exists app; create table if not exists app.config (key text primary key, value text not null); insert into app.config values ('document_floor.sunchaser.invoice.${new Date().getFullYear()}','8') on conflict do nothing`, TARGET);
  const ap = runner(["apply", "--yes"]);
  check("an empty target database gets the tenant migrations through the runner", ap.status === 0, ap.stderr + ap.stdout.slice(-300));
  psql(`insert into companies (id, slug, name, status) values ('${A.id}','alpha-target','Alpha target','active')`, TARGET);
  psql(`insert into users select * from users where id in (select user_id from company_memberships where company_id='${A.id}') on conflict do nothing`, PG.database); // no-op on the source
  const t0 = cli(["restore", "--dir", OUT, "--company", A.id, "--yes"], { PGDATABASE: TARGET });
  check("alpha restores into an EMPTY database (company row created by the operator first)", t0.status === 0 && /RESTORED/.test(t0.stdout), t0.stderr + t0.stdout);
  const tf = await companyFingerprint({ ...PG, database: TARGET }, A.id, CLASSIFICATION);
  check("the empty target now holds exactly alpha's data (every table's digest equals the export's)", JSON.stringify(tf.tables) === JSON.stringify(fpA0.tables), Object.keys(fpA0.tables).filter((k) => fpA0.tables[k] !== tf.tables[k]).join(", "));
  check("...and holds nothing of beta (no beta row in any table of the target)", psql(`select count(*) from leads where company_id<>'${A.id}'`, TARGET) === "0" && psql(`select count(*) from invoices where company_id<>'${A.id}'`, TARGET) === "0");
  check("members whose users do not exist in the target are reported, not created", /users not in this database/.test(t0.stdout) && psql(`select count(*) from users where username='${A.user}'`, TARGET) === "0");
} finally {
  try { execFileSync("psql", ["-h", PG.host, "-p", String(PG.port), "-U", PG.user, "-d", "postgres", "-qc", `drop database if exists ${TARGET} with (force)`]); } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("Failed:\n - " + failures.join("\n - "));
process.exitCode = fail ? 1 : 0;
