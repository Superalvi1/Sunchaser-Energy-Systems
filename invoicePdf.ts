import type { InvoiceRecord } from "./src/lib/invoices.ts";
import { amountInWordsPkr } from "./src/lib/amountInWords.ts";
import type { InvoicePdfOptions, InvoiceProjectInfo } from "./src/lib/invoicePdfMeta.ts";
import { stripInvoiceMeta } from "./src/lib/invoicePdfMeta.ts";

export type BrandingConfig = {
  companyName?: string;
  officeAddress?: string;
  officeLocations?: string[];
  phoneNumbers?: string;
  billingEmail?: string;
  websiteUrl?: string;
  logoUrl?: string;
  invoiceLogoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  terms?: string;
  signatureUrl?: string;
  bankAccountsImageUrl?: string;
  bankAccounts?: Array<{
    bankName?: string;
    accountTitle?: string;
    accountNumber?: string;
    iban?: string;
    branchCode?: string;
    isActive?: boolean;
  }>;
};

const fmt = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  const parts = String(d).slice(0, 10).split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}

function formatTime(t: string | null | undefined) {
  if (!t) {
    return new Date().toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
  }
  return t;
}

export function normalizeBankAccounts(accounts: any[] = []) {
  return (accounts || [])
    .filter((b) => b && b.isActive !== false && b.is_active !== false)
    .map((b) => ({
      bankName: String(b.bankName || b.bank_name || "").trim(),
      accountTitle: String(b.accountTitle || b.account_title || b.title || "").trim(),
      accountNumber: String(b.accountNumber || b.account_number || b.accountNo || "").trim(),
      iban: String(b.iban || "").trim(),
      branchCode: String(b.branchCode || b.branch_code || "").trim(),
    }))
    .filter((b) => b.bankName || b.accountNumber || b.iban);
}

function paymentQrUrl(invoice: InvoiceRecord, branding: BrandingConfig): string {
  const company = branding.companyName || "Sunchaser Energy Systems";
  const text = [
    company,
    `Invoice: ${invoice.invoiceNumber}`,
    `Total: ${fmt(invoice.grandTotal)}`,
    `Balance: ${fmt(invoice.balanceDue)}`,
    `Due: ${formatDate(invoice.dueDate)}`,
  ].join("\n");
  return `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(text)}`;
}

function statusBadgeClass(status: string): string {
  const s = String(status || "Unpaid");
  if (s === "Paid") return "badge-paid";
  if (s === "Partial") return "badge-partial";
  if (s === "Overdue") return "badge-overdue";
  return "badge-unpaid";
}

function projectRows(project?: InvoiceProjectInfo): string {
  const rows: [string, string][] = [
    ["Project Number", project?.projectNumber || "—"],
    ["System Size", project?.systemSize || "—"],
    ["System Type", project?.systemType || "—"],
    ["Panel Brand", project?.panelBrand || "—"],
    ["Inverter Brand", project?.inverterBrand || "—"],
    ["Battery Brand", project?.batteryBrand || "—"],
    ["Structure Type", project?.structureType || "—"],
    ["Net Metering Status", project?.netMeteringStatus || "—"],
  ];
  return rows
    .map(
      ([k, v]) =>
        `<tr><td class="proj-k">${escapeHtml(k)}</td><td class="proj-v">${escapeHtml(v)}</td></tr>`
    )
    .join("");
}

