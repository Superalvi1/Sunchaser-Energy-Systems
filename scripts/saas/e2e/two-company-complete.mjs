// Two SYNTHETIC companies each complete the whole flow at the same time: lead -> quotation -> contract -> invoice -> edit -> payments -> PDFs -> document
// upload, against a running server in MULTI_COMPANY_ENABLED=true mode. Afterwards each company attacks the other's records, PDFs and files, and a
// canary sweep looks for the other company's unique strings in everything it can read. Disposable stack only.
//   Env: E2E_BASE_URL, E2E_PSQL ("-h <dir> -p <port> -U postgres -d <db>"), TEST_PW.   Seed first: seed-two-companies.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151";
const PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and E2E_PSQL and point E2E_BASE_URL at a local stack."); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q])).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " - " + detail : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FOUNDING_COUNTER = () => psql(`select coalesce((select last_value from document_counters where company_id='sunchaser' and kind='invoice' and period='${new Date().getFullYear()}'), -1)`);
const FOUNDING_BEFORE = FOUNDING_COUNTER();
// OPEN_POLICIES=1: the row-level policies of the core tables are opened (using true) for the whole run, so ONLY the application's own company
// checks (server/saas/ownershipGuard.ts) stand between a company and another company's objects. Lists have no such check and are not swept.
const OPEN = process.env.OPEN_POLICIES === "1";
const OPEN_TABLES = ["leads", "customers", "customer_documents", "quotations", "invoices", "invoice_items", "invoice_payments"];
const policySql = (open) => OPEN_TABLES.map((t) => `alter policy tenant_isolation on public.${t} using (${open ? "true" : "company_id = (select app.request_company_id())"}) with check (${open ? "true" : "company_id = (select app.request_company_id())"})`).join("; ");
if (OPEN) {
  psql(policySql(true));
  process.on("exit", () => { try { psql(policySql(false)); } catch {} });
  console.log("   MODE: row-level policies OPEN on " + OPEN_TABLES.join(", ") + " - only the application's ownership guard is active");
}
const RUN = randomBytes(3).toString("hex").toUpperCase();
const YEAR = new Date().getFullYear();

