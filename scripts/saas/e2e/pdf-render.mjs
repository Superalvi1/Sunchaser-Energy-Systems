// REAL PDFs rendered by Chromium (the application's own engine, src/lib/quotePdfRender.ts) for two SYNTHETIC companies: branding, logo, amounts, bank
// details and terms are read back from the PDF bytes (pdftotext / pdfimages / pdfinfo), another company's and Sunchaser's values must be absent,
// a historical quotation keeps its original identity, and a company cannot download the other's PDF. Disposable stack only.
//   Env: E2E_BASE_URL, E2E_PSQL, TEST_PW, PLAYWRIGHT_BROWSERS_PATH (the server needs it too), OUT_DIR (optional, default docs/saas/evidence/pdf).
//   Run with:  node --import tsx scripts/saas/e2e/pdf-render.mjs      after seed-two-companies.mjs (clean companies)
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { renderQuotationHtmlToPdf } from "../../../src/lib/quotePdfRender.ts";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3151";
const PW = process.env.TEST_PW;
if (!PW || !process.env.E2E_PSQL || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and E2E_PSQL and point E2E_BASE_URL at a local stack."); process.exit(2); }
const OUT = process.env.OUT_DIR || "docs/saas/evidence/pdf";
fs.mkdirSync(OUT, { recursive: true });
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q])).toString().trim();
let pass = 0, fail = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? pass++ : (fail++, failures.push(name)); console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail && !ok ? " - " + detail : ""}`); };
const json = async (r) => { try { return await r.json(); } catch { return {}; } };
const RUN = randomBytes(3).toString("hex").toUpperCase();
const login = async (username) => (await json(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PW }) })));
const caller = (token) => (p, init = {}) => fetch(BASE + p, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) } });
const put = (api, p, body) => api(p, { method: "PUT", body: JSON.stringify(body) });

// A solid-colour PNG (the company's synthetic logo): its colour is read back from the image embedded in the PDF.
const crc = (() => { const t = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return (b) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const solidPng = (w, h, [r, g, b]) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
};

const SUNCHASER = /sunchaser|DHA Phase|0309-0236666|0330-7776444|0321-8486752|ceo\.sunchaser|sunchaserenergy|PK81ABPA|PK03ASCM|04190010112276940012|03860200001296|201139501310001|HELIOS|AL ADAM|SIGNALS GLOBAL|Allied Bank|Askari Bank|Bank Islamic/i;
const CO = {
  alpha: { user: "alpha_admin", t: `ALPHA${RUN}`, color: [200, 30, 30], name: `Alpha Solar Works ${RUN}`, address: `1 Alpha Road ${RUN} Karachi`, phones: "021-1010101", email: `billing.${RUN.toLowerCase()}@alpha.test`, web: `www.alpha-${RUN.toLowerCase()}.test`,
    banks: [{ bankName: `Alpha Bank ${RUN}`, accountTitle: `ALPHA SOLAR WORKS ${RUN}`, accountNumber: `A${RUN}0001`, iban: `PK00ALPH${RUN}000001` }, { bankName: `Alpha Islamic ${RUN}`, accountTitle: `ALPHA SOLAR WORKS ${RUN}`, accountNumber: `A${RUN}0002`, iban: "N/A" }],
    terms: [`Alpha clause one ${RUN}: sixty percent advance.`, `Alpha clause two ${RUN}: balance on commissioning.`], rate: 41000, qty: 8 },
  beta: { user: "beta_admin", t: `BETA${RUN}`, color: [30, 60, 200], name: `Beta Energy House ${RUN}`, address: `2 Beta Street ${RUN} Lahore`, phones: "042-2020202", email: `accounts.${RUN.toLowerCase()}@beta.test`, web: `www.beta-${RUN.toLowerCase()}.test`,
    banks: [{ bankName: `Beta Bank ${RUN}`, accountTitle: `BETA ENERGY HOUSE ${RUN}`, accountNumber: `B${RUN}0003`, iban: `PK00BETA${RUN}000003` }],
    terms: [`Beta clause one ${RUN}: thirty percent advance.`, `Beta clause two ${RUN}: net fifteen days.`], rate: 36000, qty: 9 },
};
for (const c of Object.values(CO)) { const l = await login(c.user); c.api = caller(l.token); c.companyId = l.companyId; c.logo = `data:image/png;base64,${solidPng(60, 20, c.color).toString("base64")}`; }
const other = (c) => (c === CO.alpha ? CO.beta : CO.alpha);
check("both companies sign in bound to their own company", CO.alpha.companyId === "co_alpha" && CO.beta.companyId === "co_beta");

// ---- PDF reading helpers
const tmp = (ext) => path.join(os.tmpdir(), `pdfr-${process.pid}-${Math.random().toString(36).slice(2)}.${ext}`);
const readPdf = (bytes) => {
  const f = tmp("pdf"); fs.writeFileSync(f, bytes);
  const text = spawnSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }).stdout || "";
  const info = spawnSync("pdfinfo", [f], { encoding: "utf8" }).stdout || "";
  const pages = Number((info.match(/^Pages:\s+(\d+)/m) || [])[1] || 0);
  const prefix = tmp("img"); spawnSync("pdfimages", ["-png", f, prefix]);
  const images = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(path.basename(prefix))).map((n) => path.join(os.tmpdir(), n));
  const colors = new Set();
  for (const img of images) { const px = pngFirstPixel(fs.readFileSync(img)); if (px) colors.add(px.join(",")); fs.unlinkSync(img); }
  fs.unlinkSync(f);
  return { text, flat: text.replace(/\s+/g, " "), digits: text.replace(/[,\s]/g, ""), pages, colors, isPdf: Buffer.from(bytes).slice(0, 5).toString() === "%PDF-" };
};
// The first pixel of an RGB(A) 8-bit PNG (the solid logo). Only used on the synthetic logos.
const pngFirstPixel = (buf) => {
  let off = 8, w = 0, h = 0, type = 0, depth = 0; const idat = [];
  while (off < buf.length) { const len = buf.readUInt32BE(off), t = buf.slice(off + 4, off + 8).toString(); const d = buf.slice(off + 8, off + 8 + len); if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; } if (t === "IDAT") idat.push(d); off += 12 + len; }
  if (depth !== 8 || ![2, 6].includes(type) || !w || !h) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat)); return [raw[1], raw[2], raw[3]];
};
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 6);
const hasColor = (colors, rgb) => [...colors].some((k) => near(k.split(",").map(Number), rgb));

async function newQuote(c, label, rate, qty) {
  const phone = "0315" + String(Math.floor(1000000 + Math.random() * 8999999));
  const lead = await json(await c.api("/api/leads", { method: "POST", body: JSON.stringify({ name: `${c.t} ${label}`, email: `${c.t.toLowerCase()}${label}@example.test`, phone, leadSource: "Direct/Referral" }) }));
  const boq = [{ type: "item", name: `${c.t}-PANEL-${label}`, description: `${c.t} panel ${label}`, qty, unit: "pcs", rate, total: qty * rate }];
  await c.api(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: qty, panelType: "Synthetic 500W", inverterType: "Synthetic 5kW", batteryCapacity: "None", totalCost: qty * rate, boqItems: boq }) });
  return { lead, quoteId: psql(`select id from quotations where lead_id='${lead.id}' order by created_at desc limit 1`), total: qty * rate };
}
const quotePdf = async (c, q) => { const r = await c.api(`/api/export/pdf/manual-quote/${q.lead.id}/download?quoteId=${q.quoteId}`); return { status: r.status, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), bytes: Buffer.from(await r.arrayBuffer()) }; };
async function invoiceFor(c, q) {
  const cr = await json(await c.api(`/api/leads/${q.lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) }));
  const id = cr.contractProvision?.invoiceId;
  if (id) await c.api(`/api/admin/invoices/${id}/payments`, { method: "POST", body: JSON.stringify({ amount: Math.round(q.total * 0.25), paymentMethod: "Cash", paymentDate: new Date().toISOString().slice(0, 10), clientRequestId: `${c.t}-pdf-pay-${q.quoteId}` }) });
  return id;
}
const invoicePdf = async (c, id) => { const r = await c.api(`/api/export/pdf/invoice/${id}`); if (r.status !== 200) return { status: r.status, bytes: Buffer.alloc(0) }; return { status: 200, bytes: await renderQuotationHtmlToPdf(await r.text()) }; };

