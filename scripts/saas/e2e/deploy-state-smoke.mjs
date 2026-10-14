// One compact smoke of the single-company workflow, valid in EVERY intermediate deployment state (before or after any migration of either release,
// whichever backend build answers): login, lead, quotation, contract -> invoice, payment, invoice PDF, document upload and byte-identical download, state read.
// Prints one line per check and a summary; exit status 1 if any failed. Disposable stack only.
//   Env: E2E_BASE_URL, TEST_PW (synthetic founding users t_admin / t_sales), STATE (label for the output)
import "./lib/fresh-connections.mjs";
import { createHash } from "node:crypto";

const BASE = process.env.E2E_BASE_URL, PW = process.env.TEST_PW, STATE = process.env.STATE || "";
if (!BASE || !PW || /sunchaserenergy|railway\.app/.test(BASE)) { console.error("Set TEST_PW and a local E2E_BASE_URL."); process.exit(2); }
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => { ok ? pass++ : (fail++, failures.push(n)); console.log(`${ok ? "PASS" : "FAIL"}: ${n}${!ok && d ? " - " + String(d).slice(0, 300) : ""}`); };
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const login = async (u) => j(await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: PW }) }));
const call = (t) => (p, i = {}) => fetch(BASE + p, { ...i, headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(i.headers || {}) } });
const RUN = Math.random().toString(36).slice(2, 8);

const adm = await login("t_admin");
check(`[${STATE}] login`, Boolean(adm.token), JSON.stringify(adm).slice(0, 120));
const A = call(adm.token);
const leadRes = await A("/api/leads", { method: "POST", body: JSON.stringify({ name: `Matrix ${RUN}`, email: `matrix${RUN}@example.test`, phone: "0302" + Math.floor(1000000 + Math.random() * 8999999), leadSource: "Direct/Referral" }) });
const lead = await j(leadRes);
check(`[${STATE}] lead created (${leadRes.status})`, Boolean(lead.id), JSON.stringify(lead).slice(0, 160));
const qr = await A(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 5, panelCount: 2, panelType: "Synthetic", inverterType: "Synthetic", batteryCapacity: "None", totalCost: 2000, boqItems: [{ type: "item", name: "PANEL", description: "panel", qty: 2, unit: "pcs", rate: 1000, total: 2000 }] }) });
check(`[${STATE}] quotation created (${qr.status})`, qr.status < 300, String(qr.status));
const cr = await j(await A(`/api/leads/${lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) }));
const inv = cr.contractProvision?.invoiceId, customerId = cr.contractProvision?.customerId;
check(`[${STATE}] contract provisions an invoice`, Boolean(inv), JSON.stringify(cr.contractProvision || cr).slice(0, 200));
const pay = await A(`/api/admin/invoices/${inv}/payments`, { method: "POST", body: JSON.stringify({ amount: 500, paymentMethod: "Cash", paymentDate: new Date().toISOString().slice(0, 10), clientRequestId: `matrix-${RUN}` }) });
check(`[${STATE}] payment recorded (${pay.status})`, pay.status < 300, String(pay.status));
const pdf = await A(`/api/export/pdf/invoice/${inv}`);
check(`[${STATE}] invoice PDF (${pdf.status})`, pdf.status === 200 && (await pdf.arrayBuffer()).byteLength > 1000);
const bytes = Buffer.from(`%PDF-1.4\n% matrix ${RUN}\n%%EOF\n`);
const up = await A("/api/admin/customer-documents/upload", { method: "POST", body: JSON.stringify({ customerId, documentType: "other", title: `matrix ${RUN}`, fileName: `matrix-${RUN}.pdf`, mimeType: "application/pdf", base64Data: bytes.toString("base64"), clientUploadId: `matrix-up-${RUN}` }) });
const ub = await j(up);
check(`[${STATE}] document upload (${up.status})`, up.status < 300 && Boolean(ub.id), JSON.stringify(ub).slice(0, 200));
const list = await j(await A(`/api/admin/customer-documents/${customerId}`));
const mine = (list.documents || []).find((d) => d.id === ub.id);
let same = false;
if (mine?.fileUrl) { const g = await fetch(new URL(mine.fileUrl, BASE).toString()); same = g.status === 200 && createHash("sha256").update(Buffer.from(await g.arrayBuffer())).digest("hex") === createHash("sha256").update(bytes).digest("hex"); }
check(`[${STATE}] the document downloads byte-identical`, same);
const st = await A("/api/state");
check(`[${STATE}] boot state reads (${st.status})`, st.status === 200 && (await j(st)).leads?.some((l) => l.id === lead.id));
console.log(`SUMMARY [${STATE}]: ${pass} passed, ${fail} failed${fail ? " FAILED: " + failures.join("; ") : ""}`);
process.exit(fail ? 1 : 0);
