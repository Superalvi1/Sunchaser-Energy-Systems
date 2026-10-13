// Seeds an ISOLATED stack with synthetic CRM data through the real HTTP API (leads, quotations, invoices,
// payments, Smart Quote versions with archived PDFs, customer documents with stored objects).
// Never run against production. Requires: E2E_BASE_URL, TEST_PW, E2E_PSQL (see scripts/e2e-crm-repair/isolated-stack.sh).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL;
const PW = process.env.TEST_PW;
if (!BASE || !PW || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("Refusing to run: E2E_BASE_URL must be a local 127.0.0.1 URL and TEST_PW must be set.");
const PSQL = (process.env.E2E_PSQL || "").split(" ");
const sql = (q) => execFileSync("psql", [...PSQL, "-tAc", q]).toString().trim();
const out = process.env.SEED_OUT || "/tmp/seed-ids.json";
const ids = { leads: [], invoices: [], payments: [], smartQuotes: [], documents: [] };
let ok = 0, bad = 0;
const check = (name, cond, detail = "") => { cond ? ok++ : bad++; console.log(`${cond ? "PASS" : "FAIL"}: ${name}${detail ? " - " + detail : ""}`); };

async function login(username) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) });
  return (await r.json()).token;
}
const admin = await login("t_admin");
const A = (path, init = {}) => fetch(BASE + path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${admin}`, ...(init.headers || {}) } });
const post = (path, body) => A(path, { method: "POST", body: JSON.stringify(body) });

// ---- Staff leads (11 clients with realistic spread of sources/statuses) ----
const sources = ["Direct/Referral", "Facebook", "Website", "Walk-in"];
for (let i = 0; i < 11; i++) {
  const phone = `0301${String(5000000 + i * 1111).padStart(7, "0")}`;
  const r = await post("/api/leads", { name: `Synthetic Client ${i + 1}`, email: `client${i + 1}@example.test`, phone, address: `House ${i + 1}, Synthetic Town`, location: ["Lahore", "Karachi", "Islamabad"][i % 3], monthlyBill: 40000 + i * 7000, leadSource: sources[i % 4], notes: i % 4 === 0 ? "Legacy-style note: prefers evening calls." : "" });
  const j = await r.json();
  ids.leads.push({ id: j.id, phone });
}
check("11 staff leads created", ids.leads.every((l) => l.id), JSON.stringify(ids.leads.map((l) => !!l.id)));

const boq = [
  { type: "item", name: "AIKO 645W panels", description: "N-type", qty: 16, unit: "pcs", rate: 27735, total: 443760 },
  { type: "item", name: "Knox 10kW hybrid inverter", description: "Hybrid", qty: 1, unit: "pcs", rate: 365000, total: 365000 },
  { type: "item", name: "Installation and structure", description: "L2 stands, cabling, labour", qty: 1, unit: "job", rate: 391240.5, total: 391240.5 },
];
// ---- Quotations for the first 7, contracts (-> invoices) for the first 5 ----
for (let i = 0; i < 7; i++) {
  const lead = ids.leads[i];
  const r = await post(`/api/leads/${lead.id}/create-quote`, { systemSizekW: 10, panelCount: 16, panelType: "AIKO 645W", inverterType: "Knox 10kW", batteryCapacity: "None", totalCost: 1200000 + i * 10000, structureType: "L2", installationCharges: 0, netMeteringCharges: 0, paymentTerms: "50/40/10", warrantyTerms: "Standard", termsAndConditions: "Synthetic terms", boqItems: boq });
  if (!r.ok) console.log("quote failed", r.status, (await r.text()).slice(0, 120));
}
check("7 quotations", sql(`select count(*) from quotations`) >= "7", sql(`select count(*) from quotations`));
for (let i = 0; i < 5; i++) {
  const lead = ids.leads[i];
  const r = await A(`/api/leads/${lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) });
  const j = await r.json();
  const invoiceId = j.contractProvision?.invoiceId;
  if (invoiceId) ids.invoices.push({ id: invoiceId, leadId: lead.id });
}
check("5 invoices from contracted leads", ids.invoices.length === 5, `got ${ids.invoices.length}`);

