import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoicePdfPayload, captureInvoiceIssuanceSnapshot } from "../../invoicePdfResolve.ts";
import { compileInvoicePDFHtml } from "../../invoicePdf.ts";
import { runWithCompany } from "./companyContext.ts";

const ON = { MULTI_COMPANY_ENABLED: "true" };
const bank = (name: string, no: string) => ({ id: name, bankName: name, accountTitle: "ACME SOLAR", accountNumber: no, iban: "PK36SCBL000000112345" + no.padStart(4, "0"), isActive: true, showOnInvoice: true, sortOrder: 1 });
const invoice: any = {
  id: "inv-1", invoiceNumber: "INV-2026-0001", invoiceDate: "2026-10-01", dueDate: "2026-10-15", customerName: "Customer", items: [],
  grandTotal: 1000, paidAmount: 0, balanceDue: 1000, subtotal: 1000, discountAmount: 0, taxAmount: 0, paymentStatus: "Unpaid", terms: null, notes: null,
};
// Local copy of an application with no database: another company reads no bank accounts from it (by design), so the tests that need
// real accounts (visible-only, changed-after-issuance) run in the two-company journey against PostgreSQL.
const dbWith = (banks: any[], terms: string) => ({ bankAccounts: banks, settings: {}, documentIdentity: { neutral: true }, ceoMessages: [],
  quotePdfSettings: [{ id: "1", company_name: "Acme Solar Ltd" }], companyBranding: { terms } }) as any;

async function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.MULTI_COMPANY_ENABLED;
  process.env.MULTI_COMPANY_ENABLED = ON.MULTI_COMPANY_ENABLED;
  try { return await runWithCompany({ companyId: "acme" }, fn); } finally { if (prev === undefined) delete process.env.MULTI_COMPANY_ENABLED; else process.env.MULTI_COMPANY_ENABLED = prev; }
}

test("a reprint shows the bank accounts and terms the invoice was issued with, not today's", async () => {
  await withEnv(async () => {
    const snapshot = { version: 1 as const, capturedAt: "2026-10-01T00:00:00.000Z", bankAccounts: [{ bankName: "Old Bank", accountTitle: "ACME SOLAR", accountNumber: "111", iban: "PK36SCBL0000001123456702", sortOrder: 1 }], companyTerms: "Terms as issued." };
    // The company has since changed its bank account and its terms.
    const { invoice: inv, branding, options } = await buildInvoicePdfPayload({ ...invoice, issuanceSnapshot: snapshot }, dbWith([bank("New Bank", "222")], "Terms changed later."));
    const html = compileInvoicePDFHtml(inv, branding, options);
    assert.match(html, /Old Bank/);
    assert.match(html, /Terms as issued\./);
    assert.doesNotMatch(html, /New Bank|Terms changed later/);
    assert.equal(options.issuanceSource, "snapshot");
    assert.match(html, /<!-- invoice-issuance: snapshot -->/);
  });
});

test("an invoice's own terms text still wins over the snapshot terms", async () => {
  await withEnv(async () => {
    const snapshot = { version: 1 as const, capturedAt: "x", bankAccounts: [], companyTerms: "Terms as issued." };
    const { invoice: inv, branding, options } = await buildInvoicePdfPayload({ ...invoice, terms: "Special terms for this customer.", issuanceSnapshot: snapshot }, dbWith([], ""));
    assert.match(compileInvoicePDFHtml(inv, branding, options), /Special terms for this customer\./);
  });
});

test("a legacy invoice (no snapshot) prints from current settings and is labelled legacy; nothing is invented for it", async () => {
  await withEnv(async () => {
    const { invoice: inv, branding, options } = await buildInvoicePdfPayload({ ...invoice, issuanceSnapshot: null }, dbWith([bank("New Bank", "222")], ""));
    const html = compileInvoicePDFHtml(inv, branding, options);
    assert.equal(options.issuanceSource, "legacy_current_settings");
    assert.equal(options.issuanceCapturedAt, undefined);
    assert.match(html, /<!-- invoice-issuance: legacy_current_settings -->/);
    assert.doesNotMatch(html, /Old Bank|Terms as issued/); // nothing from any snapshot is shown for it
  });
});

test("another company with no bank account is issued with none; Sunchaser's accounts are never captured", async () => {
  await withEnv(async () => {
    const snap = await captureInvoiceIssuanceSnapshot(dbWith([], ""));
    assert.deepEqual(snap.bankAccounts, []);
    assert.doesNotMatch(JSON.stringify(snap), /sunchaser/i);
    assert.equal(snap.version, 1);
    assert.ok(snap.companyTerms.length > 0);
  });
});
