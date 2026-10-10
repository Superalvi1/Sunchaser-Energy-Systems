// Overpayment race across TWO app instances sharing one database. Disposable stack only.
// Env: E2E_BASE_URL (instance 1), E2E_BASE_URL_2 (instance 2), E2E_PSQL, TEST_PW. Prints rounds with overpayment / mismatch.
import { execFileSync } from "node:child_process";
const B1 = process.env.E2E_BASE_URL, B2 = process.env.E2E_BASE_URL_2, PW = process.env.TEST_PW;
if (!B1 || !B2 || !PW || /sunchaserenergy|railway\.app/.test(B1 + B2)) { console.error("Set E2E_BASE_URL, E2E_BASE_URL_2, TEST_PW (local only)"); process.exit(2); }
const psql = (q) => execFileSync("psql", process.env.E2E_PSQL.split(" ").concat(["-tAc", q])).toString().trim();
const rounds = Number(process.env.ROUNDS || 40);
const tok = async (b) => (await (await fetch(`${b}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "t_admin", password: PW }) })).json()).token;
const t1 = await tok(B1), t2 = await tok(B2);
const call = (b, t, p, body) => fetch(b + p, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
let over = 0, mismatch = 0, ok201 = 0;
for (let r = 0; r < rounds; r++) {
  const inv = await (await call(B1, t1, "/api/admin/invoices", { customerName: "Race Client", customerPhone: "0311" + String(r).padStart(7, "0"), invoiceDate: "2026-10-09", taxPercent: 0, discountAmount: 0, paidAmount: 0, items: [{ description: "x", qty: 1, unit: "pcs", rate: 100000, taxPercent: 0, discountAmount: 0 }] })).json();
  const id = inv.invoice?.id || inv.id;
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => call(i % 2 ? B1 : B2, i % 2 ? t1 : t2, `/api/admin/invoices/${id}/payments`, { amount: 30000, paymentMethod: "Cash", paymentDate: "2026-10-09", clientRequestId: `race-${r}-${i}-${Math.random().toString(36).slice(2, 8)}` })));
  ok201 += res.filter((x) => x.status === 201).length;
  const ledger = Number(psql(`select coalesce(sum(amount),0) from invoice_payments where invoice_id='${id}'`));
  const paid = Number(psql(`select paid_amount from invoices where id='${id}'`));
  if (ledger > 100000) over++;
  if (paid !== ledger) mismatch++;
}
console.log(JSON.stringify({ rounds, overpaidRounds: over, headerLedgerMismatchRounds: mismatch, accepted201: ok201 }));
process.exitCode = over || mismatch ? 1 : 0;
