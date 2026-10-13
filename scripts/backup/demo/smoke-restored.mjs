// Authenticated smoke against an app instance (source stack or restored stack). Prints PASS/FAIL lines and a normalized JSON summary
// so the summaries of the source and restored stacks can be diffed. Synthetic data only. Requires E2E_BASE_URL, TEST_PW, E2E_PSQL, SEED_IDS.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL;
if (!BASE || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("E2E_BASE_URL must be a local 127.0.0.1 URL");
const PSQL = process.env.E2E_PSQL.split(" ");
const sql = (q) => execFileSync("psql", [...PSQL, "-tAc", q]).toString().trim();
const seed = JSON.parse(fs.readFileSync(process.env.SEED_IDS, "utf8"));
let bad = 0;
const check = (name, ok, detail = "") => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " - " + detail : ""}`); };
const summary = {};
async function login(username) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: process.env.TEST_PW }) });
  return { status: r.status, token: (await r.json()).token };
}
const get = (token, path) => fetch(BASE + path, { headers: { authorization: `Bearer ${token}` } });
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const admin = await login("t_admin");
check("staff login against the restored database", admin.status === 200 && !!admin.token, String(admin.status));

const state = await (await get(admin.token, "/api/state")).json();
const leadList = state.leads || [];
const dbLeads = Number(sql("select count(*) from leads where deleted_at is null"));
check("lead list equals database", leadList.length === dbLeads && dbLeads > 0, `api=${leadList.length} db=${dbLeads}`);
summary.leads = leadList.length;

const sqvLeads = sql("select lead_id||'|'||count(*) from smart_quote_versions group by lead_id order by count(*) desc, lead_id").split("\n").map((l) => l.split("|"));
const [bigLead, bigCount] = sqvLeads[0];
const v = await (await get(admin.token, `/api/leads/${bigLead}/smart-quote-versions`)).json();
check("smart quote versions are listed", v.available === true && v.versions.length === Number(bigCount), `available=${v.available} versions=${v.versions?.length} expected=${bigCount}`);
summary.smartQuoteVersionsOnBiggestLead = v.versions.length;
summary.smartQuoteVersionNumbers = v.versions.map((x) => x.versionNumber).sort();
const withPdf = v.versions.filter((x) => x.pdf?.fileUrl);
check("every version carries its archived PDF reference", withPdf.length === v.versions.length, `${withPdf.length}/${v.versions.length}`);
const pdfRes = await fetch(new URL(withPdf[0].pdf.fileUrl, BASE));
const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
check("smart quote PDF downloads and matches the recorded sha256", pdfRes.status === 200 && sha(pdfBuf) === withPdf[0].pdf.sha256, `status=${pdfRes.status} sha=${sha(pdfBuf).slice(0, 8)}`);
summary.smartQuotePdfSha8 = sha(pdfBuf).slice(0, 8);

const invoices = await (await get(admin.token, "/api/admin/invoices")).json();
const invList = Array.isArray(invoices) ? invoices : invoices.invoices || [];
check("invoices are listed", invList.length === Number(sql("select count(*) from invoices")), `api=${invList.length}`);
summary.invoices = invList.length;
const ledger = {};
for (const inv of invList) {
  const detail = (await (await get(admin.token, `/api/admin/invoices/${inv.id}`)).json());
  const payments = detail.payments || detail.invoice?.payments || [];
  const dbSum = Number(sql(`select coalesce(sum(amount),0) from invoice_payments where invoice_id='${inv.id}'`));
  const paid = Number((detail.invoice || inv).paidAmount);
  ledger[inv.invoiceNumber || inv.id] = { payments: payments.length, paid };
  check(`invoice ${inv.invoiceNumber} paid amount equals the payment ledger`, paid === dbSum, `paid=${paid} ledger=${dbSum}`);
}
summary.ledger = Object.values(ledger).map((x) => `${x.payments}:${x.paid}`).sort();
check("two legitimate identical-amount payments survived the restore", Number(sql("select count(*) from (select invoice_id, amount from invoice_payments group by 1,2 having count(*) > 1) s")) >= 1);

const doc = seed.documents[0];
const docs = await (await get(admin.token, `/api/admin/customer-documents/${doc.customerId}`)).json();
const docList = Array.isArray(docs) ? docs : docs.documents || [];
const target = docList.find((d) => d.id === doc.id) || docList[0];
const dl = await fetch(new URL(target.fileUrl || target.file_url, BASE));
const buf = Buffer.from(await dl.arrayBuffer());
check("customer document downloads (signed object URL) and matches the uploaded bytes", dl.status === 200 && sha(buf) === doc.sha256, `status=${dl.status} sha=${sha(buf).slice(0, 8)} want=${doc.sha256.slice(0, 8)}`);
summary.documentSha8 = sha(buf).slice(0, 8);
const forged = await fetch(new URL((target.fileUrl || target.file_url).replace(/sig=[a-f0-9]{4}/, "sig=0000"), BASE));
check("a tampered signature is still refused", forged.status === 403, String(forged.status));

const portal = await login("t_portal_a");
const pdocs = await (await get(portal.token, "/api/customer-portal/documents/me")).json();
const pList = Array.isArray(pdocs) ? pdocs : pdocs.documents || [];
check("linked portal customer sees their documents", pList.length > 0, `n=${pList.length}`);
summary.portalDocuments = pList.length;
const other = await login("t_portal_b");
const denied = await get(other.token, `/api/admin/customer-documents/${doc.customerId}`);
check("another portal customer is refused staff document access", denied.status === 403, String(denied.status));

if (process.env.SMOKE_WRITES === "1") {
// Write path on the scratch database: sequences, defaults, constraints and RLS-bypassing service role all work after restore.
  const nextEvent = sql("insert into interactive_proposal_events (proposal_id, event_type) select id, 'viewed' from interactive_proposals limit 1 returning id").split("\n")[0];
  check("identity sequence continues after the restored value (no primary key collision)", Number(nextEvent) > 5, `next id=${nextEvent}`);
  summary.nextEventId = Number(nextEvent);
  const newLead = await (await fetch(`${BASE}/api/leads`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin.token}` }, body: JSON.stringify({ name: "Post-restore Synthetic", email: "post.restore@example.test", phone: "03019998877", leadSource: "Website" }) })).json();
  check("the restored system accepts new writes", !!newLead.id, newLead.id);
}

console.log("SUMMARY " + JSON.stringify(summary));
process.exit(bad ? 1 : 0);