// ---- Payments: invoice 0 gets two LEGITIMATE identical-amount payments (distinct client request ids) ----
const pay = async (inv, body) => { const r = await post(`/api/admin/invoices/${inv}/payments`, body); const j = await r.json(); ids.payments.push({ inv, status: r.status, id: j.payment?.id }); return { status: r.status, j }; };
const inv0 = ids.invoices[0].id;
const total0 = (await (await A(`/api/admin/invoices/${inv0}`)).json()).invoice.grandTotal;
const p1 = await pay(inv0, { amount: 100000, paymentMethod: "Bank transfer", clientRequestId: "seed-pay-0001-aaaa", referenceNumber: "TRX-A" });
const p2 = await pay(inv0, { amount: 100000, paymentMethod: "Bank transfer", clientRequestId: "seed-pay-0002-bbbb", referenceNumber: "TRX-B" });
check("two identical-amount payments with distinct request ids are both recorded", p1.status === 201 && p2.status === 201 && sql(`select count(*) from invoice_payments where invoice_id='${inv0}' and amount=100000`) === "2", `${p1.status}/${p2.status}`);
const p2r = await pay(inv0, { amount: 100000, paymentMethod: "Bank transfer", clientRequestId: "seed-pay-0002-bbbb", referenceNumber: "TRX-B" });
check("retry of the same request id is a replay (200), not a third row", p2r.status === 200 && sql(`select count(*) from invoice_payments where invoice_id='${inv0}' and amount=100000`) === "2", String(p2r.status));
await pay(ids.invoices[1].id, { amount: 250000, paymentMethod: "Cash", clientRequestId: "seed-pay-0003-cccc" });
await pay(ids.invoices[1].id, { amount: 150000, paymentMethod: "Cheque", clientRequestId: "seed-pay-0004-dddd", referenceNumber: "CHQ-77" });
const inv2total = (await (await A(`/api/admin/invoices/${ids.invoices[2].id}`)).json()).invoice.grandTotal;
await pay(ids.invoices[2].id, { amount: inv2total, paymentMethod: "Online", clientRequestId: "seed-pay-0005-eeee" });
void total0;
check("payment ledger rows present", Number(sql("select count(*) from invoice_payments")) >= 5, sql("select count(*) from invoice_payments"));

