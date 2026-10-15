import test from "node:test";
import assert from "node:assert/strict";
import { cleanBankAccountsInput, cleanBrandingInput, cleanPriceSettingsInput, cleanTermsInput, SettingsInputError } from "./companySettingsApi.ts";

test("branding: text is trimmed, only known fields pass, colours and links are validated", () => {
  const out = cleanBrandingInput({ companyName: "  Acme Solar  ", billingEmail: "a@b.test", logoUrl: "https://cdn.test/l.png", primaryColor: "#112233", evil: "x" });
  assert.deepEqual(out, { companyName: "Acme Solar", billingEmail: "a@b.test", logoUrl: "https://cdn.test/l.png", primaryColor: "#112233" });
  assert.throws(() => cleanBrandingInput({ logoUrl: "javascript:alert(1)" }), SettingsInputError);
  assert.throws(() => cleanBrandingInput({ logoUrl: "//evil.test/x.png" }), SettingsInputError);
  assert.throws(() => cleanBrandingInput({ primaryColor: "red;} body{display:none" }), SettingsInputError);
  assert.throws(() => cleanBrandingInput({ companyName: "x".repeat(501) }), SettingsInputError);
  assert.throws(() => cleanBrandingInput({ companyName: 5 }), SettingsInputError);
  assert.equal(cleanBrandingInput({ logoUrl: "/api/company/files/documents/c%2Facme%2Flogo.png" }).logoUrl, "/api/company/files/documents/c%2Facme%2Flogo.png");
});

test("bank accounts: required fields, defaults, limits", () => {
  const [a] = cleanBankAccountsInput({ accounts: [{ bankName: " HBL ", accountTitle: "ACME SOLAR", accountNumber: "123" }] });
  assert.deepEqual(a, { bankName: "HBL", accountTitle: "ACME SOLAR", accountNumber: "123", iban: "N/A", branchCode: "", isActive: true, showOnInvoice: true, sortOrder: 1 });
  assert.throws(() => cleanBankAccountsInput({ accounts: [{ bankName: "HBL" }] }), SettingsInputError);
  assert.throws(() => cleanBankAccountsInput({}), SettingsInputError);
  assert.deepEqual(cleanBankAccountsInput({ accounts: [] }), []);
});

test("terms: list of clauses, empty ones dropped", () => {
  assert.deepEqual(cleanTermsInput({ terms: ["  One ", "", "Two"] }), ["One", "Two"]);
  assert.throws(() => cleanTermsInput({ terms: "nope" }), SettingsInputError);
});

test("price settings: validity is a whole number of days", () => {
  assert.deepEqual(cleanPriceSettingsInput({ currencySettings: "PKR", quoteValidityDays: 14 }), { currencySettings: "PKR", quoteValidityDays: 14 });
  assert.throws(() => cleanPriceSettingsInput({ quoteValidityDays: 0 }), SettingsInputError);
  assert.throws(() => cleanPriceSettingsInput({ quoteValidityDays: 2.5 }), SettingsInputError);
});
