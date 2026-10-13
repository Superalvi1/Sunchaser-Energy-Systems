// Journey 6: quotation → invoice → partial payment (with a lost response and a double click) → balance & ledger.
import fs from "node:fs";
import { STATE, BASE, SHOTS, sql, launch, staffLogin, apiLogin, check, save, randomPhone } from "./lib.mjs";

const admin = await apiLogin("t_admin");
const api = (token) => (path, init = {}) => fetch(BASE + path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers || {}) } });
const A = api(admin);
const phone = randomPhone("0307");
const lead = await (await A("/api/leads", { method: "POST", body: JSON.stringify({ name: "Synthetic Invoice Client", email: "invoice.client@example.test", phone, leadSource: "Direct/Referral" }) })).json();
const quoteRes = await A(`/api/leads/${lead.id}/create-quote`, { method: "POST", body: JSON.stringify({ systemSizekW: 10, panelCount: 16, panelType: "AIKO 645W", inverterType: "Knox 10kW", batteryCapacity: "None", totalCost: 1200000, structureType: "L2", installationCharges: 0, netMeteringCharges: 0, paymentTerms: "50/40/10", warrantyTerms: "Standard", termsAndConditions: "Synthetic test terms",
  boqItems: [
    { type: "item", name: "AIKO 645W panels", description: "N-type", qty: 16, unit: "pcs", rate: 27735, total: 443760 },
    { type: "item", name: "Knox 10kW hybrid inverter", description: "Hybrid", qty: 1, unit: "pcs", rate: 365000, total: 365000 },
    { type: "item", name: "Installation and structure", description: "L2 stands, cabling, labour", qty: 1, unit: "job", rate: 391240.5, total: 391240.5 },
  ] }) });
const quoteBody = await quoteRes.json();
void quoteBody;
const quoteId = sql(`select id from quotations where lead_id='${lead.id}' order by created_at desc limit 1`);
check("J6 staff quotation created for the client", quoteRes.ok && Boolean(quoteId), `${quoteRes.status} ${quoteId}`);
const contract = await (await A(`/api/leads/${lead.id}`, { method: "PUT", body: JSON.stringify({ status: "Contracted" }) })).json();
const invoiceId = contract.contractProvision?.invoiceId;
check("J6 contracting the lead converts the quotation into an invoice", Boolean(invoiceId), JSON.stringify(contract.contractProvision || {}).slice(0, 200));
const inv = (await (await A(`/api/admin/invoices/${invoiceId}`)).json()).invoice;
check("J6 invoice is linked to the lead, quotation and customer", inv.leadId === lead.id && inv.quotationId === quoteId && Boolean(inv.customerId), `lead=${inv.leadId} quote=${inv.quotationId} customer=${inv.customerId}`);
const grandTotal = inv.grandTotal;

// Browser: Accounts user records a partial payment; the first response is lost, then the user double clicks.
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await staffLogin(page, "t_admin");
await page.getByRole("button", { name: "Accounts", exact: true }).first().click();
await page.getByRole("button", { name: "Sales", exact: true }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/j6-00-sales-list.png` });
await page.getByText(inv.invoiceNumber).first().click();
await page.getByPlaceholder("Add payment amount").waitFor({ timeout: 20000 });
await page.getByPlaceholder("Add payment amount").fill("350000");
await page.getByPlaceholder("Payment note").fill("Advance via bank");
let posts = 0;
await page.route(`**/api/admin/invoices/${invoiceId}/payments`, async (route) => {
  posts++;
  if (posts === 1) { await route.fetch(); return route.abort("connectionreset"); }
  return route.continue();
});
await page.getByRole("button", { name: "Record additional payment" }).click();
await page.waitForTimeout(1500);
const afterLoss = Number(sql(`select count(*) from invoice_payments where invoice_id='${invoiceId}'`));
await page.getByRole("button", { name: "Record additional payment" }).dblclick();
await page.getByText(/Payment (was already recorded|recorded)/).first().waitFor({ timeout: 20000 });
await page.screenshot({ path: `${SHOTS}/j6-01-payment-recorded.png` });
const rows = sql(`select amount from invoice_payments where invoice_id='${invoiceId}'`).split("\n").filter(Boolean);
check("J6 lost response + retry + double click recorded the payment once", afterLoss === 1 && rows.length === 1 && Number(rows[0]) === 350000, `rows=${rows.join(",")} posts=${posts}`);
const expectedBalance = Math.round((grandTotal - 350000) * 100) / 100;
const db1 = sql(`select paid_amount||'|'||balance_due||'|'||payment_status from invoices where id='${invoiceId}'`).split("|");
check("J6 balance after partial payment matches independent calculation", Number(db1[0]) === 350000 && Number(db1[1]) === expectedBalance && db1[2] === "Partial", `${db1.join(" / ")} expected balance ${expectedBalance}`);

// Overpayment attempt from the UI shows an actionable error.
await page.getByPlaceholder("Add payment amount").fill(String(expectedBalance + 1));
await page.getByRole("button", { name: "Record additional payment" }).click();
const overText = await page.getByText(/exceeds the balance due/).first().innerText({ timeout: 20000 });
check("J6 overpayment is refused with the balance due", /PKR/.test(overText), overText);
await page.screenshot({ path: `${SHOTS}/j6-02-overpayment-refused.png` });

// Saving the invoice form after the payment keeps the ledger total.
await page.getByRole("button", { name: /^Save$/ }).first().click();
await page.getByText(/Invoice saved/).first().waitFor({ timeout: 20000 }).catch(() => {});
const db2 = sql(`select paid_amount||'|'||balance_due from invoices where id='${invoiceId}'`).split("|");
check("J6 saving the invoice after a payment keeps paid = ledger", Number(db2[0]) === 350000 && Number(db2[1]) === expectedBalance, db2.join(" / "));
const audit = sql(`select action||': '||details from activity_logs where details like '%${invoiceId}%' order by timestamp`).split("\n").filter(Boolean);
check("J6 financial actions are in the audit trail", audit.some((a) => a.startsWith("Invoice Payment Recorded")), audit.map((a) => a.slice(0, 90)).join(" | "));
await browser.close();
fs.writeFileSync(`${STATE}/j6-ids.json`, JSON.stringify({ leadId: lead.id, invoiceId, customerId: inv.customerId, phone }));
save(`${STATE}/j6-results.json`);
