import type { InvoiceRecord } from "./src/lib/invoices.ts";

export type BrandingConfig = {
  companyName?: string;
  officeAddress?: string;
  phoneNumbers?: string;
  billingEmail?: string;
  websiteUrl?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  terms?: string;
  bankAccounts?: Array<{
    bankName?: string;
    accountTitle?: string;
    accountNumber?: string;
    iban?: string;
    branchCode?: string;
  }>;
};

const fmt = (n: number) => "Rs. " + Math.round(n || 0).toLocaleString("en-PK");

export function compileInvoicePDFHtml(
  invoice: InvoiceRecord,
  branding: BrandingConfig = {}
): string {
  const primary = branding.primaryColor || "#f59e0b";
  const company = branding.companyName || "Sunchaser Energy Systems";
  const address = branding.officeAddress || "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore";
  const phones = branding.phoneNumbers || "0309-0236666, 0330-7776444";
  const email = branding.billingEmail || "billing@sunchaser-energy.com";
  const website = branding.websiteUrl || "www.sunchaser-energy.com";
  const logo = branding.logoUrl || "/sunchaser-logo.svg";
  const terms =
    invoice.terms ||
    branding.terms ||
    "Payment is due by the due date shown. Late payments may incur charges. Thank you for choosing Sunchaser.";

  const bankRows = (branding.bankAccounts || [])
    .filter((b: { isActive?: boolean }) => b.isActive !== false)
    .map(
      (b) =>
        `<tr><td>${b.bankName || ""}</td><td>${b.accountTitle || ""}</td><td>${b.accountNumber || ""}</td><td>${b.iban || ""}</td></tr>`
    )
    .join("");

  const itemRows = (invoice.items || [])
    .map(
      (it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.description)}</td>
        <td class="num">${it.qty}</td>
        <td>${escapeHtml(it.unit || "pcs")}</td>
        <td class="num">${fmt(it.rate)}</td>
        <td class="num">${it.taxPercent || 0}%</td>
        <td class="num">${fmt(it.discountAmount || 0)}</td>
        <td class="num">${fmt(it.lineTotal)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: Inter, sans-serif; color: #0f172a; margin: 0; padding: 24px; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .wrap { max-width: 210mm; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 28px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${primary}; padding-bottom: 16px; margin-bottom: 20px; }
    .logo { height: 56px; max-width: 180px; object-fit: contain; }
    h1 { margin: 0; font-size: 22px; color: #0f172a; }
    .inv-meta { text-align: right; font-size: 10px; color: #64748b; }
    .inv-meta strong { color: #0f172a; font-size: 12px; display: block; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
    .box h3 { margin: 0 0 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: ${primary}; }
    table.items { width: 100%; border-collapse: collapse; margin: 16px 0; }
    table.items th { background: #0f172a; color: #fff; font-size: 9px; padding: 8px 6px; text-align: left; }
    table.items td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .totals { float: right; width: 260px; margin-top: 8px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals .grand { font-weight: 800; font-size: 14px; border-top: 2px solid ${primary}; margin-top: 8px; padding-top: 8px; color: ${primary}; }
    .status { display: inline-block; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 10px; background: #fef3c7; color: #92400e; }
    .banks { margin-top: 24px; clear: both; }
    .banks table { width: 100%; border-collapse: collapse; font-size: 9px; }
    .banks th { background: #f1f5f9; text-align: left; padding: 6px; }
    .terms { margin-top: 20px; font-size: 9px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 12px; }
    .sig { margin-top: 40px; display: flex; justify-content: space-between; }
    .sig-line { border-top: 1px solid #94a3b8; width: 200px; padding-top: 6px; font-size: 9px; color: #64748b; }
    @media print { body { padding: 0; } .wrap { border: none; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <img class="logo" src="${escapeAttr(logo)}" alt="${escapeAttr(company)}"/>
        <h1>${escapeHtml(company)}</h1>
        <div style="font-size:10px;color:#64748b;margin-top:4px">${escapeHtml(address)}</div>
        <div style="font-size:10px;color:#64748b">${escapeHtml(phones)} · ${escapeHtml(email)}</div>
        <div style="font-size:10px;color:#64748b">${escapeHtml(website)}</div>
      </div>
      <div class="inv-meta">
        <strong>TAX INVOICE</strong>
        <div>No: ${escapeHtml(invoice.invoiceNumber)}</div>
        <div>Date: ${escapeHtml(invoice.invoiceDate)}</div>
        <div>Due: ${escapeHtml(invoice.dueDate || "—")}</div>
        <div style="margin-top:8px"><span class="status">${escapeHtml(invoice.paymentStatus)}</span></div>
      </div>
    </div>
    <div class="grid">
      <div class="box">
        <h3>Bill To</h3>
        <div><strong>${escapeHtml(invoice.customerName)}</strong></div>
        <div>${escapeHtml(invoice.customerPhone || "")}</div>
        <div>${escapeHtml(invoice.customerAddress || "")}</div>
        ${invoice.cnicNtn ? `<div>CNIC/NTN: ${escapeHtml(invoice.cnicNtn)}</div>` : ""}
      </div>
      <div class="box">
        <h3>Reference</h3>
        ${invoice.quotationId ? `<div>Quotation: ${escapeHtml(invoice.quotationId)}</div>` : ""}
        ${invoice.leadId ? `<div>Lead: ${escapeHtml(invoice.leadId)}</div>` : ""}
        ${invoice.projectId ? `<div>Project: ${escapeHtml(invoice.projectId)}</div>` : ""}
      </div>
    </div>
    <table class="items">
      <thead>
        <tr>
          <th>#</th><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Tax</th><th>Disc.</th><th>Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows || '<tr><td colspan="8">No line items</td></tr>'}</tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></div>
      <div><span>Discount</span><span>- ${fmt(invoice.discountAmount)}</span></div>
      <div><span>Tax</span><span>${fmt(invoice.taxAmount)}</span></div>
      <div class="grand"><span>Grand Total</span><span>${fmt(invoice.grandTotal)}</span></div>
      <div><span>Paid</span><span>${fmt(invoice.paidAmount)}</span></div>
      <div><span>Balance Due</span><span>${fmt(invoice.balanceDue)}</span></div>
    </div>
    ${
      bankRows
        ? `<div class="banks"><h3 style="font-size:10px;text-transform:uppercase;color:${primary}">Bank Accounts</h3>
        <table><thead><tr><th>Bank</th><th>Title</th><th>Account</th><th>IBAN</th></tr></thead><tbody>${bankRows}</tbody></table></div>`
        : ""
    }
    <div class="terms"><strong>Terms &amp; Conditions</strong><br/>${escapeHtml(terms)}</div>
    <div class="sig">
      <div class="sig-line">Authorized Signature — ${escapeHtml(company)}</div>
      <div class="sig-line">Customer Acknowledgement</div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