const login = async (username) => { const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) }); return { status: r.status, ...(await json(r)) }; };
const caller = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
const pdfText = (bytes) => {
  const f = path.join(os.tmpdir(), `canary-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, Buffer.from(bytes));
  const r = spawnSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
  fs.unlinkSync(f);
  return r.status === 0 ? r.stdout : "";
};
// A tiny valid PDF whose text is the canary.
const miniPdf = (text) => {
  const body = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
};

// ---------------------------------------------------------------- the two companies
const CO = {
  alpha: { id: "co_alpha", user: "alpha_admin", tag: `ALPHA${RUN}`, customerName: `Alpha Canary Customer ${RUN}`, item: `ALPHACANARYPANEL${RUN}`, extra: `ALPHACANARYLINE${RUN}`, file: `ALPHACANARYFILE${RUN}`, rate: 12000, qty: 10 },
  beta: { id: "co_beta", user: "beta_admin", tag: `BETA${RUN}`, customerName: `Beta Canary Customer ${RUN}`, item: `BETACANARYPANEL${RUN}`, extra: `BETACANARYLINE${RUN}`, file: `BETACANARYFILE${RUN}`, rate: 9000, qty: 7 },
};
for (const c of Object.values(CO)) { const l = await login(c.user); c.token = l.token; c.api = caller(l.token); c.companyId = l.companyId; }
check("both companies sign in bound to their own company", CO.alpha.companyId === "co_alpha" && CO.beta.companyId === "co_beta");
const other = (c) => (c === CO.alpha ? CO.beta : CO.alpha);

// ---------------------------------------------------------------- 1. each company runs the whole flow, concurrently
async function flow(c) {
  const out = { steps: {} };
  const phone = "0313" + String(Math.floor(1000000 + Math.random() * 8999999));
  // lead
  const lr = await c.api("/api/leads", { method: "POST", body: JSON.stringify({ name: c.customerName, email: `${c.tag.toLowerCase()}@example.test`, phone, leadSource: "Direct/Referral" }) });
  out.lead = await json(lr); out.steps.lead = lr.status;
  // quotation
  const boq = [{ type: "item", name: c.item, description: `${c.item} synthetic`, qty: c.qty, unit: "pcs", rate: c.rate, total: c.qty * c.rate }];
  const total = c.qty * c.rate;
  const qr = await c.api(`/api/leads/${out.lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: c.qty, panelType: "Synthetic 500W", inverterType: "Synthetic 5kW", batteryCapacity: "None", totalCost: total, boqItems: boq }) });
  out.steps.quote = qr.status;
  // contract -> invoice
  const cr = await c.api(`/api/leads/${out.lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) });
  const contracted = await json(cr); out.steps.contract = cr.status;
  out.invoiceId = contracted.contractProvision?.invoiceId;
  out.customerId = contracted.contractProvision?.customerId || psql(`select customer_id from leads where id='${out.lead.id}'`);
  if (out.invoiceId) {
    const g = await json(await c.api(`/api/admin/invoices/${out.invoiceId}`));
    out.invoice = g.invoice || g;
    // edit the invoice through the atomic path: replace the lines (one more line with a canary), using the version we loaded
    const ver = out.invoice.updatedAt || out.invoice.updated_at;
    const items = [{ id: `${c.tag}-L1`, itemName: c.item, description: c.item, qty: c.qty, rate: c.rate, unit: "pcs", taxPercent: 0, discountAmount: 0 },
                   { id: `${c.tag}-L2`, itemName: c.extra, description: c.extra, qty: 1, rate: 5000, unit: "job", taxPercent: 0, discountAmount: 0 }];
    const er = await c.api(`/api/admin/invoices/${out.invoiceId}`, { method: "PATCH", body: JSON.stringify({ items, discountAmount: 0, expectedUpdatedAt: ver }) });
    out.steps.edit = er.status; out.editBody = await json(er);
    out.grand = c.qty * c.rate + 5000;
    // payments: a partial one, its replay (same request id), an over-payment, and the rest
    const part = Math.round(out.grand * 0.4);
    const p1 = await c.api(`/api/admin/invoices/${out.invoiceId}/payments`, { method: "POST", body: JSON.stringify({ amount: part, paymentMethod: "Cash", paymentDate: new Date().toISOString().slice(0, 10), clientRequestId: `${c.tag}-pay-1` }) });
    const p1b = await c.api(`/api/admin/invoices/${out.invoiceId}/payments`, { method: "POST", body: JSON.stringify({ amount: part, paymentMethod: "Cash", paymentDate: new Date().toISOString().slice(0, 10), clientRequestId: `${c.tag}-pay-1` }) });
    const over = await c.api(`/api/admin/invoices/${out.invoiceId}/payments`, { method: "POST", body: JSON.stringify({ amount: out.grand, paymentMethod: "Cash", paymentDate: new Date().toISOString().slice(0, 10), clientRequestId: `${c.tag}-pay-over` }) });
    const p2 = await c.api(`/api/admin/invoices/${out.invoiceId}/payments`, { method: "POST", body: JSON.stringify({ amount: out.grand - part, paymentMethod: "Bank transfer", paymentDate: new Date().toISOString().slice(0, 10), clientRequestId: `${c.tag}-pay-2` }) });
    out.steps.pay1 = p1.status; out.steps.pay1replay = p1b.status; out.steps.over = over.status; out.steps.pay2 = p2.status;
    // PDFs
    // The printable documents are server-rendered HTML (the browser or the app prints them); the binary PDF engine needs Chromium,
    // which this stack does not have, so the content is checked in the HTML.
    const ip = await c.api(`/api/export/pdf/invoice/${out.invoiceId}`);
    out.invoicePdf = ip.status === 200 ? await ip.text() : ""; out.steps.invoicePdf = ip.status;
    out.quoteId = psql(`select id from quotations where lead_id='${out.lead.id}' order by created_at desc limit 1`);
    const qp = await c.api(`/api/export/pdf/manual-quote/${out.lead.id}?quoteId=${out.quoteId}`);
    out.quotePdf = qp.status === 200 ? await qp.text() : ""; out.steps.quotePdf = qp.status;
  }
  // document upload for the company's own customer
  if (out.customerId) {
    const pdf = miniPdf(c.file);
    const dr = await c.api("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId: out.customerId, documentType: "other", title: `${c.tag} document`, fileName: `${c.tag}.pdf`, mimeType: "application/pdf", base64Data: pdf.toString("base64"), clientUploadId: `${c.tag.toLowerCase()}-upload-1` }) });
    out.steps.upload = dr.status; out.doc = await json(dr); out.pdfBytes = pdf;
  }
  return out;
}
const [FA, FB] = await Promise.all([flow(CO.alpha), flow(CO.beta)]);
CO.alpha.f = FA; CO.beta.f = FB;

for (const c of Object.values(CO)) {
  const f = c.f, n = c.tag;
  check(`${n}: lead created`, f.steps.lead === 201 || f.steps.lead === 200, JSON.stringify(f.steps));
  check(`${n}: quotation created`, f.steps.quote < 300, String(f.steps.quote));
  check(`${n}: contracting the lead created an invoice`, Boolean(f.invoiceId), JSON.stringify(f.steps));
  check(`${n}: invoice is stored under ${c.id}`, psql(`select company_id from invoices where id='${f.invoiceId}'`) === c.id);
  check(`${n}: the atomic edit replaced the lines (2 lines, total ${f.grand})`, f.steps.edit === 200 && psql(`select count(*) from invoice_items where invoice_id='${f.invoiceId}'`) === "2" && Number(psql(`select grand_total from invoices where id='${f.invoiceId}'`)) === f.grand, `${f.steps.edit} ${JSON.stringify(f.editBody).slice(0, 160)}`);
  check(`${n}: every line belongs to ${c.id}`, psql(`select count(*) from invoice_items where invoice_id='${f.invoiceId}' and company_id='${c.id}'`) === "2");
  check(`${n}: the partial payment, and its replay with the same request id, recorded ONE payment`, f.steps.pay1 < 300 && f.steps.pay1replay < 300 && psql(`select count(*) from invoice_payments where invoice_id='${f.invoiceId}' and amount=${Math.round(f.grand * 0.4)}`) === "1", JSON.stringify(f.steps));
  check(`${n}: over-payment refused`, f.steps.over >= 400 && f.steps.over < 500, String(f.steps.over));
  check(`${n}: final payment accepted and the invoice is Paid with balance 0`, f.steps.pay2 < 300 && psql(`select payment_status||':'||balance_due::float||':'||paid_amount::float from invoices where id='${f.invoiceId}'`) === `Paid:0:${f.grand}`, psql(`select payment_status||':'||balance_due||':'||paid_amount from invoices where id='${f.invoiceId}'`));
  check(`${n}: all payments carry ${c.id}`, psql(`select count(*) from invoice_payments where invoice_id='${f.invoiceId}' and company_id<>'${c.id}'`) === "0" && Number(psql(`select count(*) from invoice_payments where invoice_id='${f.invoiceId}'`)) >= 2);
  check(`${n}: invoice document produced and contains its own lines and customer`, f.steps.invoicePdf === 200 && f.invoicePdf.includes(c.extra) && f.invoicePdf.includes(c.item) && f.invoicePdf.includes(c.customerName), `${f.steps.invoicePdf} len ${f.invoicePdf.length}`);
  check(`${n}: quotation document produced and contains its own customer`, f.steps.quotePdf === 200 && f.quotePdf.includes(c.customerName), `${f.steps.quotePdf} len ${f.quotePdf.length}`);
  check(`${n}: document uploaded, stored under ${c.id}`, f.steps.upload === 201 && psql(`select company_id from customer_documents where id='${f.doc?.id}'`) === c.id, JSON.stringify(f.steps));
}
const numA = psql(`select invoice_number from invoices where id='${FA.invoiceId}'`), numB = psql(`select invoice_number from invoices where id='${FB.invoiceId}'`);
console.log(`   invoice numbers: alpha ${numA}, beta ${numB}`);
check("each company's first invoice is INV-<year>-0001: two independent sequences (run on a clean stack: seed --cleanup first)", numA === `INV-${YEAR}-0001` && numB === `INV-${YEAR}-0001`, `${numA} / ${numB}`);
check("both companies hold the same invoice number without a conflict", numA === numB && psql(`select count(*) from invoices where invoice_number='${numA}'`) === "2");
check("each company's counter stands at 1", psql(`select string_agg(company_id||'='||last_value, ',' order by company_id) from document_counters where company_id in ('co_alpha','co_beta') and kind='invoice' and period='${YEAR}'`) === "co_alpha=1,co_beta=1");
check(`the founding company's invoice counter is untouched by the pilot companies' invoices (stays at ${FOUNDING_BEFORE})`, FOUNDING_COUNTER() === FOUNDING_BEFORE && FOUNDING_BEFORE !== "-1");

// ---------------------------------------------------------------- 2. cross-company attacks on records, PDFs, files
const snap = (c) => psql(`select md5(coalesce((select string_agg(t::text,'|' order by id) from invoices t where id='${c.f.invoiceId}'),'') || coalesce((select string_agg(t::text,'|' order by id) from invoice_items t where invoice_id='${c.f.invoiceId}'),'') || coalesce((select string_agg(t::text,'|' order by id) from invoice_payments t where invoice_id='${c.f.invoiceId}'),'') || coalesce((select string_agg(t::text,'|' order by id) from customer_documents t where customer_id='${c.f.customerId}'),'') || coalesce((select string_agg(t::text,'|' order by id) from leads t where id='${c.f.lead.id}'),''))`);
const before = { alpha: snap(CO.alpha), beta: snap(CO.beta) };
const received = { alpha: [], beta: [] }; // everything each company's caller received, for the canary sweep
const keep = async (c, r) => { const t = await r.clone().text().catch(() => ""); received[c === CO.alpha ? "alpha" : "beta"].push(t); return r; };

for (const attacker of Object.values(CO)) {
  const v = other(attacker), vf = v.f, a = attacker.api, n = `${attacker.tag}->${v.tag}`;
  const r = {
    readInvoice: await keep(attacker, await a(`/api/admin/invoices/${vf.invoiceId}`)),
    pdf: await a(`/api/export/pdf/invoice/${vf.invoiceId}`),
    leadPdf: await a(`/api/export/pdf/manual-quote/${vf.lead.id}?quoteId=${vf.quoteId}`),
    edit: await keep(attacker, await a(`/api/admin/invoices/${vf.invoiceId}`, { method: "PATCH", body: JSON.stringify({ notes: "HACKED", items: [{ id: "x1", itemName: "x", description: "x", qty: 1, rate: 1, unit: "pcs" }] }) })),
    pay: await keep(attacker, await a(`/api/admin/invoices/${vf.invoiceId}/payments`, { method: "POST", body: JSON.stringify({ amount: 1, paymentMethod: "Cash", paymentDate: "2026-10-10", clientRequestId: `${attacker.tag}-attack` }) })),
    del: await keep(attacker, await a(`/api/admin/invoices/${vf.invoiceId}`, { method: "DELETE" })),
    docs: await keep(attacker, await a(`/api/admin/customer-documents/${vf.customerId}`)),
    upload: await keep(attacker, await a("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId: vf.customerId, documentType: "other", title: "planted", fileName: "p.pdf", mimeType: "application/pdf", base64Data: miniPdf("PLANTED").toString("base64") }) })),
    lead: await keep(attacker, await a(`/api/leads/${vf.lead.id}`, { method: "PUT", body: JSON.stringify({ name: "HACKED" }) })),
    versions: await keep(attacker, await a(`/api/leads/${vf.lead.id}/smart-quote-versions`)),
  };
  check(`${n}: cannot read the invoice`, r.readInvoice.status === 404 || r.readInvoice.status === 403, String(r.readInvoice.status));
  check(`${n}: cannot get the invoice PDF`, r.pdf.status === 404 || r.pdf.status === 403, String(r.pdf.status));
  check(`${n}: cannot get the quotation PDF`, r.leadPdf.status === 404 || r.leadPdf.status === 403, String(r.leadPdf.status));
  check(`${n}: cannot edit the invoice`, r.edit.status >= 400 && r.edit.status < 500, String(r.edit.status));
  check(`${n}: cannot pay the invoice`, r.pay.status >= 400 && r.pay.status < 500, String(r.pay.status));
  check(`${n}: cannot delete the invoice`, r.del.status >= 400 && r.del.status < 500, String(r.del.status));
  check(`${n}: cannot list the customer's documents`, r.docs.status >= 400 || !(await r.docs.clone().text()).includes(v.file), String(r.docs.status));
  check(`${n}: cannot upload onto the customer`, r.upload.status >= 400 && r.upload.status < 500, String(r.upload.status));
  check(`${n}: cannot change the lead`, r.lead.status >= 400 && r.lead.status < 500, String(r.lead.status));
  check(`${n}: cannot read the quotation versions`, r.versions.status === 404 || r.versions.status === 403, String(r.versions.status));
}
check("the victims' invoices, lines, payments, documents and leads are byte-for-byte unchanged by all of those attacks", snap(CO.alpha) === before.alpha && snap(CO.beta) === before.beta);