// ---- Public Smart Quotes: 4 clients, 1-3 versions each, archived PDF per version ----
const caps = [6, 8, 10, 12, 15, 20];
let seq = 1;
for (let c = 0; c < 4; c++) {
  const phone = `0302${String(7000000 + c * 2222).padStart(7, "0")}`;
  const versions = (c % 3) + 1;
  for (let v = 0; v < versions; v++) {
    const quoteNumber = `SES-20261009-${String(1100 + seq++).padStart(4, "0")}`;
    const lines = [{ category: "Equipment", description: "Solar panel", specification: "645W", unit: "pcs", quantity: 10 + v, unitPricePkr: 27735, totalPkr: (10 + v) * 27735 }];
    const body = { name: `Smart Quote Client ${c + 1}`, phone, city: "Lahore", quoteNumber, systemCapacityKw: caps[(c + v) % 6], estimatedTotalPkr: 900000 + c * 50000 + v * 25000, panel: "10 x Synthetic 645W", inverter: "1 x Synthetic 10kW", battery: "Not included", structure: "L2", generatedAt: new Date(Date.now() - (10 - seq) * 3600e3).toISOString(), snapshot: { lines, subtotalPkr: lines[0].totalPkr, discountPkr: 0 } };
    const r = await fetch(`${BASE}/api/public/smart-quotes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.leadId) { check(`smart quote ${quoteNumber} saved`, false, `${r.status} ${JSON.stringify(j).slice(0, 120)}`); continue; }
    const pdf = Buffer.from(`%PDF-1.4\n% synthetic quotation ${quoteNumber} v${v + 1}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
    const pr = await fetch(`${BASE}/api/public/smart-quote-pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: j.leadId, quoteNumber, uploadToken: j.pdfUploadToken, pdfBase64: pdf.toString("base64") }) });
    ids.smartQuotes.push({ quoteNumber, leadId: j.leadId, version: j.versionNumber, status: r.status, pdfStatus: pr.status });
  }
}
check("smart quote versions saved with PDFs", ids.smartQuotes.length === 7 && ids.smartQuotes.every((q) => [200, 201].includes(q.status) && q.pdfStatus === 201), JSON.stringify(ids.smartQuotes.map((q) => `${q.version}:${q.status}/${q.pdfStatus}`)));
check("smart quote versions in the table", Number(sql("select count(*) from smart_quote_versions")) === ids.smartQuotes.length, sql("select count(*) from smart_quote_versions"));

// ---- Customer documents with stored objects ----
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const customers = sql(`select distinct customer_id from leads where id in (${ids.leads.slice(0, 4).map((l) => `'${l.id}'`).join(",")}) and customer_id is not null`).split("\n").filter(Boolean);
ids.customers = customers;
for (const [i, customerId] of customers.entries()) {
  for (const [k, kind] of ["pdf", "png"].entries()) {
    const buf = kind === "pdf" ? Buffer.from(`%PDF-1.4\n% synthetic bill ${i}\ntrailer<</Root 1 0 R>>\n%%EOF\n`) : png;
    const r = await post("/api/admin/customer-documents/upload", { customerId, base64Data: buf.toString("base64"), fileName: `synthetic-${i}-${k}.${kind}`, mimeType: kind === "pdf" ? "application/pdf" : "image/png", documentType: kind === "pdf" ? "electricity_bill" : "cnic_copy", title: `Synthetic ${kind} ${i}`, clientUploadId: `seed-upload-${i}-${k}-abcdef` });
    const j = await r.json();
    ids.documents.push({ customerId, id: j.id, status: r.status, sha256: createHash("sha256").update(buf).digest("hex") });
  }
}
check("customer documents uploaded", ids.documents.length >= 6 && ids.documents.every((d) => d.status === 201), JSON.stringify(ids.documents.map((d) => d.status)));

// ---- Link the synthetic portal user to the first documented customer ----
if (customers[0]) {
  const r = await post("/api/admin/customer-linking/link", { customerId: customers[0], userId: "u-test-portal-a", confirmOverride: true });
  check("portal user linked", r.ok, String(r.status));
  ids.portalCustomerId = customers[0];
}

// ---- Rows that mimic production-only shapes: *_backup_20260606 snapshot tables, advanced sequence ----
sql(`create table if not exists public.leads_backup_20260606 as select * from public.leads`);
sql(`create table if not exists public.invoices_backup_20260606 as select * from public.invoices`);
// Advance an identity sequence (restore must preserve sequence positions, otherwise the next insert collides).
sql(`insert into public.interactive_proposals (id, token_hash, lead_id, quotation_id, definition, current_config, expires_at)
     select gen_random_uuid(), encode(sha256(gen_random_uuid()::text::bytea),'hex'), l.id, q.id, '{}'::jsonb, '{}'::jsonb, now() + interval '30 days'
     from public.quotations q join public.leads l on l.id = q.lead_id limit 1`);
sql(`insert into public.interactive_proposal_events (proposal_id, event_type, configuration)
     select p.id, e, '{"seed":true}'::jsonb from public.interactive_proposals p, unnest(array['created','viewed','modified','viewed','accepted']) as e`);
fs.writeFileSync(out, JSON.stringify(ids, null, 2));
console.log(`seed done: ${ok} passed, ${bad} failed; ids -> ${out}`);
process.exit(bad ? 1 : 0);
