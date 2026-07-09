import assert from "node:assert/strict";
import { QuotationEngineError } from "./QuotationModels.ts";
import { evaluateDiscountApproval } from "./DiscountApprovalRules.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("0% discount is always auto-approved", evaluateDiscountApproval(0, "Sales Executive").autoApproved);
check("0% discount requires no approver", evaluateDiscountApproval(0, "Sales Executive").approverTier === "none");

check("Sales Executive: 5% is within their auto-approval limit", evaluateDiscountApproval(5, "Sales Executive").autoApproved);
check("Sales Executive: 5.01% exceeds their auto-approval limit", !evaluateDiscountApproval(5.01, "Sales Executive").autoApproved);
check("Sales Executive: over-limit escalates to sales_manager", evaluateDiscountApproval(10, "Sales Executive").approverTier === "sales_manager");
check("Sales Executive: over-limit requiresApproval is true", evaluateDiscountApproval(10, "Sales Executive").requiresApproval);

check("Sales Advisor: 7% is within their auto-approval limit", evaluateDiscountApproval(7, "Sales Advisor").autoApproved);
check("Sales Advisor: 8% escalates to sales_manager", evaluateDiscountApproval(8, "Sales Advisor").approverTier === "sales_manager");

check("Sales Manager: 15% is within their auto-approval limit", evaluateDiscountApproval(15, "Sales Manager").autoApproved);
check("Sales Manager: 16% escalates to director", evaluateDiscountApproval(16, "Sales Manager").approverTier === "director");

check("Director: 25% is within their auto-approval limit", evaluateDiscountApproval(25, "Director").autoApproved);
check("Director: 26% escalates to super_admin", evaluateDiscountApproval(26, "Director").approverTier === "super_admin");

check("Super Admin: 100% is auto-approved", evaluateDiscountApproval(100, "Super Admin").autoApproved);
check("Super Admin: 100% requires no further approver", evaluateDiscountApproval(100, "Super Admin").approverTier === "none");

check("Unknown role has 0% auto-approval limit", !evaluateDiscountApproval(1, "Some Random Role").autoApproved);
check("Unknown role escalates to super_admin by default", evaluateDiscountApproval(1, "Some Random Role").approverTier === "super_admin");

check("decision echoes the requested percent", evaluateDiscountApproval(12.5, "Sales Manager").requestedPercent === 12.5);
check("decision echoes the role", evaluateDiscountApproval(12.5, "Sales Manager").role === "Sales Manager");
check("auto-approved reason is within_role_auto_approval_limit", evaluateDiscountApproval(5, "Sales Executive").reason === "within_role_auto_approval_limit");
check("escalated reason is exceeds_role_auto_approval_limit", evaluateDiscountApproval(10, "Sales Executive").reason === "exceeds_role_auto_approval_limit");
check("zero-discount reason is no_discount_requested", evaluateDiscountApproval(0, "Sales Executive").reason === "no_discount_requested");

check(
  "evaluateDiscountApproval throws for negative percent",
  (() => {
    try {
      evaluateDiscountApproval(-1, "Sales Executive");
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError && e.stage === "discount_approval";
    }
  })()
);
check(
  "evaluateDiscountApproval throws for percent above 100",
  (() => {
    try {
      evaluateDiscountApproval(101, "Sales Executive");
      return false;
    } catch (e) {
      return e instanceof QuotationEngineError;
    }
  })()
);
check("evaluateDiscountApproval accepts exactly 100", evaluateDiscountApproval(100, "Sales Executive").requiresApproval);

console.log(`\nDiscountApprovalRules tests: ${pass} passed`);
