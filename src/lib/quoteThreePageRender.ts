import { STANDARD_QUOTATION_PAGES } from "./autoSizer";
import {
  boqPdfSectionCss,
  buildBoqTotalsHtml,
  renderBoqTableBodyHtml,
  renderBoqTableHeadHtml,
  type BoqPdfRow,
} from "./quoteBoqPdf";
import {
  resolveCustomerFacingBoq,
  THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE,
  THREE_PAGE_BOQ_TOTAL_MISMATCH_MESSAGE,
} from "./quoteCustomerBoq";
import { computeNetProposalValue, resolveQuoteDiscountAmount } from "./quoteDiscount";
import {
  escapeHtml,
  formatSiteLocation,
  getQuotePdfAppBaseUrl,
  mergeQuoteWithLead,
  OFFICIAL_QUOTE_LOGO_PATH,
  quotePdfPrintCss,
  quotePdfShellCss,
  resolveQuotePdfLogoUrl,
} from "./quotePdfLayout";
import { normalizeRows } from "./normalizeRows";
import { resolveQuoteValidityDays } from "./quoteValidity";
import {
  EXISTING_FALLBACK_QUOTE_TERMS,
  paginateClauses,
  paginateResolvedTerms,
  resolveQuoteTerms,
  resolveQuoteTermsClauses,
  shouldRenderExtraCommercialCard,
  TERMS_PAGE_CHAR_BUDGET,
} from "./quoteTermsSnapshot";


export { quoteBoqOverflow, THREE_PAGE_BOQ_COMPACT_MAX_WEIGHT } from "./quoteBoqPdf";
export {
  THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE,
  THREE_PAGE_BOQ_TOTAL_MISMATCH_MESSAGE,
};

export const THREE_PAGE_QUOTATION_PAGE_COUNT = 3;
export const THREE_PAGE_TERMS_MAX_CHARS = TERMS_PAGE_CHAR_BUDGET;
export const THREE_PAGE_BOQ_OVERFLOW_MESSAGE =
  "Quotation contains too many line items for the standard 3-page format. Please consolidate or group items before generating the final PDF.";
export const THREE_PAGE_TERMS_OVERFLOW_MESSAGE =
  "Terms & Conditions continue onto additional pages so no clauses are truncated.";

export type ThreePageQuoteMode = "auto" | "manual";

export interface ThreePageRenderResult {
  html: string;
  pageCount: number;
  boqOverflow: boolean;
  boqOverflowMessage: string | null;
  termsOverflow: boolean;
  exportBlocked: boolean;
  exportBlockReason: string | null;
  itemCount: number;
  validityDays: number;
  pages: typeof STANDARD_QUOTATION_PAGES;
  customerBoqConsolidated: boolean;
  originalBoqOverflow: boolean;
}

function formatPKR(val: number): string {
  if (val === undefined || val === null || Number.isNaN(Number(val))) return "Rs. 0";
  return "Rs. " + Math.round(Number(val)).toLocaleString("en-US");
}

function formatLongDate(raw: unknown): string {
  const d = raw ? new Date(String(raw)) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
  }
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
}