// ---- settings
for (const c of Object.values(CO)) {
  const r = [
    await put(c.api, "/api/company/settings/branding", { companyName: c.name, officeAddress: c.address, phoneNumbers: c.phones, billingEmail: c.email, websiteUrl: c.web, logoUrl: c.logo, invoiceLogoUrl: c.logo }),
    await put(c.api, "/api/company/settings/bank-accounts", { accounts: c.banks.map((b) => ({ ...b, showOnInvoice: true })) }),
    await put(c.api, "/api/company/settings/terms", { terms: c.terms }),
    await put(c.api, "/api/company/settings/prices", { currencySettings: "PKR (Rs.)", quoteValidityDays: 10 }),
  ];
  check(`${c.t}: settings saved`, r.every((x) => x.status === 200), r.map((x) => x.status).join("/"));
}

// ---- real PDFs
for (const c of Object.values(CO)) {
  const o = other(c);
  c.q = await newQuote(c, "PDF", c.rate, c.qty);
  c.inv = await invoiceFor(c, c.q);
  const qp = await quotePdf(c, c.q);
  check(`${c.t}: the quotation downloads as a real PDF (application/pdf, %PDF header, ${qp.bytes.length} bytes)`, qp.status === 200 && /application\/pdf/.test(qp.type || "") && qp.bytes.slice(0, 5).toString() === "%PDF-", `${qp.status} ${qp.type} ${qp.bytes.slice(0, 80)}`);
  check(`${c.t}: the download file name carries no Sunchaser name`, !/sunchaser/i.test(qp.disp || "") && /Quotation/.test(qp.disp || ""), qp.disp);
  fs.writeFileSync(path.join(OUT, `${c.t.replace(RUN, "")}-quotation.pdf`), qp.bytes);
  const q = readPdf(qp.bytes);
  fs.writeFileSync(path.join(OUT, `${c.t.replace(RUN, "")}-quotation.txt`), q.text);
  check(`${c.t}: quotation PDF has the standard 3 pages (${q.pages})`, q.pages === 3, String(q.pages));
  check(`${c.t}: quotation PDF shows its own name, address and terms`, [c.name, c.address].every((s) => q.flat.includes(s)) && c.terms.every((t) => q.flat.includes(t)), [c.name, c.address, ...c.terms].filter((s) => !q.flat.includes(s)).join(" | "));
  check(`${c.t}: quotation PDF prints no equipment brand the company never entered (no default Jinko / Knox)`, !/Jinko|Knox/.test(q.text), (q.text.match(/Jinko|Knox/) || [])[0]);
  check(`${c.t}: quotation PDF shows its amounts (rate ${c.rate}, quantity ${c.qty}, total ${c.q.total})`, q.digits.includes(String(c.q.total)) && q.digits.includes(String(c.rate)), `total ${c.q.total} rate ${c.rate}`);
  check(`${c.t}: quotation PDF embeds the company's own logo (colour ${c.color}) and not the other company's`, hasColor(q.colors, c.color) && !hasColor(q.colors, o.color), [...q.colors].join(" "));
  check(`${c.t}: quotation PDF carries nothing of ${o.t} and nothing of Sunchaser`, ![o.name, o.address, o.terms[0], o.t].some((s) => q.flat.includes(s)) && !SUNCHASER.test(q.text), (q.text.match(SUNCHASER) || [])[0]);
  const ip = await invoicePdf(c, c.inv);
  check(`${c.t}: the invoice renders as a real PDF through the same engine (${ip.bytes.length} bytes)`, ip.status === 200 && ip.bytes.slice(0, 5).toString() === "%PDF-", String(ip.status));
  fs.writeFileSync(path.join(OUT, `${c.t.replace(RUN, "")}-invoice.pdf`), ip.bytes);
  const i = readPdf(ip.bytes);
  fs.writeFileSync(path.join(OUT, `${c.t.replace(RUN, "")}-invoice.txt`), i.text);
  const paid = Math.round(c.q.total * 0.25);
  check(`${c.t}: invoice PDF shows its identity (name, address, phone, e-mail, website)`, [c.name, c.address, c.phones, c.email, c.web].every((s) => i.flat.includes(s)), [c.name, c.address, c.phones, c.email, c.web].filter((s) => !i.flat.includes(s)).join(" | "));
  check(`${c.t}: invoice PDF shows ALL its bank accounts (bank, title, account number, IBAN)`, c.banks.every((b) => [b.bankName, b.accountTitle, b.accountNumber, b.iban].every((s) => i.flat.includes(s))), c.banks.flatMap((b) => [b.bankName, b.accountTitle, b.accountNumber, b.iban]).filter((s) => !i.flat.includes(s)).join(" | "));
  check(`${c.t}: invoice PDF shows its amounts (total ${c.q.total}, paid ${paid}, balance ${c.q.total - paid})`, [c.q.total, paid, c.q.total - paid].every((n) => i.digits.includes(String(n))), [c.q.total, paid, c.q.total - paid].filter((n) => !i.digits.includes(String(n))).join(","));
  check(`${c.t}: invoice PDF embeds its own logo and carries nothing of ${o.t} (name, bank accounts) or Sunchaser (name, accounts, signature)`, hasColor(i.colors, c.color) && !hasColor(i.colors, o.color) && ![o.name, o.address, ...o.banks.flatMap((b) => [b.bankName, b.accountNumber, b.iban])].some((s) => i.flat.includes(s)) && !SUNCHASER.test(i.text), (i.text.match(SUNCHASER) || [])[0] || [...i.colors].join(" "));
}

