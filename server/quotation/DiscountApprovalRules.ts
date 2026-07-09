/**
 * Discount approval rules — real, pure evaluation of role-based discount
 * authority tiers. Does not implement or bypass authorization/ownership —
 * it only answers "does this requested discount need escalation, and to
 * whom", given a role string. Enforcement of who may act on the decision
 * belongs to the existing authorization middleware, unchanged.
 */

import { isNonNegativeNumber, QuotationEngineError } from "./QuotationModels.ts";

export const APPROVER_TIERS = ["none", "sales_manager", "director", "super_admin"] as const;
export type ApproverTier = (typeof APPROVER_TIERS)[number];

/** Auto-approval ceiling per role, in percent. Roles absent from this map get 0% auto-approval. */
export const DISCOUNT_AUTO_APPROVAL_LIMITS: Record<string, number> = {
  "Sales Executive": 5,
  "Sales Advisor": 7,
  "Sales Manager": 15,
  Director: 25,
  "Super Admin": 100,
};

/** Escalation ladder: the tier that must approve when a role's own ceiling is exceeded. */
export const DISCOUNT_ESCALATION_LADDER: Record<string, ApproverTier> = {
  "Sales Executive": "sales_manager",
  "Sales Advisor": "sales_manager",
  "Sales Manager": "director",
  Director: "super_admin",
  "Super Admin": "none",
};

export interface DiscountApprovalDecision {
  requestedPercent: number;
  role: string;
  autoApproved: boolean;
  requiresApproval: boolean;
  approverTier: ApproverTier;
  reason: string;
}

export function evaluateDiscountApproval(requestedPercent: number, role: string): DiscountApprovalDecision {
  if (!isNonNegativeNumber(requestedPercent)) {
    throw new QuotationEngineError("discount_approval", "requestedPercent must be a non-negative number.");
  }
  if (requestedPercent > 100) {
    throw new QuotationEngineError("discount_approval", "requestedPercent must not exceed 100.");
  }

  const autoLimit = DISCOUNT_AUTO_APPROVAL_LIMITS[role] ?? 0;

  if (requestedPercent === 0) {
    return {
      requestedPercent,
      role,
      autoApproved: true,
      requiresApproval: false,
      approverTier: "none",
      reason: "no_discount_requested",
    };
  }

  if (requestedPercent <= autoLimit) {
    return {
      requestedPercent,
      role,
      autoApproved: true,
      requiresApproval: false,
      approverTier: "none",
      reason: "within_role_auto_approval_limit",
    };
  }

  const approverTier = DISCOUNT_ESCALATION_LADDER[role] ?? "super_admin";

  return {
    requestedPercent,
    role,
    autoApproved: false,
    requiresApproval: true,
    approverTier,
    reason: "exceeds_role_auto_approval_limit",
  };
}
