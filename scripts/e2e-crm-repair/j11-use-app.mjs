// Small deterministic application workload used by j11-rollback.sh: payments, edits, archive and the refusals, with or without the guard.
// Disposable stack only. Prints PASS/FAIL lines and a final "<n> checks" line; exits non-zero on any failure.
import { BASE, sql, apiLogin, check, results } from "./lib.mjs";
const token = await apiLogin("t_admin");
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = {}; } return { status: r.status, code: j.code || "", json: j }; };
const uuid = () => globalThis.crypto.randomUUID();
const stamp = Date.now();
const mk = async (n, total) => { const r = await call("POST", "/api/admin/invoices", { customerName: `J11 Use Client ${stamp}-${n}`, customerPhone: "0315" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: new Date().toISOString().slice(0, 10), paidAmount: 0, items: [{ itemName: "U", description: "U", qty: 1, rate: total, unit: "job", taxPercent: 0, discountAmount: 0 }] }); await new Promise((x) => setTimeout(x, 3)); return r.json.invoice; };
const row = (id) => sql(`select paid_amount||'/'||balance_due||'/'||payment_status||'/'||invoice_status from invoices where id='${id}'`);
const a = await mk(1, 100000), b = await mk(2, 50000), c = await mk(3, 20000);
const p1 = await call("POST", `/api/admin/invoices/${a.id}/payments`, { amount: 40000, paymentMethod: "Cash", clientRequestId: uuid() });
const p2 = await call("POST", `/api/admin/invoices/${a.id}/payments`, { amount: 60000, paymentMethod: "Bank transfer", referenceNumber: "UR-1", clientRequestId: uuid() });
check("use: two payments fill invoice A exactly", p1.status === 201 && p2.status === 201 && row(a.id) === "100000/0/Paid/active", row(a.id));
const over = await call("POST", `/api/admin/invoices/${a.id}/payments`, { amount: 1, paymentMethod: "Cash", clientRequestId: uuid() });
check("use: one more rupee is a coded 422", over.status === 422 && over.code === "PAYMENT_EXCEEDS_BALANCE", `${over.status} ${over.code}`);
const e1 = await call("PATCH", `/api/admin/invoices/${b.id}`, { items: [{ id: b.items[0].id, itemName: "U", description: "U", qty: 1, rate: 60000, unit: "job", taxPercent: 0, discountAmount: 0 }] });
const q1 = await call("POST", `/api/admin/invoices/${b.id}/payments`, { amount: 30000, paymentMethod: "Cash", clientRequestId: uuid() });
const e2 = await call("PATCH", `/api/admin/invoices/${b.id}`, { items: [{ id: b.items[0].id, itemName: "U", description: "U", qty: 1, rate: 10000, unit: "job", taxPercent: 0, discountAmount: 0 }] });
check("use: raise total, pay, then lowering below payments is refused with 422", e1.status === 200 && q1.status === 201 && e2.status === 422 && row(b.id) === "30000/30000/Partial/active", `${e1.status}/${q1.status}/${e2.status} ${row(b.id)}`);
const ar = await call("POST", `/api/admin/invoices/${a.id}/archive`);
const del = await call("DELETE", `/api/admin/invoices/${a.id}`, { confirmText: "DELETE" });
check("use: archive works; deleting an invoice with payments is a coded 409", ar.status === 200 && del.status === 409 && del.code === "INVOICE_HAS_PAYMENTS", `${ar.status}/${del.status} ${del.code}`);
const del2 = await call("DELETE", `/api/admin/invoices/${c.id}`, { confirmText: "DELETE" });
check("use: an invoice without payments can be deleted", del2.status === 200, String(del2.status));
// invoice created with an advance (opening row), then paid in full; bulk delete reports the paid one as a coded refusal, not an error
const adv = await call("POST", "/api/admin/invoices", { customerName: `J11 Use Client ${stamp}-4`, customerPhone: "0315" + String(Math.floor(1000000 + Math.random() * 8999999)), invoiceDate: new Date().toISOString().slice(0, 10), paidAmount: 30000, items: [{ itemName: "U", description: "U", qty: 1, rate: 100000, unit: "job", taxPercent: 0, discountAmount: 0 }] });
const advId = adv.json.invoice?.id;
const advRows = sql(`select count(*) || '/' || coalesce(min(id), '') from invoice_payments where invoice_id='${advId}'`);
const rest = await call("POST", `/api/admin/invoices/${advId}/payments`, { amount: 70000, paymentMethod: "Cash", clientRequestId: uuid() });
check("use: an invoice created with an advance gets one opening row; paying the rest completes it", adv.status === 201 && advRows === `1/pay-init-${advId}` && rest.status === 201 && row(advId) === "100000/0/Paid/active", `${adv.status} ${advRows} ${rest.status} ${row(advId)}`);
const bulk = await call("POST", "/api/admin/invoices/bulk-delete", { ids: [advId], confirmText: "DELETE" });
check("use: bulk delete of a paid invoice reports a refusal in the body (no 5xx)", bulk.status === 200 && (bulk.json.failed || []).length === 1 && (bulk.json.deleted || []).length === 0, `${bulk.status} ${JSON.stringify(bulk.json).slice(0, 120)}`);
console.log(`${results.length} checks`);
if (results.some((r) => !r.ok)) process.exit(1);