// ---- sanity: the Sunchaser detector does see Sunchaser values in a REAL PDF of the founding company (its documents keep their defaults)
{
  const fl = await login(process.env.FOUNDING_USER || "t_admin");
  if (fl.token) {
    const F = { api: caller(fl.token), t: `FOUND${RUN}` };
    const fq = await newQuote(F, "PDF", 30000, 2);
    const fp = await quotePdf(F, fq);
    const ft = readPdf(fp.bytes);
    check("sanity: the founding company's own quotation PDF DOES show its Sunchaser name and address (the detector can see them in a real PDF)", fp.status === 200 && ft.isPdf && SUNCHASER.test(ft.text) && /DHA Phase/i.test(ft.text), `${fp.status} ${(ft.text.match(SUNCHASER) || [])[0]}`);
    check("sanity: the founding company's download file name is unchanged (Sunchaser-Quotation-...)", /Sunchaser-Quotation-/.test(fp.disp || ""), fp.disp);
  } else console.log("   (founding sanity skipped: no founding test user can sign in)");
}

// ---- a customer's OWN invoice, downloaded by the customer through the portal handler (alpha has a logo and bank accounts; beta's settings are cleared
// further down, so here beta still has its own)
{
  for (const c of Object.values(CO)) {
    const o = other(c);
    const tag = c === CO.alpha ? "alpha" : "beta";
    const pl = await login(`${tag}_portal`);
    const P = caller(pl.token);
    const cr = await json(await c.api("/api/admin/invoices", { method: "POST", body: JSON.stringify({ customerId: `cust-${tag}-portal`, customerName: `${tag} portal client`, customerPhone: "03000000000", items: [{ itemName: `${c.t}-PORTAL`, description: `${c.t} portal item`, qty: 2, unit: "pcs", rate: 12345, taxPercent: 0, discountAmount: 0 }] }) }));
    const id = cr.invoice?.id;
    check(`${c.t}: an invoice is issued to the company's portal customer`, Boolean(id), JSON.stringify(cr).slice(0, 160));
    if (!id) continue;
    const mine = await P(`/api/export/pdf/invoice/${id}`);
    const pdf = mine.status === 200 ? await renderQuotationHtmlToPdf(await mine.text()) : Buffer.alloc(0);
    const r = readPdf(pdf);
    fs.writeFileSync(path.join(OUT, `${c.t.replace(RUN, "")}-portal-invoice.pdf`), pdf);
    check(`${c.t}: the customer downloads their own invoice as a real PDF through the portal (${mine.status}, ${pdf.length} bytes)`, mine.status === 200 && r.isPdf, String(mine.status));
    check(`${c.t}: that PDF shows the company's identity, its bank accounts and the amount, with its own logo and nothing of ${o.t} or Sunchaser`, [c.name, ...c.banks.flatMap((b) => [b.bankName, b.accountNumber])].every((x) => r.flat.includes(x)) && r.digits.includes(String(2 * 12345)) && hasColor(r.colors, c.color) && !hasColor(r.colors, o.color) && !SUNCHASER.test(r.text) && ![o.name, ...o.banks.map((b) => b.accountNumber)].some((x) => r.flat.includes(x)), (r.text.match(SUNCHASER) || [])[0] || [c.name].filter((x) => !r.flat.includes(x)).join(","));
    const theirs = await P(`/api/export/pdf/invoice/${o.inv}`);
    check(`${c.t}'s portal customer cannot download ${o.t}'s invoice (${theirs.status})`, theirs.status >= 400 && !(await theirs.text()).includes(o.name));
  }
}