// ---------------------------------------------------------------- 3. files: the stored object, its link, and what each company can learn about the other's
for (const c of Object.values(CO)) {
  const o = other(c);
  const url = c.f.doc?.fileUrl || c.f.doc?.file_url || psql(`select file_url from customer_documents where id='${c.f.doc?.id}'`);
  const rel = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
  const own = await fetch(BASE + rel);
  const body = Buffer.from(await own.arrayBuffer());
  check(`${c.tag}: its own stored file downloads through its signed link and is the file it uploaded`, own.status === 200 && createHash("sha256").update(body).digest("hex") === createHash("sha256").update(c.f.pdfBytes).digest("hex") && pdfText(body).includes(c.file), String(own.status));
  const m = rel.match(/\/api\/storage\/object\/([^/]+)\/([^?]+)\?(?:exp=\d+&)?sig=([0-9a-f]+)/);
  c.link = m ? { ns: m[1], key: m[2], sig: m[3] } : null;
  check(`${c.tag}: the object key does not contain the other company's ids`, c.link && !Buffer.from(c.link.key, "base64url").toString().includes(o.f.customerId), c.link && Buffer.from(c.link.key, "base64url").toString());
}
const forged = async (victim, attackerSig, exp) => fetch(`${BASE}/api/storage/object/${victim.link.ns}/${victim.link.key}?${exp ? `exp=${exp}&` : ""}sig=${attackerSig}`);
check("every file link is an expiring link (exp is in the URL and covered by the signature)", [CO.alpha, CO.beta].every((c) => /[?&]exp=\d{9,11}&sig=/.test(c.f.doc?.fileUrl || psql(`select file_url from customer_documents where id='${c.f.doc?.id}'`))));
check("stored object keys sit under the company's own prefix (c/<company>/...)", [CO.alpha, CO.beta].every((c) => psql(`select storage_path like 'c/${c.id}/%' from customer_documents where id='${c.f.doc?.id}'`) === "t"));
const expOf = (c) => new URL(BASE + (c.f.doc?.fileUrl || "")).searchParams.get("exp");
check("alpha cannot fetch beta's file with alpha's signature (the signature belongs to one object)", (await forged(CO.beta, CO.alpha.link.sig, expOf(CO.alpha))).status === 403);
check("beta cannot fetch alpha's file with beta's signature", (await forged(CO.alpha, CO.beta.link.sig, expOf(CO.beta))).status === 403);
check("a guessed signature is refused", (await forged(CO.alpha, "0".repeat(64), String(Math.floor(Date.now() / 1000) + 600))).status === 403);
check("alpha's link with a LONGER expiry is refused (the expiry is signed)", (await forged(CO.alpha, CO.alpha.link.sig, String(Number(expOf(CO.alpha)) + 3600))).status === 403);
check("alpha's link without the expiry does not become a permanent link", (await forged(CO.alpha, CO.alpha.link.sig)).status === 403);
check("a file link without a signature is refused", (await fetch(`${BASE}/api/storage/object/${CO.alpha.link.ns}/${CO.alpha.link.key}`)).status === 403);
check("alpha's signature cannot be re-used for beta's key (key swapped in the URL)", (await fetch(`${BASE}/api/storage/object/${CO.alpha.link.ns}/${CO.beta.link.key}?exp=${expOf(CO.alpha)}&sig=${CO.alpha.link.sig}`)).status === 403);
// An old permanent (v1) link is never honoured for a company's prefixed key. The harness knows the stack's synthetic signing secret.
const SECRET = (fs.readFileSync(process.env.E2E_ENV_FILE || "/srv/saas-c1/env.sh", "utf8").match(/RAILWAY_OBJECT_PROXY_SECRET=([0-9a-f]+)/) || [])[1];
const v1 = (ns, key) => createHmac("sha256", SECRET).update(`${ns}\n${key}`).digest("hex");
const keyOf = (c) => Buffer.from(c.link.key, "base64url").toString();
check("a permanent (v1) link for alpha's key, signed with the real secret, is refused", (await fetch(`${BASE}/api/storage/object/${CO.alpha.link.ns}/${CO.alpha.link.key}?sig=${v1(CO.alpha.link.ns, keyOf(CO.alpha))}`)).status === 403);
// Authorised access: no link, a session of the right company.
const viaSession = (c, victim) => c.api(`/api/company/files/${victim.link.ns}/${victim.link.key}`);
const own = await viaSession(CO.alpha, CO.alpha);
check("authorised access: alpha's session downloads alpha's file without any link", own.status === 200 && Buffer.from(await own.arrayBuffer()).equals(CO.alpha.f.pdfBytes), String(own.status));
check("authorised access: beta's session cannot download alpha's file", (await viaSession(CO.beta, CO.alpha)).status === 404);
check("authorised access: alpha's session cannot download beta's file", (await viaSession(CO.alpha, CO.beta)).status === 404);
check("authorised access: no session, no file", (await fetch(`${BASE}/api/company/files/${CO.alpha.link.ns}/${CO.alpha.link.key}`)).status === 401);
const travel = Buffer.from(`c/${CO.beta.id}/../${keyOf(CO.alpha)}`).toString("base64url");
check("authorised access: a path-traversal key is refused", (await CO.beta.api(`/api/company/files/${CO.alpha.link.ns}/${travel}`)).status === 404);
const founding = Buffer.from("smart-quotes/some-lead/q.pdf").toString("base64url");
check("authorised access: a company cannot ask for a founding-company (unprefixed) key", (await CO.alpha.api(`/api/company/files/customer-documents/${founding}`)).status === 404);
// A founding-company link in the old permanent form keeps working (Sunchaser's stored links are not broken).
check("a founding-company permanent link (existing stored links) still works while STORAGE_LEGACY_LINKS is not off", (await fetch(`${BASE}/api/storage/object/customer-documents/${founding}?sig=${v1("customer-documents", "smart-quotes/some-lead/q.pdf")}`)).status === 404, "404 = signature accepted, object does not exist");
// Expiry: wait out the (short) lifetime of the link minted at upload, then it must be dead while a freshly issued one works.
const ttl = Number(process.env.STORAGE_LINK_TTL_SECONDS || 0);
if (ttl) {
  await sleep((Number(expOf(CO.alpha)) - Math.floor(Date.now() / 1000) + 2) * 1000);
  const dead = await fetch(BASE + (CO.alpha.f.doc?.fileUrl || ""));
  check(`an expired link is dead (lifetime ${ttl} s) and says so`, dead.status === 403 && /expired/i.test(await dead.text()), String(dead.status));
  const list = await json(await CO.alpha.api(`/api/admin/customer-documents/${CO.alpha.f.customerId}`));
  const fresh = (list.documents || [])[0]?.fileUrl;
  const alive = fresh ? await fetch(BASE + new URL(fresh, BASE).pathname + new URL(fresh, BASE).search) : { status: 0 };
  check("the document list issues a fresh link and it works", alive.status === 200, String(alive.status));
}

