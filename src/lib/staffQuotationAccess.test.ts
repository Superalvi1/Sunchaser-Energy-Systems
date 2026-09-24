import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canUseStaffQuote, isStaffQuotePath, STAFF_QUOTE_PATH } from "./staffQuotationAccess";

assert.equal(STAFF_QUOTE_PATH, "/staff-quote");
assert.equal(isStaffQuotePath("/staff-quote"), true);
assert.equal(isStaffQuotePath("/staff-quote/"), true);
assert.equal(isStaffQuotePath("/quote"), false);
assert.equal(isStaffQuotePath("/staff-quote/anything"), false);

assert.equal(canUseStaffQuote("Super Admin"), true);
assert.equal(canUseStaffQuote("Sales Executive"), true);
assert.equal(canUseStaffQuote("Technician"), true);
assert.equal(canUseStaffQuote("Customer"), false);
assert.equal(canUseStaffQuote(null), false);

const builderSource = readFileSync(
  new URL("../components/PublicQuotationBuilderPage.tsx", import.meta.url),
  "utf8"
);
const staffModeExit = builderSource.indexOf("if (isStaffMode) {");
const publicLeadSubmission = builderSource.indexOf("await submitPublicSmartQuoteLead({");
assert.ok(staffModeExit >= 0, "staff quotation mode must have its own generation branch");
assert.ok(
  publicLeadSubmission > staffModeExit && builderSource.slice(staffModeExit, publicLeadSubmission).includes("return;"),
  "staff generation must exit before the public lead submission"
);

console.log("Staff quotation access tests passed.");
