import test from "node:test";
import assert from "node:assert/strict";
import { diffSettings, displayValue, summariseSettingsChange } from "../../src/lib/settingsDiff.ts";
import { describeChange } from "./companySettingsApi.ts";

const A = { bankName: "Alpha Bank", accountTitle: "ALPHA", accountNumber: "111", iban: "PK36SCBL0000001123456702", branchCode: "01", isActive: true, showOnInvoice: true, sortOrder: 1 };
const B = { bankName: "Beta Bank", accountTitle: "BETA", accountNumber: "222", iban: "N/A", branchCode: "", isActive: true, showOnInvoice: true, sortOrder: 2 };

test("bank accounts: an edit shows the field with its old and new value, matched by account number across saves (ids are regenerated)", () => {
  const before = [{ ...A, id: "bank_old1" }, { ...B, id: "bank_old2" }];
  const after = [{ ...A, id: "bank_new1", iban: "PK00NEW0000000000000000" }, { ...B, id: "bank_new2" }];
  const rows = diffSettings("bank_accounts", before, after);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { kind: "changed", label: "Alpha Bank 111: IBAN", before: "PK36SCBL0000001123456702", after: "PK00NEW0000000000000000" });
  assert.equal(summariseSettingsChange("bank_accounts", before, after), "Bank accounts changed: 1 edited (now 2)");
});

test("bank accounts: an added and a removed account are shown in full; the one-line summary names counts, never values", () => {
  const rows = diffSettings("bank_accounts", [A, B], [A]);
  assert.deepEqual(rows.map((r) => [r.kind, r.label]), [["removed", "Account 222 removed"]]);
  assert.match(rows[0].before, /Beta Bank · BETA · 222 · N\/A/);
  const added = diffSettings("bank_accounts", [A], [A, B]);
  assert.deepEqual(added.map((r) => r.kind), ["added"]);
  const summary = summariseSettingsChange("bank_accounts", [A, B], [A]);
  assert.equal(summary, "Bank accounts changed: 1 removed (now 1)");
  assert.doesNotMatch(summary, /222|Beta|PK36/);
  assert.equal(summariseSettingsChange("bank_accounts", [A], [A]), "Bank accounts saved (no value changed)");
  assert.equal(summariseSettingsChange("bank_accounts", [A, B], []), "Bank accounts changed: 2 removed (now 0)");
});

test("bank accounts: reordering is reported; a changed account number is a removal plus an addition (it is a different account)", () => {
  assert.ok(diffSettings("bank_accounts", [A, B], [B, A]).some((r) => /^Order/.test(r.label)));
  const rows = diffSettings("bank_accounts", [A], [{ ...A, accountNumber: "999" }]);
  assert.deepEqual(rows.map((r) => r.kind).sort(), ["added", "removed"]);
});

test("branding: only the fields that differ, with readable labels; embedded images are never printed", () => {
  const big = "data:image/png;base64," + "A".repeat(40_000);
  const rows = diffSettings("branding", { companyName: "Old", logoUrl: "", phoneNumbers: "1", terms: "x" }, { companyName: "New", logoUrl: big, phoneNumbers: "1", terms: "x" });
  assert.deepEqual(rows.map((r) => r.label), ["Company name", "Logo"]);
  assert.equal(rows[0].before, "Old");
  assert.equal(rows[0].after, "New");
  assert.equal(rows[1].before, "(empty)");
  assert.match(rows[1].after, /^\[embedded image, \d+ KB\]$/);
  assert.ok(JSON.stringify(rows).length < 600, "no image bytes in the diff");
  assert.equal(summariseSettingsChange("branding", { companyName: "Old" }, { companyName: "New" }), "Branding changed: companyName");
});

test("terms: added and removed clauses; reorder only; no change", () => {
  const rows = diffSettings("terms", ["one", "two"], ["two", "three"]);
  assert.deepEqual(rows.map((r) => [r.kind, r.kind === "added" ? r.after : r.before]), [["removed", "one"], ["added", "three"]]);
  assert.equal(summariseSettingsChange("terms", ["one", "two"], ["two", "three"]), "Terms changed: 1 added, 1 removed (now 2)");
  assert.deepEqual(diffSettings("terms", ["a", "b"], ["b", "a"]).map((r) => r.label), ["Order of the clauses"]);
  assert.equal(summariseSettingsChange("terms", ["a"], ["a"]), "Terms saved (no value changed)");
});

test("prices: the changed setting with its old and new value", () => {
  const rows = diffSettings("prices", { currencySettings: "PKR", quoteValidityDays: 7 }, { currencySettings: "PKR", quoteValidityDays: 14 });
  assert.deepEqual(rows, [{ kind: "changed", label: "Quotation validity (days)", before: "7", after: "14" }]);
});

test("the server writes the same one-line summary the screen's detail agrees with", () => {
  assert.equal(describeChange("bank_accounts", [A], [A, B]), summariseSettingsChange("bank_accounts", [A], [A, B]));
  assert.equal(describeChange("prices", { a: 1 }, { a: 2 }), "Price settings changed: a");
  assert.equal(displayValue(true), "yes");
  assert.equal(displayValue(null), "(empty)");
  assert.equal(displayValue("x".repeat(300)).length, 160);
});