// ---- cross-company download attempts
for (const c of Object.values(CO)) {
  const o = other(c);
  const r = await c.api(`/api/export/pdf/manual-quote/${o.q.lead.id}/download?quoteId=${o.q.quoteId}`);
  const body = Buffer.from(await r.arrayBuffer());
  check(`${c.t} cannot download ${o.t}'s quotation PDF (${r.status})`, r.status >= 400 && body.slice(0, 5).toString() !== "%PDF-" && !body.includes(o.name));
  const ri = await c.api(`/api/export/pdf/invoice/${o.inv}`);
  const bi = await ri.text();
  check(`${c.t} cannot get ${o.t}'s invoice document (${ri.status})`, ri.status >= 400 && !bi.includes(o.name) && !bi.includes(o.banks[0].accountNumber));
}

// ---- history in the PDF: change alpha's identity; the old quotation PDF keeps the old one, a new one has the new
const A = CO.alpha, NEWNAME = `Alpha RENAMED ${RUN}`;
await put(A.api, "/api/company/settings/branding", { companyName: NEWNAME, officeAddress: `99 New Office ${RUN} Karachi` });
const old = readPdf((await quotePdf(A, A.q)).bytes);
check("alpha's earlier quotation PDF still shows the ORIGINAL name and address after they were changed", old.flat.includes(A.name) && old.flat.includes(A.address) && !old.flat.includes(NEWNAME), NEWNAME);
A.q2 = await newQuote(A, "PDF2", A.rate + 9000, A.qty);
const fresh = readPdf((await quotePdf(A, A.q2)).bytes);
check("alpha's NEW quotation PDF shows the new name and the new price", fresh.flat.includes(NEWNAME) && !fresh.flat.includes(A.name) && fresh.digits.includes(String((A.rate + 9000) * A.qty)));

