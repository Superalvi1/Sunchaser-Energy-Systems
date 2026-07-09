/**
 * Automation permissions — deny-by-default, staff-only.
 * Standalone — does not import ownership resolvers.
 */

import type { RequestActor } from "../middleware/actor.ts";

export type AutomationPermissionAction = "read" | "write" | "manage" | "execute";

export interface AutomationPermissionOptions {
  allowSalesRead?: boolean;
}

export interface AutomationPermissionDecision {
  allowed: boolean;
  reason: string;
}

export class AutomationPermissionError extends Error {
  statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403 = 403) {
    super(message);
    this.name = "AutomationPermissionError";
    this.statusCode = statusCode;
  }
}

const FULL_ACCESS_ROLES = new Set([
  "Super Admin",
  "Admin",
  "Director",
  "Sales Manager",
]);

const SALES_READ_ROLES = new Set([
  "Sales Executive",
  "Sales Coordinator",
]);

function isCustomer(actor: RequestActor): boolean {
  return actor.role === "Customer";
}

function hasFullAccess(role: string): boolean {
  return FULL_ACCESS_ROLES.has(role);
}

export function evaluateAutomationPermission(
  actor: RequestActor | undefined,
  action: AutomationPermissionAction,
  options: AutomationPermissionOptions = {}
): AutomationPermissionDecision {
  if (!actor) return { allowed: false, reason: "unauthenticated" };
  if (isCustomer(actor)) return { allowed: false, reason: "customer_denied" };

  if (hasFullAccess(actor.role)) {
    return { allowed: true, reason: "automation_full_access_role" };
  }

  if (action === "read" || action === "execute") {
    if (options.allowSalesRead && SALES_READ_ROLES.has(actor.role)) {
      return { allowed: true, reason: "sales_read_explicitly_allowed" };
    }
  }

  if (action === "read" && SALES_READ_ROLES.has(actor.role)) {
    return { allowed: false, reason: "read_requires_explicit_allowance" };
  }

  return { allowed: false, reason: "deny_by_default" };
}

export function canActorReadAutomation(
  actor: RequestActor | undefined,
  options?: AutomationPermissionOptions
): boolean {
  return evaluateAutomationPermission(actor, "read", options).allowed;
}

export function canActorWriteAutomation(actor: RequestActor | undefined): boolean {
  return evaluateAutomationPermission(actor, "write").allowed;
}

export function canActorExecuteAutomation(actor: RequestActor | undefined): boolean {
  return evaluateAutomationPermission(actor, "execute").allowed;
}

export function assertAutomationReadAccess(
  actor: RequestActor | undefined,
  options?: AutomationPermissionOptions
): void {
  const decision = evaluateAutomationPermission(actor, "read", options);
  if (!decision.allowed) throw new AutomationPermissionError(decision.reason, actor ? 403 : 401);
}

export function assertAutomationWriteAccess(actor: RequestActor | undefined): void {
  const decision = evaluateAutomationPermission(actor, "write");
  if (!decision.allowed) throw new AutomationPermissionError(decision.reason, actor ? 403 : 401);
}

export function assertAutomationExecuteAccess(actor: RequestActor | undefined): void {
  const decision = evaluateAutomationPermission(actor, "execute");
  if (!decision.allowed) throw new AutomationPermissionError(decision.reason, actor ? 403 : 401);
}
