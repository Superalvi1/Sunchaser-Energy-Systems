import test from "node:test";
import assert from "node:assert/strict";
import { compileThreePageQuotationHtml } from "../../src/lib/quoteThreePageRender.ts";
import { compileInvoicePDFHtml, normalizeInvoiceBankAccounts } from "../../invoicePdf.ts";
import { mergeBranding, NEUTRAL_BRANDING } from "../../src/lib/branding.ts";
import { withOfficialBranding } from "../../src/lib/brandingAssets.ts";
import { resolveQuoteValidityDays } from "../../src/lib/quoteValidity.ts";

/** Anything that identifies the founding company or its bank accounts. None may appear in another company's documents. */
const SUNCHASER_TOKENS = /sunchaser|DHA Phase|0309-0236666|0330-7776444|0321-8486752|ceo\.sunchaser|sunchaserenergy|PK81ABPA|PK03ASCM|04190010112276940012|03860200001296|201139501310001|HELIOS|AL ADAM|SIGNALS GLOBAL|Allied Bank|Askari Bank|Bank Islamic|sunchaser-logo|signature\.png|sunchaser-bank-accounts/i;

/** What a reader or a browser can see: text, plus link/image/alt attributes. Internal data-* attributes and script code are not content. */
function visible(html: string): string {
  const attrs = [...html.matchAll(/\b(?:src|href|alt|title|content)="([^"]*)"/g)].map((m) => m[1]).join("\n");
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  return `${text}\n${attrs}`;
}

const rows = [
  { id: "h1", type: "heading", description: "Equipment" },
  { id: "p1", type: "item", description: "Solar panel 580W", qty: 10, rate: 40000, total: 400000, unit: "pcs" },
  { id: "i1", type: "item", description: "Hybrid inverter 6kW", qty: 1, rate: 300000, total: 300000, unit: "pcs" },
];
const quote = (extra: Record<string, unknown> = {}) => ({
  id: "q-1", clientName: "Test Client", quote_type: "manual_boq", systemSizekW: 5.8, systemType: "Hybrid", panelCount: 10,
  boqRows: rows, grandTotal: 700000, quoteDate: "2026-10-01", ...extra,
});
const lead = { id: "lead-1", name: "Test Client", phone: "0300-0000000", location: "Karachi" };

const neutralState = (extra: Record<string, unknown> = {}) => ({ documentIdentity: { neutral: true }, companyTerms: [], ...extra });
const acmePdf = { id: "acme_pdf_settings", company_name: "Acme Solar Pvt Ltd", office_address: "12 Canal Road, Karachi", hotline_phones: "021-1111111", billing_email: "billing@acme.test", website_url: "www.acme.test", logo_url: "https://cdn.acme.test/logo.png" };

test("quotation of a company with no settings carries no Sunchaser value", () => {
  const html = compileThreePageQuotationHtml(quote(), lead, neutralState()).html;
  assert.doesNotMatch(visible(html), SUNCHASER_TOKENS);
  assert.match(html, /700,000|7,00,000/);
});

test("quotation of a company shows that company's own settings", () => {
  const html = compileThreePageQuotationHtml(quote(), lead, neutralState({ quotePdfSettings: [acmePdf], companyTerms: [{ termText: "Acme payment terms: 60% advance." }] })).html;
  assert.doesNotMatch(visible(html), SUNCHASER_TOKENS);
  for (const s of ["Acme Solar Pvt Ltd", "12 Canal Road, Karachi", "https://cdn.acme.test/logo.png", "Acme payment terms: 60% advance."]) assert.ok(html.includes(s), `missing ${s}`);
});

test("the founding company's quotation is unchanged: Sunchaser defaults still apply", () => {
  const html = compileThreePageQuotationHtml(quote(), lead, { companyTerms: [] }).html;
  assert.match(html, /SUNCHASER ENERGY SYSTEMS/);
  assert.match(html, /DHA Phase 6/);
  assert.match(html, /sunchaser-logo\.png/);
});

test("a quotation keeps the identity it was saved with when the settings change later", () => {
  const settingsSnapshot = { version: 1, capturedAt: "2026-10-01T00:00:00Z", company: { companyName: "Acme Solar (old name)", officeAddress: "Old Office, Karachi", phoneNumbers: "021-0000000", billingEmail: "old@acme.test", websiteUrl: "old.acme.test", logoUrl: "https://cdn.acme.test/old-logo.png" } };
  const changed = neutralState({ quotePdfSettings: [{ ...acmePdf, company_name: "Acme Renamed", office_address: "New Office" }] });
  const html = compileThreePageQuotationHtml(quote({ settingsSnapshot }), lead, changed).html;
  assert.ok(html.includes("Acme Solar (old name)") && html.includes("Old Office, Karachi") && html.includes("old-logo.png"));
  assert.ok(!html.includes("Acme Renamed") && !html.includes("New Office"));
  const fresh = compileThreePageQuotationHtml(quote(), lead, changed).html;
  assert.ok(fresh.includes("Acme Renamed"), "a quotation without a snapshot follows the current settings");
});