// ---- companies WITHOUT a logo: the real PDFs carry no image of anyone else's - no Sunchaser logo, signature or bank-accounts picture, no other
// company's logo - and still carry the company's own name. Then a company that has set nothing at all.
{
  const imageDims = (bytes) => {
    const f = tmp("pdf"); fs.writeFileSync(f, bytes);
    const prefix = tmp("img"); spawnSync("pdfimages", ["-png", f, prefix]);
    const dims = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(path.basename(prefix))).map((n) => { const p2 = path.join(os.tmpdir(), n); const b = fs.readFileSync(p2); fs.unlinkSync(p2); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; });
    fs.unlinkSync(f); return dims;
  };
  const sunchaserDims = ["public/assets/sunchaser-logo.png", "public/assets/signature.png", "public/sunchaser-bank-accounts.png", "public/sunchaser-ceo-signature.png"].filter((f) => fs.existsSync(f)).map((f) => { const b = fs.readFileSync(f); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; });
  check(`sanity: the dimensions of Sunchaser's own logo, signature and bank-accounts pictures are known (${sunchaserDims.join(", ")})`, sunchaserDims.length >= 1);
  const B = CO.beta, A2 = CO.alpha;
  const states = [
    { label: "name only, no logo", body: { companyName: B.name, officeAddress: B.address, phoneNumbers: B.phones, logoUrl: "", invoiceLogoUrl: "" }, expectName: true },
    { label: "nothing set at all", body: { companyName: "", officeAddress: "", phoneNumbers: "", billingEmail: "", websiteUrl: "", logoUrl: "", invoiceLogoUrl: "" }, expectName: false },
  ];
  for (const st of states) {
    const r = await put(B.api, "/api/company/settings/branding", st.body);
    check(`beta (${st.label}): settings saved`, r.status === 200, String(r.status));
    const q = await newQuote(B, "NL" + st.label.length, B.rate, B.qty);
    const inv = await invoiceFor(B, q);
    const qp = await quotePdf(B, q);
    const qr = readPdf(qp.bytes);
    check(`beta (${st.label}): the quotation is still a real PDF with its amounts (${qp.status}, ${qr.pages} pages)`, qp.status === 200 && qr.isPdf && qr.digits.includes(String(q.total)), `${qp.status}`);
    check(`beta (${st.label}): the quotation embeds no Sunchaser logo/signature/bank picture and none of alpha's logo`, !imageDims(qp.bytes).some((d) => sunchaserDims.includes(d)) && !hasColor(qr.colors, A2.color), imageDims(qp.bytes).join(","));
    check(`beta (${st.label}): the quotation carries nothing of Sunchaser or alpha`, !SUNCHASER.test(qr.text) && ![A2.name, A2.address, A2.t].some((x) => qr.flat.includes(x)), (qr.text.match(SUNCHASER) || [])[0]);
    if (st.expectName) check(`beta (${st.label}): the quotation shows the company's own name`, qr.flat.includes(B.name));
    const ip = await invoicePdf(B, inv);
    const ir = readPdf(ip.bytes);
    check(`beta (${st.label}): the invoice is still a real PDF with its amounts (${ip.status}, ${ir.pages} pages)`, ip.status === 200 && ir.isPdf && ir.digits.includes(String(q.total)), `${ip.status}`);
    check(`beta (${st.label}): the invoice embeds no Sunchaser logo/signature/bank picture and none of alpha's logo`, !imageDims(ip.bytes).some((d) => sunchaserDims.includes(d)) && !hasColor(ir.colors, A2.color), imageDims(ip.bytes).join(","));
    check(`beta (${st.label}): the invoice carries nothing of Sunchaser (name, address, phones, accounts) or alpha`, !SUNCHASER.test(ir.text) && ![A2.name, A2.address, ...A2.banks.flatMap((b) => [b.bankName, b.accountNumber])].some((x) => ir.flat.includes(x)), (ir.text.match(SUNCHASER) || [])[0]);
    if (st.expectName) check(`beta (${st.label}): the invoice shows the company's own name`, ir.flat.includes(B.name));
    fs.writeFileSync(path.join(OUT, `beta-${st.expectName ? "nologo" : "bare"}-quotation.pdf`), qp.bytes);
    fs.writeFileSync(path.join(OUT, `beta-${st.expectName ? "nologo" : "bare"}-invoice.pdf`), ip.bytes);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("Failed:\n - " + failures.join("\n - "));
process.exitCode = fail ? 1 : 0;