if (!OPEN) {
// ---------------------------------------------------------------- 4. canary sweep: everything each company can read, for the other's canaries
const LISTS = ["/api/state", "/api/admin/invoices", "/api/admin/invoices/contracted-ready", "/api/admin/finance/summary", "/api/admin/finance/projects", "/api/admin/finance/dashboard", "/api/leads/deleted", "/api/export/leads", "/api/export/invoices", "/api/export/customers", "/api/export/invoice_items", "/api/export/invoice_payments", "/api/export/customer_documents", "/api/export/quotations", "/api/export/activity_logs"];
const swept = {};
for (const c of Object.values(CO)) {
  swept[c.tag] = [];
  for (const p of LISTS) {
    const r = await c.api(p);
    if (r.status === 200) { received[c === CO.alpha ? "alpha" : "beta"].push(await r.text()); swept[c.tag].push(p); }
  }
  for (const own of [c.f.invoiceId]) { const r = await c.api(`/api/admin/invoices/${own}`); received[c === CO.alpha ? "alpha" : "beta"].push(await r.text()); }
  received[c === CO.alpha ? "alpha" : "beta"].push(c.f.invoicePdf, c.f.quotePdf);
}
console.log(`   swept (HTTP 200): alpha ${swept[CO.alpha.tag].join(" ")} | beta ${swept[CO.beta.tag].join(" ")}`);
const canaries = (c) => [c.customerName, c.item, c.extra, c.file, c.f.invoiceId, c.f.lead.id, c.f.customerId, c.f.doc?.id, c.link?.key, c.link?.sig].filter(Boolean);
const leaks = (reader, owner) => canaries(owner).filter((k) => received[reader === CO.alpha ? "alpha" : "beta"].some((t) => String(t).includes(k)));
const lA = leaks(CO.alpha, CO.beta), lB = leaks(CO.beta, CO.alpha);
check(`canary sweep: nothing of beta's (names, items, file text, ids, file links) appears in anything alpha received (${received.alpha.length} responses and documents)`, lA.length === 0, lA.join(", "));
check(`canary sweep: nothing of alpha's appears in anything beta received (${received.beta.length} responses and documents)`, lB.length === 0, lB.join(", "));
check("the sweep really covered list, export and state endpoints for both companies", swept[CO.alpha.tag].length >= 3 && swept[CO.beta.tag].length >= 3, JSON.stringify(swept));
check("sanity: each company's own canary IS visible to itself (the sweep can detect canaries)", received.alpha.some((t) => String(t).includes(CO.alpha.extra)) && received.beta.some((t) => String(t).includes(CO.beta.extra)));

}

// ---------------------------------------------------------------- 5. database-level integrity
check("no invoice line, payment or document belongs to a different company than its parent", [
  psql("select count(*) from invoice_items i join invoices p on p.id=i.invoice_id where i.company_id<>p.company_id"),
  psql("select count(*) from invoice_payments i join invoices p on p.id=i.invoice_id where i.company_id<>p.company_id"),
  psql("select count(*) from customer_documents d join customers c on c.id=d.customer_id where d.company_id<>c.company_id"),
  psql("select count(*) from invoices i join customers c on c.id=i.customer_id where i.company_id<>c.company_id")].every((x) => x === "0"));
check("each company's ledger equals its invoice header", [CO.alpha, CO.beta].every((c) => psql(`select abs((select coalesce(sum(amount),0) from invoice_payments where invoice_id='${c.f.invoiceId}') - paid_amount) from invoices where id='${c.f.invoiceId}'`) === "0"));
console.log("   KNOWN GAPS shown by this run (not hidden): both printable documents still carry the Sunchaser brand header, bank details and terms (settings are still one row per database); the SPA still downloads documents through links (it does not yet use the authorised route).");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("Failed:\n - " + failures.join("\n - "));
process.exitCode = fail ? 1 : 0;