function addDays(raw: unknown, days: number): Date {
  const d = raw ? new Date(String(raw)) : new Date();
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function snapshotRows(quoteObj: any): BoqPdfRow[] {
  const raw = quoteObj?.boqRows || quoteObj?.boqItems || [];
  return normalizeRows(raw) as BoqPdfRow[];
}

export { resolveQuoteTermsClauses, EXISTING_FALLBACK_QUOTE_TERMS };

/** Historical quotes without systemType must not be labeled Hybrid. */
export function resolveDisplayedSystemType(quoteObj: any, proposal?: any): string {
  const candidates = [
    quoteObj?.systemType,
    quoteObj?.system_type,
    proposal?.systemType,
    proposal?.system_type,
  ];
  for (const raw of candidates) {
    const s = String(raw ?? "").trim();
    if (s && s !== "Not specified") return s;
  }
  return "";
}

export function quotationSystemHeadline(systemKw: unknown, systemType: string): {
  kicker: string;
  subtitle: string;
} {
  const kwNum = Number(systemKw);
  const kwLabel = Number.isFinite(kwNum) && kwNum > 0 ? `${systemKw}kW` : "";
  const typeLabel = String(systemType || "").trim();
  const kicker = [kwLabel, typeLabel].filter(Boolean).join(" ");
  return {
    kicker: kicker || "Solar",
    subtitle: "Solar Power System",
  };
}

export function quoteTermsOverflow(terms: string[]): { overflow: boolean; charCount: number } {
  const charCount = terms.reduce((sum, t) => sum + String(t || "").length, 0);
  return { overflow: charCount > THREE_PAGE_TERMS_MAX_CHARS || terms.length > 16, charCount };
}

function resolveLogoSrc(activeState: any, appBase: string): string {
  const pdfRow = (activeState?.quotePdfSettings || [])[0] || {};
  const settingsRows = Array.isArray(activeState?.settings) ? activeState.settings : [];
  const keyed = settingsRows.find((s: any) => s?.key === "companyLogo" || s?.key === "company_logo");
  const companyLogo =
    (typeof keyed?.value === "string" && keyed.value) ||
    (keyed?.value && typeof keyed.value === "object" && keyed.value.url) ||
    "";
  return resolveQuotePdfLogoUrl(
    pdfRow.logoUrl || pdfRow.logo_url || companyLogo || OFFICIAL_QUOTE_LOGO_PATH,
    appBase
  );
}

function resolveCompany(activeState: any): {
  companyName: string;
  officeAddress: string;
  phoneNumbers: string;
  billingEmail: string;
  websiteUrl: string;
} {
  const pdf = (activeState?.quotePdfSettings || [])[0] || {};
  return {
    companyName: pdf.companyName || pdf.company_name || "SUNCHASER ENERGY SYSTEMS",
    officeAddress: pdf.officeAddress || pdf.office_address || "Plaza No. 47-MB, 2nd Floor, DHA Phase 6, Lahore",
    phoneNumbers: pdf.hotlinePhones || pdf.hotline_phones || "0309-0236666, 0330-7776444",
    billingEmail: pdf.billingEmail || pdf.billing_email || "ceo.sunchaser@gmail.com",
    websiteUrl: pdf.websiteUrl || pdf.website_url || "www.sunchaserenergy.co",
  };
}

function pageFooter(
  settings: ReturnType<typeof resolveCompany>,
  docId: string,
  pageNum: number,
  totalPages: number
): string {
  return `
    <div class="page-footer">
      <div>${escapeHtml(settings.companyName)} · ${escapeHtml(settings.officeAddress)}</div>
      <div class="footer-doc-id">${escapeHtml(docId)} · Page ${pageNum} of ${totalPages}</div>
    </div>
  `;
}

function pageHeader(logoSrc: string, settings: ReturnType<typeof resolveCompany>, title: string): string {
  return `
    <div class="page-header-logo">
      <div style="display:flex;align-items:center;gap:10px;">
        ${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(settings.companyName)}" style="max-height:36px;max-width:120px;object-fit:contain;" />` : ""}
        <div class="header-company-name">${escapeHtml(settings.companyName)}</div>
      </div>
      <div style="font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#d97706;">${escapeHtml(title)}</div>
    </div>
  `;
}

export function compileThreePageQuotationHtml(
  quoteObj: any,
  leadObj: any,
  activeState: any,
  options: { mode?: ThreePageQuoteMode; hideActionBar?: boolean } = {}
): ThreePageRenderResult {
  const proposal = mergeQuoteWithLead(quoteObj, leadObj);
  const settings = resolveCompany(activeState);
  const appBase = getQuotePdfAppBaseUrl();
  const logoSrc = resolveLogoSrc(activeState, appBase);
  const siteLocationLabel = formatSiteLocation(proposal);
  const quoteDateString = formatLongDate(proposal.quoteDate);
  const validity = resolveQuoteValidityDays(quoteObj, activeState);
  const expiryDateString = formatLongDate(addDays(proposal.quoteDate, validity.days));
  const docId = `SC-${String(leadObj?.id || "DRAFT").substring(0, 8).toUpperCase()}-${String(proposal.id || quoteObj?.id || "DRAFT").toUpperCase()}`;
  const systemKw = proposal.systemSizekW ?? quoteObj?.systemSizekW ?? "";
  const systemType = resolveDisplayedSystemType(quoteObj, proposal);
  const systemHeadline = quotationSystemHeadline(systemKw, systemType);
  const systemTypeLabel = systemType || "Solar";
  const panelCount = Number(quoteObj?.panelCount) || 0;
  const sourceRows = snapshotRows(quoteObj);
  const customerBoq = resolveCustomerFacingBoq(sourceRows);
  const overflowBlocked = customerBoq.blocked;
  const compact = customerBoq.consolidated || overflowBlocked;

  const { html: boqBody, calculatedGross } = renderBoqTableBodyHtml(customerBoq.rows, formatPKR);
  const grossTotal = customerBoq.originalTotal || calculatedGross || Number(quoteObj?.grandTotal) || 0;
  const resolvedDiscount = resolveQuoteDiscountAmount(grossTotal, {
    discountType: quoteObj?.discountType,
    discountValue: quoteObj?.discountValue,
    discount: quoteObj?.discount,
  });
  const taxEnabled = !!quoteObj?.taxEnabled;
  const taxRate = Number(quoteObj?.taxRate) || 0;
  const taxAmount = taxEnabled
    ? Number(quoteObj?.taxAmount) || Math.round(grossTotal * (taxRate / 100))
    : 0;
  const societyCharges = Number(quoteObj?.societyCharges) || 0;
  const netTotal = computeNetProposalValue(grossTotal, resolvedDiscount.discountAmount, {
    taxAmount,
    societyCharges,
  });
  const totalsHtml = buildBoqTotalsHtml({
    formatPKR,
    grossTotal,
    netTotal,
    discountAmount: resolvedDiscount.discountAmount,
    discountLabel: resolvedDiscount.discountLabel,
    taxEnabled,
    taxRate,
    taxAmount,
    societyCharges,
    customNotes: quoteObj?.customNotes,
  });

  const overflowBanner = overflowBlocked
    ? `<div data-sunchaser-overflow="boq" style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412;font-size:8.5px;font-weight:700;padding:5px 8px;border-radius:6px;margin:6px 0 8px;">
        ${escapeHtml(customerBoq.message || THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE)} All ${customerBoq.itemCount} priced lines are listed below for review — final PDF is blocked until this is resolved.
      </div>`
    : "";

  const resolvedTerms = resolveQuoteTerms(quoteObj, activeState);
  const clausePages = resolvedTerms.hasRichHtml ? null : paginateClauses(resolvedTerms.clauses);
  const termsPageBodies = clausePages
    ? clausePages.map((group, pageIndex) => {
        const start = clausePages.slice(0, pageIndex).reduce((sum, g) => sum + g.length, 0);
        return group
          .map(
            (clause, index) => `
        <div style="display:flex;margin-bottom:7px;font-size:10px;line-height:1.45;align-items:flex-start;">
          <span style="font-weight:800;color:#d97706;margin-right:6px;min-width:18px;">${start + index + 1}.</span>
          <span style="color:#334155;font-weight:500;">${escapeHtml(clause)}</span>
        </div>`
          )
          .join("");
      })
    : paginateResolvedTerms(resolvedTerms);
  if (!termsPageBodies.length) termsPageBodies.push("");
  const termsPageCount = Math.max(1, termsPageBodies.length);
  const termsOverflow = termsPageCount > 1;
  const totalPages = 2 + termsPageCount;
  const payment = String(quoteObj?.paymentSchedule || quoteObj?.paymentTerms || "").trim();
  const warranty = String(quoteObj?.warrantyTerms || "").trim();
  const showPaymentCard = shouldRenderExtraCommercialCard("payment", payment, resolvedTerms);
  const showWarrantyCard = shouldRenderExtraCommercialCard("warranty", warranty, resolvedTerms);
  const signatureHtml = `
        <div class="card quote-terms-signature" data-sunchaser-terms-signature="final" style="margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div>
            <div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:800;">Customer acceptance</div>
            <div style="border-bottom:1px solid #94a3b8;height:36px;margin-top:22px;"></div>
            <div style="font-size:9px;color:#475569;margin-top:4px;">Name / signature / date</div>
          </div>
          <div>
            <div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:800;">For Sunchaser Energy Systems</div>
            <div style="border-bottom:1px solid #94a3b8;height:36px;margin-top:22px;"></div>
            <div style="font-size:9px;color:#475569;margin-top:4px;">${escapeHtml(proposal.bdmName !== "Not specified" ? proposal.bdmName : "Authorized signatory")}</div>
          </div>
        </div>`;

  const summaryBits = [
    systemKw && systemType ? `${systemKw} kW ${systemType}` : systemKw ? `${systemKw} kW` : systemType,
    panelCount ? `${panelCount} panels` : "",
    quoteObj?.panelBrand ? `${quoteObj.panelBrand} ${quoteObj.panelWattage || ""}W`.trim() : "",
    quoteObj?.inverterBrand ? `${quoteObj.inverterBrand} ${quoteObj.inverterCapacity || ""}`.trim() : "",
  ].filter(Boolean);

  const page1 = `
    <div class="page cover classic-layout three-page-cover">
      <div class="quote-page-shell">
        <div style="text-align:center;margin-bottom:18px;">
          ${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(settings.companyName)}" style="max-height:72px;max-width:200px;object-fit:contain;margin:0 auto 12px;display:block;" />` : ""}
          <div style="font-weight:850;font-size:18px;letter-spacing:-0.02em;color:#0f172a;">${escapeHtml(settings.companyName)}</div>
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.14em;color:#d97706;font-weight:800;margin-top:4px;">Solar System Quotation</div>
        </div>

        <div style="text-align:center;margin-top:18px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#d97706;">Quotation</div>
          <div style="font-size:30px;font-weight:850;line-height:1.15;color:#0f172a;margin-top:8px;">
            ${escapeHtml(systemHeadline.kicker)}<br/>${escapeHtml(systemHeadline.subtitle)}
          </div>
          <div style="margin-top:10px;font-size:12px;color:#475569;font-weight:600;">${escapeHtml(summaryBits.join(" · "))}</div>
        </div>

        <div class="cover-meta-grid" style="border-top:1px solid #cbd5e1;padding-top:16px;margin-top:28px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:11px;">
            <div>
              <div style="color:#64748b;font-weight:800;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;">Prepared For</div>
              <div style="font-weight:700;color:#0f172a;margin-top:4px;font-size:14px;">${escapeHtml(proposal.clientName)}</div>
              ${proposal.clientPhone !== "Not specified" ? `<div style="font-size:10px;color:#475569;margin-top:2px;">${escapeHtml(proposal.clientPhone)}</div>` : ""}
            </div>
            <div>
              <div style="color:#64748b;font-weight:800;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;">Quotation Reference</div>
              <div style="font-weight:700;color:#0f172a;margin-top:4px;font-family:monospace;font-size:11px;">${escapeHtml(docId)}</div>
            </div>
            <div>
              <div style="color:#64748b;font-weight:800;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;">Quotation Date</div>
              <div style="font-weight:600;color:#0f172a;margin-top:4px;">${escapeHtml(quoteDateString)}</div>
            </div>
            <div>
              <div style="color:#64748b;font-weight:800;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;">Validity</div>
              <div style="font-weight:700;color:#d97706;margin-top:4px;">${validity.days} days (exp. ${escapeHtml(expiryDateString)})</div>
            </div>
            <div>
              <div style="color:#64748b;font-weight:800;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;">Site / Location</div>
              <div style="font-weight:600;color:#0f172a;margin-top:4px;">${escapeHtml(siteLocationLabel)}</div>
            </div>
            <div>
              <div style="color:#64748b;font-weight:800;font-size:8px;text-transform:uppercase;letter-spacing:0.05em;">System Type</div>
              <div style="font-weight:600;color:#0f172a;margin-top:4px;">${escapeHtml(systemTypeLabel)}</div>
            </div>
          </div>
        </div>

        <div style="margin-top:auto;border-top:1px solid #cbd5e1;padding-top:16px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;">
          <div style="font-size:9px;color:#475569;line-height:1.5;">
            <div style="font-weight:800;color:#0f172a;margin-bottom:2px;">${escapeHtml(settings.companyName)}</div>
            <div>${escapeHtml(settings.officeAddress)}</div>
            <div style="color:#d97706;">Hotlines: ${escapeHtml(settings.phoneNumbers)}</div>
            ${settings.websiteUrl ? `<div>${escapeHtml(settings.websiteUrl)}</div>` : ""}
            ${proposal.bdmName && proposal.bdmName !== "Not specified" ? `<div style="margin-top:6px;">Prepared by: ${escapeHtml(proposal.bdmName)}</div>` : ""}
          </div>
          <div style="text-align:right;background:#0f172a;color:#fff;border-radius:10px;padding:12px 16px;min-width:160px;">
            <div style="font-size:8px;letter-spacing:0.12em;text-transform:uppercase;color:#fbbf24;font-weight:800;">Quotation Amount</div>
            <div style="font-size:18px;font-weight:850;margin-top:4px;color:#fff;">${formatPKR(netTotal || grossTotal)}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const page2 = `
    <div class="page boq-page three-page-boq${compact ? " compact-boq" : ""}${overflowBlocked ? " preview-overflow" : ""}">
      <div class="quote-page-shell">
        ${pageHeader(logoSrc, settings, "Equipment / BOQ")}
        <div class="page-title">Commercial Quotation</div>
        ${overflowBanner}
        <div style="border:1.5px solid #cbd5e1;border-radius:6px;margin-top:8px;flex:1;min-height:0;overflow:${overflowBlocked ? "auto" : "hidden"};">
          <table class="boq-table">
            ${renderBoqTableHeadHtml()}
            <tbody>
              ${boqBody}
            </tbody>
          </table>
        </div>
        ${totalsHtml}
        ${pageFooter(settings, docId, 2, totalPages)}
      </div>
    </div>
  `;

  const termsPagesHtml = termsPageBodies
    .map((bodyHtml, index) => {
      const isLast = index === termsPageBodies.length - 1;
      const pageNum = 3 + index;
      const heading =
        termsPageCount > 1 ? `Terms & Conditions (${index + 1}/${termsPageCount})` : "Terms & Conditions";
      const intro =
        index === 0
          ? `<div style="font-size:10.5px;line-height:1.45;color:#475569;margin:8px 0 10px;">
          All supply, installation and LESCO utility work under this quotation is governed by the Sunchaser covenants below.
        </div>`
          : `<div style="font-size:9px;color:#64748b;margin:6px 0 8px;">Terms continued from previous page.</div>`;
      const extraCards = isLast
        ? `${
            showPaymentCard
              ? `<div class="card" style="margin-top:10px;font-size:10px;"><strong>Payment:</strong> ${escapeHtml(payment)}</div>`
              : ""
          }${
            showWarrantyCard
              ? `<div class="card" style="margin-top:8px;font-size:10px;"><strong>Warranty:</strong> ${escapeHtml(warranty)}</div>`
              : ""
          }`
        : "";
      return `
    <div class="page three-page-terms${index > 0 ? " terms-continued" : ""}" data-sunchaser-terms-page="${index + 1}" data-sunchaser-terms-pages="${termsPageCount}" data-sunchaser-terms-source="${escapeHtml(resolvedTerms.source)}">
      <div class="quote-page-shell">
        ${pageHeader(logoSrc, settings, heading)}
        <div class="page-title">${heading}</div>
        ${intro}
        <div class="quote-terms-body" style="flex:1;min-height:0;">${bodyHtml}</div>
        ${extraCards}
        ${isLast ? signatureHtml : ""}
        ${pageFooter(settings, docId, pageNum, totalPages)}
      </div>
    </div>`;
    })
    .join("");

  const exportBlocked = overflowBlocked;
  const exportBlockReason = overflowBlocked
    ? (customerBoq.message || THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE)
    : null;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Sunchaser Quotation — ${escapeHtml(proposal.clientName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      color: #1e293b;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .action-bar {
      background-color: #0f172a;
      color: #ffffff;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
      font-size: 14px;
    }
    .btn-print {
      background-color: #f59e0b;
      color: #0f172a;
      border: none;
      padding: 8px 18px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      font-family: Inter, sans-serif;
    }
    .action-bar-actions { display: flex; gap: 8px; align-items: center; }
    .btn-download {
      background-color: #0f172a;
      color: #ffffff;
      border: 1px solid #334155;
      padding: 8px 18px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      font-family: Inter, sans-serif;
    }
    .btn-print[disabled], .btn-download[disabled] {
      opacity: 0.45;
      cursor: not-allowed;
    }
    ${quotePdfShellCss()}
    .preview-overflow { max-height: none !important; height: auto !important; overflow: visible !important; }
    .page-header-logo {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1.5px solid #cbd5e1;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    .header-company-name {
      font-weight: 800;
      font-size: 12px;
      color: #0f172a;
      letter-spacing: 0.05em;
    }
    .page-title {
      font-size: 15px;
      font-weight: 850;
      color: #d97706;
      border-left: 4px solid #f59e0b;
      padding-left: 8px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    ${quotePdfPrintCss()}
    .card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .quote-terms-body {
      font-size: 10px;
      line-height: 1.45;
      color: #334155;
      font-weight: 500;
    }
    .quote-terms-body h1,
    .quote-terms-body h2,
    .quote-terms-body h3,
    .quote-terms-body h4 {
      font-size: 11.5px;
      color: #d97706;
      font-weight: 800;
      margin: 8px 0 4px;
      letter-spacing: 0.02em;
    }
    .quote-terms-body p { margin: 0 0 6px; }
    .quote-terms-body ol,
    .quote-terms-body ul { margin: 0 0 8px; padding-left: 18px; }
    .quote-terms-body li { margin-bottom: 3px; }
    .quote-terms-body strong,
    .quote-terms-body b { font-weight: 800; color: #0f172a; }
    .quote-terms-body u { text-decoration: underline; }
    .boq-table {
      width: 100%;
      border-collapse: collapse;
      font-size: ${compact ? "8px" : "9px"};
    }
    .boq-table th {
      background-color: #0f172a;
      color: #ffffff;
      text-align: left;
      padding: ${compact ? "4px 6px" : "6px 8px"};
      font-weight: 750;
      text-transform: uppercase;
      font-size: 8px;
      letter-spacing: 0.03em;
    }
    .boq-table td {
      padding: ${compact ? "3px 6px" : "4px 8px"};
      border-bottom: 1px solid #e2e8f0;
    }
    .compact-boq .boq-section-header td,
    .compact-boq .boq-section-subtotal td {
      padding: 4px 6px !important;
      font-size: 8px !important;
    }
    ${boqPdfSectionCss()}
    @media print {
      body { background-color: #ffffff !important; }
      .action-bar { display: none !important; }
    }

  </style>
</head>
<body>
  ${
    options.hideActionBar
      ? ""
      : `<div class="action-bar">
        <div><strong>Sunchaser Quotation</strong> — ${escapeHtml(proposal.clientName)} · ${totalPages} pages</div>
        <div class="action-bar-actions">
          <button type="button" class="btn-print" ${exportBlocked ? "disabled" : ""} onclick="sunchaserPrintDeck()">Print</button>
        </div>
      </div>`
  }
  <div class="pages-container" data-sunchaser-page-count="${totalPages}" data-sunchaser-export-blocked="${exportBlocked ? "true" : "false"}" data-sunchaser-boq-consolidated="${customerBoq.consolidated ? "true" : "false"}" data-sunchaser-terms-source="${escapeHtml(resolvedTerms.source)}">
    ${page1}
    ${page2}
    ${termsPagesHtml}
  </div>
  ${
    options.hideActionBar
      ? ""
      : `<script>
        function sunchaserPrintDeck() {
          if (${exportBlocked ? "true" : "false"}) {
            ${exportBlocked ? `alert(${JSON.stringify(exportBlockReason || THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE)});` : ""}
            return;
          }
          var run = function () {
            requestAnimationFrame(function () {
              setTimeout(function () { window.print(); }, 150);
            });
          };
          var fontReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
          fontReady.then(run).catch(run);
        }
      </script>`
  }
</body>
</html>`;

  return {
    html,
    pageCount: totalPages,
    boqOverflow: overflowBlocked,
    boqOverflowMessage: overflowBlocked ? (customerBoq.message || THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE) : null,
    termsOverflow,
    exportBlocked,
    exportBlockReason,
    itemCount: customerBoq.itemCount,
    validityDays: validity.days,
    pages: STANDARD_QUOTATION_PAGES,
    customerBoqConsolidated: customerBoq.consolidated,
    originalBoqOverflow: customerBoq.originalOverflow,
  };
}

export function threePageRendererId(): string {
  return "sunchaser-three-page-quotation";
}