test("a quotation keeps its saved terms when the company's terms change", () => {
  const termsSnapshot = { source: "company", templateId: "", templateName: "", resolvedAt: "2026-10-01T00:00:00Z", pages: [{ title: "Terms & Conditions", pageType: "terms", contentHtml: "<p>Original clause A.</p>", contentText: "Original clause A." }], html: "<p>Original clause A.</p>", clauses: ["Original clause A."] };
  const html = compileThreePageQuotationHtml(quote({ termsSnapshot }), lead, neutralState({ companyTerms: [{ termText: "Changed clause B." }] })).html;
  assert.ok(html.includes("Original clause A.") && !html.includes("Changed clause B."));
});

test("a company without terms gets generic clauses that name nobody", () => {
  const html = compileThreePageQuotationHtml(quote(), lead, neutralState()).html;
  assert.match(html, /valid for the period stated/);
  assert.doesNotMatch(visible(html), SUNCHASER_TOKENS);
});

test("validity: company default, then 7 days for other companies, 3 for the founding company", () => {
  assert.equal(resolveQuoteValidityDays({}, neutralState({ settings: { quoteValidityDays: 14 } })).days, 14);
  assert.equal(resolveQuoteValidityDays({}, neutralState()).days, 7);
  assert.equal(resolveQuoteValidityDays({}, { companyTerms: [] }).days, 3);
});

const invoice = {
  id: "i-1", invoiceNumber: "INV-2026-0001", invoiceDate: "2026-10-02", dueDate: "2026-10-09", customerId: null, customerName: "Test Client", customerPhone: null,
  customerAddress: null, cnicNtn: null, leadId: null, quotationId: null, projectId: null, subtotal: 700000, discountAmount: 0, taxAmount: 0, grandTotal: 700000,
  paidAmount: 0, balanceDue: 700000, paymentStatus: "Unpaid", notes: null, terms: null, pdfUrl: null,
  items: [{ id: "l1", itemName: "Solar panel", description: "Solar panel", qty: 10, rate: 40000, lineTotal: 400000 }],
} as any;

test("invoice of a company with no settings and no bank accounts carries no Sunchaser value and no bank account", () => {
  const html = compileInvoicePDFHtml(invoice, { ...NEUTRAL_BRANDING });
  assert.doesNotMatch(visible(html), SUNCHASER_TOKENS);
  assert.match(html, /No bank accounts are configured/);
});

test("invoice shows the company's own branding and bank accounts", () => {
  const branding = withOfficialBranding({ ...mergeBranding({ companyName: "Acme Solar Pvt Ltd", officeAddress: "12 Canal Road, Karachi", phoneNumbers: "021-1111111", billingEmail: "billing@acme.test", websiteUrl: "www.acme.test", logoUrl: "https://cdn.acme.test/logo.png" }, { neutral: true }) });
  const banks = normalizeInvoiceBankAccounts([{ bankName: "Acme Bank", accountTitle: "ACME SOLAR", accountNumber: "9999", iban: "PK00ACME0000009999", showOnInvoice: true, isActive: true }], { neutral: true });
  const html = compileInvoicePDFHtml(invoice, { ...branding, bankAccounts: banks });
  assert.doesNotMatch(visible(html), SUNCHASER_TOKENS);
  for (const s of ["Acme Solar Pvt Ltd", "12 Canal Road, Karachi", "Acme Bank", "PK00ACME0000009999", "cdn.acme.test/logo.png", "For Acme Solar Pvt Ltd"]) assert.ok(html.includes(s), `missing ${s}`);
});

test("the founding company's invoice keeps its defaults, including the verified accounts", () => {
  const html = compileInvoicePDFHtml(invoice, { bankAccounts: normalizeInvoiceBankAccounts([]) });
  assert.match(html, /Sunchaser Energy Systems/);
  assert.match(html, /PK81ABPA0010112276940012/);
});

test("neutral branding never receives the official logo, signature or bank image", () => {
  const b = withOfficialBranding({ ...NEUTRAL_BRANDING });
  assert.equal(b.logoUrl, ""); assert.equal(b.signatureUrl, ""); assert.equal(b.bankAccountsImageUrl, ""); assert.equal(b.legacyDefaults, false);
  assert.equal(mergeBranding({}, { neutral: true }).companyName, "");
  assert.notEqual(mergeBranding({}).companyName, "");
});