export function compileInvoicePDFHtml(
  invoice: InvoiceRecord,
  branding: BrandingConfig = {},
  options: InvoicePdfOptions = {}
): string {
  const purple = branding.primaryColor || "#7c6cf0";
  const navy = branding.secondaryColor || "#1a2b4c";
  const gold = branding.accentColor || "#c5a028";
  const company = branding.companyName || "Sunchaser Energy Systems";
  const offices = branding.officeLocations?.length
    ? branding.officeLocations
    : (branding.officeAddress || "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
  const phones = branding.phoneNumbers || "0321-8486752, 0309-0236666";
  const email = branding.billingEmail || "ceo.sunchaser@gmail.com";
  const website = branding.websiteUrl || "www.sunchaser-energy.com";
  const logo = branding.invoiceLogoUrl || branding.logoUrl || "/sunchaser-logo.png";
  const signature = branding.signatureUrl || "/sunchaser-ceo-signature.png";
  const bankImage = branding.bankAccountsImageUrl || "/sunchaser-bank-accounts.png";
  const terms =
    stripInvoiceMeta(invoice.terms || "") ||
    branding.terms ||
    "Payment is due by the due date shown. Bank transfer details are on page 2. Thank you for choosing Sunchaser Energy Systems.";

  const banks = normalizeBankAccounts(branding.bankAccounts);
  const bankFallbackHtml = banks.length
    ? banks
        .map(
          (b) =>
            `<p class="bank-fallback"><strong>${escapeHtml(b.bankName)}</strong> — ${escapeHtml(b.accountTitle)} · A/C ${escapeHtml(b.accountNumber)}${b.iban ? ` · IBAN ${escapeHtml(b.iban)}` : ""}</p>`
        )
        .join("")
    : `<p class="bank-fallback">Contact accounts for payment details.</p>`;

  const itemRows = (invoice.items || [])
    .map((it, i) => {
      const title = it.itemName || it.description;
      const desc = it.notes || (it.itemName && it.description !== it.itemName ? it.description : "");
      return `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="item-cell">
          <div class="item-title">${escapeHtml(title)}</div>
          ${desc ? `<div class="item-desc">${escapeHtml(desc)}</div>` : ""}
        </td>
        <td class="c num">${it.qty}</td>
        <td class="c num">${fmt(it.rate)}</td>
        <td class="c num">${fmt(it.lineTotal)}</td>
      </tr>`;
    })
    .join("");

  const totalQty = (invoice.items || []).reduce((s, it) => s + Number(it.qty || 0), 0);
  const words = invoice.amountInWords || amountInWordsPkr(invoice.grandTotal);
  const officeLine = offices.map((o) => escapeHtml(o)).join(" · ");
  const currentBalance = Number(invoice.previousBalance || 0) + Number(invoice.balanceDue || 0);
  const grand = Number(invoice.grandTotal || 0);
  const paid = Number(invoice.paidAmount || 0);
  const balance = Number(invoice.balanceDue || 0);
  const pctPaid = grand > 0 ? Math.min(100, Math.round((paid / grand) * 100)) : 0;
  const qrUrl = paymentQrUrl(invoice, branding);
  const clientPhoto = options.clientPhotoUrl?.trim();
  const visibleNotes = stripInvoiceMeta(invoice.notes);
  const status = String(invoice.paymentStatus || "Unpaid");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Invoice ${escapeHtml(invoice.invoiceNumber)} — ${escapeHtml(company)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { font-family: Inter, system-ui, sans-serif; color: #0f172a; margin: 0; padding: 0; font-size: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #f1f5f9; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto 12px; padding: 10mm 12mm; background: #fff; page-break-after: always; position: relative; }
    .page:last-child { page-break-after: auto; margin-bottom: 0; }
    @media screen and (max-width: 800px) { .page { width: 100%; min-height: auto; padding: 16px; } }
    @media print { body { background: #fff; padding: 0; } .page { margin: 0; box-shadow: none; } .no-print { display: none; } }
    .v3-tag { position: absolute; top: 8mm; right: 12mm; font-size: 7px; font-weight: 800; letter-spacing: 0.12em; color: ${gold}; text-transform: uppercase; }
    .hero { display: flex; gap: 14px; align-items: flex-start; border-bottom: 3px solid ${gold}; padding-bottom: 12px; margin-bottom: 12px; }
    .hero img.logo { height: 56px; width: auto; object-fit: contain; }
    .hero-meta { flex: 1; }
    .hero-meta h1 { margin: 0; font-size: 18px; font-weight: 800; color: ${navy}; }
    .hero-meta .sub { font-size: 8.5px; color: #64748b; margin-top: 4px; line-height: 1.5; }
    .doc-badge { background: ${navy}; color: #fff; padding: 10px 18px; border-radius: 0 0 0 16px; font-size: 22px; font-weight: 800; letter-spacing: 0.02em; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    @media (max-width: 520px) { .grid-2 { grid-template-columns: 1fr; } }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .box-h { background: ${purple}; color: #fff; padding: 6px 10px; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
    .box-b { padding: 10px; font-size: 9.5px; line-height: 1.45; }
    .bill-photo { float: right; width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 2px solid ${gold}; margin: 0 0 6px 8px; }
    .meta-table { width: 100%; border-collapse: collapse; font-size: 9px; }
    .meta-table td { padding: 3px 0; vertical-align: top; }
    .meta-table td:first-child { color: #64748b; font-weight: 600; width: 42%; }
    .meta-table td:last-child { text-align: right; font-weight: 700; }
    .proj-table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
    .proj-table td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
    .proj-k { color: #64748b; font-weight: 600; width: 48%; }
    .proj-v { font-weight: 700; color: ${navy}; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-paid { background: #d1fae5; color: #065f46; }
    .badge-partial { background: #fef3c7; color: #92400e; }
    .badge-unpaid { background: #f1f5f9; color: #475569; }
    .badge-overdue { background: #fee2e2; color: #991b1b; }
    .pay-progress { margin: 12px 0; padding: 10px; background: linear-gradient(135deg, ${navy}08, ${purple}12); border: 1px solid #e2e8f0; border-radius: 8px; }
    .pay-progress h4 { margin: 0 0 8px; font-size: 8px; color: ${navy}; text-transform: uppercase; letter-spacing: 0.08em; }
    .pay-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; text-align: center; margin-bottom: 8px; }
    .pay-stats .lbl { font-size: 7px; color: #64748b; text-transform: uppercase; }
    .pay-stats .val { font-size: 11px; font-weight: 800; color: ${navy}; margin-top: 2px; }
    .pay-stats .val.gold { color: ${gold}; }
    .pay-stats .val.green { color: #059669; }
    .bar-track { height: 10px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, ${gold}, ${purple}); border-radius: 999px; }
    .bar-pct { text-align: right; font-size: 8px; font-weight: 700; color: ${purple}; margin-top: 4px; }
    .qr-pay { display: flex; gap: 12px; align-items: center; margin: 12px 0; padding: 10px; border: 1px dashed ${gold}; border-radius: 8px; background: #fffbeb; }
    .qr-pay img { width: 88px; height: 88px; border-radius: 6px; }
    table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    table.items th { background: ${purple}; color: #fff; padding: 8px 6px; text-align: left; font-size: 8.5px; font-weight: 700; }
    table.items td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; vertical-align: top; }
    table.items tr.total-row td { background: ${navy}; color: #fff; font-weight: 800; border: none; }
    td.c { text-align: center; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .item-title { font-weight: 700; font-size: 10px; }
    .item-desc { font-size: 8px; color: #475569; margin-top: 2px; }
    .footer-1 { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 12px; }
    @media (max-width: 520px) { .footer-1 { grid-template-columns: 1fr; } }
    .words { font-style: italic; font-size: 9px; margin: 8px 0; color: #334155; }
    .terms-box { font-size: 8px; color: #475569; line-height: 1.4; }
    .sig-block { margin-top: 12px; }
    .sig-block img { max-height: 52px; display: block; }
    .sig-label { border-top: 1px solid #94a3b8; margin-top: 4px; padding-top: 4px; font-size: 8px; color: #64748b; }
    .totals-box { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .totals-box .row { display: flex; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-size: 9px; }
    .totals-box .row.grand { background: ${purple}; color: #fff; font-weight: 800; font-size: 11px; border: none; }
    .totals-box .row.balance { font-weight: 800; color: ${navy}; background: #f8fafc; }
    .page-2-title { background: ${navy}; color: #fff; padding: 12px 16px; font-size: 14px; font-weight: 800; margin: -10mm -12mm 16px; }
    .bank-img-wrap { text-align: center; }
    .bank-img-wrap img { max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
    .bank-fallback { font-size: 9px; margin: 8px 0; line-height: 1.5; }
    .ack-page .ack-banner { background: ${navy}; color: #fff; padding: 14px 20px; font-size: 16px; font-weight: 800; margin: -10mm -12mm 20px; border-radius: 0 0 24px 0; }
    .ack-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; font-size: 10px; min-height: 120px; }
    .ack-sign { border-top: 2px solid ${navy}; margin-top: 48px; padding-top: 8px; font-size: 9px; color: #64748b; }
    .scissors { text-align: center; color: #cbd5e1; font-size: 11px; margin: 16px 0 8px; letter-spacing: 2px; }
    .print-hint { text-align: center; padding: 8px; font-size: 10px; color: #64748b; }
  </style>
</head>
<body>
  <p class="print-hint no-print">Sunchaser Premium Invoice v3 — Print or Save as PDF (Ctrl/Cmd+P). Optimized for A4, mobile preview, and tablet.</p>

  <!-- PAGE 1 -->
  <div class="page page-1">
    <span class="v3-tag">Premium Invoice v3</span>
    <div class="hero">
      <img class="logo" src="${escapeAttr(logo)}" alt="${escapeAttr(company)}"/>
      <div class="hero-meta">
        <h1>${escapeHtml(company)}</h1>
        <div class="sub">
          📞 ${escapeHtml(phones)} · ✉ ${escapeHtml(email)}<br/>
          🌐 ${escapeHtml(website)}<br/>
          📍 ${officeLine}
        </div>
      </div>
      <div class="doc-badge">TAX INVOICE</div>
    </div>

    <div class="grid-2">
      <div class="box">
        <div class="box-h">Bill To</div>
        <div class="box-b">
          ${clientPhoto ? `<img class="bill-photo" src="${escapeAttr(clientPhoto)}" alt="Client"/>` : ""}
          <strong style="font-size:12px">${escapeHtml(invoice.customerName)}</strong><br/>
          ${escapeHtml(invoice.customerAddress || "")}<br/>
          ${invoice.customerPhone ? `Tel: ${escapeHtml(invoice.customerPhone)}<br/>` : ""}
          ${invoice.cnicNtn ? `CNIC/NTN: ${escapeHtml(invoice.cnicNtn)}` : ""}
        </div>
      </div>
      <div class="box">
        <div class="box-h">Invoice Details</div>
        <div class="box-b">
          <table class="meta-table">
            <tr><td>Invoice No.</td><td>${escapeHtml(invoice.invoiceNumber)}</td></tr>
            <tr><td>Date</td><td>${formatDate(invoice.invoiceDate)}</td></tr>
            <tr><td>Time</td><td>${escapeHtml(formatTime(invoice.invoiceTime))}</td></tr>
            <tr><td>Due Date</td><td>${formatDate(invoice.dueDate)}</td></tr>
            ${invoice.poNumber ? `<tr><td>PO No.</td><td>${escapeHtml(invoice.poNumber)}</td></tr>` : ""}
            <tr><td>Status</td><td><span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span></td></tr>
          </table>
        </div>
      </div>
    </div>

    <div class="box" style="margin-bottom:12px">
      <div class="box-h">Project Information</div>
      <div class="box-b" style="padding:0">
        <table class="proj-table">${projectRows(options.project)}</table>
      </div>
    </div>

    <div class="pay-progress">
      <h4>Payment Progress</h4>
      <div class="pay-stats">
        <div><div class="lbl">Total Amount</div><div class="val">${fmt(grand)}</div></div>
        <div><div class="lbl">Received</div><div class="val green">${fmt(paid)}</div></div>
        <div><div class="lbl">Balance Due</div><div class="val gold">${fmt(balance)}</div></div>
        <div><div class="lbl">% Paid</div><div class="val">${pctPaid}%</div></div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pctPaid}%"></div></div>
      <div class="bar-pct">${pctPaid}% of invoice amount received</div>
    </div>

    <div class="qr-pay">
      <img src="${escapeAttr(qrUrl)}" alt="Payment QR"/>
      <div>
        <strong style="color:${navy};font-size:11px">Scan to Pay / Share Payment Details</strong>
        <p style="margin:4px 0 0;font-size:8.5px;color:#475569;line-height:1.45">
          QR encodes invoice number, total, and balance. Use bank details on page 2 for transfer.
          ${invoice.paymentMode ? `<br/><strong>Mode:</strong> ${escapeHtml(invoice.paymentMode)}` : ""}
        </p>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th>Item</th>
          <th style="width:48px;text-align:center">Qty</th>
          <th style="width:80px;text-align:right">Rate</th>
          <th style="width:84px;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || '<tr><td colspan="5">No line items</td></tr>'}
        <tr class="total-row">
          <td colspan="2"></td>
          <td class="c">${totalQty}</td>
          <td></td>
          <td class="num">${fmt(invoice.grandTotal)}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer-1">
      <div>
        ${visibleNotes ? `<p style="font-size:9px"><strong>Notes:</strong> ${escapeHtml(visibleNotes)}</p>` : ""}
        <div class="words"><strong>Amount in words:</strong> ${escapeHtml(words)}</div>
        <div class="terms-box"><strong>Terms &amp; Conditions</strong><br/>${escapeHtml(terms)}</div>
        <div class="sig-block">
          <img src="${escapeAttr(signature)}" alt="CEO Signature" onerror="this.style.display='none'"/>
          <div style="font-size:9px;margin-top:6px;font-weight:700">For: ${escapeHtml(company)}</div>
          <div class="sig-label">Muhammad Allauddin — CEO · Authorized Signatory</div>
        </div>
      </div>
      <div class="totals-box">
        <div class="row"><span>Sub Total</span><span>${fmt(invoice.subtotal)}</span></div>
        ${invoice.discountAmount > 0 ? `<div class="row"><span>Discount</span><span>- ${fmt(invoice.discountAmount)}</span></div>` : ""}
        ${invoice.taxAmount > 0 ? `<div class="row"><span>Tax</span><span>${fmt(invoice.taxAmount)}</span></div>` : ""}
        <div class="row grand"><span>Total</span><span>${fmt(invoice.grandTotal)}</span></div>
        <div class="row"><span>Received</span><span>${fmt(invoice.paidAmount)}</span></div>
        <div class="row balance"><span>Balance Due</span><span>${fmt(invoice.balanceDue)}</span></div>
        ${invoice.paymentTerms ? `<div class="row"><span>Payment Terms</span><span>${escapeHtml(invoice.paymentTerms)}</span></div>` : ""}
        <div class="row"><span>Previous Balance</span><span>${fmt(invoice.previousBalance || 0)}</span></div>
        <div class="row balance"><span>Current Balance</span><span>${fmt(currentBalance)}</span></div>
      </div>
    </div>
  </div>

  <!-- PAGE 2 — Bank accounts -->
  <div class="page page-2">
    <div class="page-2-title">Company Bank Accounts — Sunchaser Energy Systems</div>
    <p style="font-size:9px;color:#64748b;margin-bottom:12px">Transfer payment to any account below. Include invoice number <strong>${escapeHtml(invoice.invoiceNumber)}</strong> in the transfer reference.</p>
    <div class="bank-img-wrap">
      <img src="${escapeAttr(bankImage)}" alt="Sunchaser Bank Accounts" onerror="this.style.display='none'"/>
    </div>
    <div style="margin-top:16px">${bankFallbackHtml}</div>
  </div>

  <!-- PAGE 3 — Acknowledgement -->
  <div class="page page-3 ack-page">
    <div class="scissors">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>
    <div class="ack-banner">CUSTOMER ACKNOWLEDGEMENT</div>
    <p style="font-size:10px;color:#475569;margin-bottom:16px">
      I acknowledge receipt of the above invoice and confirm the solar project details. Payment will be made as per agreed terms.
    </p>
    <div class="ack-grid">
      <div>
        <strong>Invoice To</strong><br/><br/>
        ${escapeHtml(invoice.customerName)}<br/>
        ${escapeHtml(invoice.customerAddress || "")}<br/>
        ${invoice.customerPhone ? escapeHtml(invoice.customerPhone) : ""}
      </div>
      <div>
        <strong>Invoice Summary</strong><br/><br/>
        No: ${escapeHtml(invoice.invoiceNumber)}<br/>
        Date: ${formatDate(invoice.invoiceDate)}<br/>
        Total: ${fmt(invoice.grandTotal)} · Balance: ${fmt(invoice.balanceDue)}<br/>
        Status: <span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>
      </div>
    </div>
    <div style="margin-top:24px;font-size:9px">
      <strong>Project:</strong> ${escapeHtml(options.project?.projectNumber || "—")} ·
      ${escapeHtml(options.project?.systemSize || "—")} ·
      ${escapeHtml(options.project?.panelBrand || "—")}
    </div>
    <div class="ack-grid" style="margin-top:32px">
      <div>
        <div class="ack-sign">Customer Signature &amp; Date</div>
      </div>
      <div>
        <div class="ack-sign">Official Stamp (if applicable)</div>
      </div>
    </div>
    <p style="text-align:center;margin-top:24px;font-size:8px;color:#94a3b8">${escapeHtml(company)} · ${escapeHtml(phones)}</p>
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
