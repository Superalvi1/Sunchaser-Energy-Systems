/**
 * Inventory permissions — deny-by-default, staff-only.
 * Standalone module — does NOT import ownership resolvers.
 */

import type { RequestActor } from "../middleware/actor.ts";

export type InventoryPermissionAction = "read" | "write" | "manage";

export interface InventoryPermissionOptions {
  /** When true, Sales staff may read inventory data. */
  allowSalesRead?: boolean;
  /** When true, Technician staff may read inventory data. */
  allowTechnicianRead?: boolean;
}

export interface InventoryPermissionDecision {
  allowed: boolean;
  reason: string;
}

export class InventoryPermissionError extends Error {
  statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403 = 403) {
    super(message);
    this.name = "InventoryPermissionError";
    this.statusCode = statusCode;
  }
}

const FULL_ACCESS_ROLES = new Set([
  "Super Admin",
  "Admin",
  "Director",
  "Inventory Manager",
]);

const SALES_ROLES = new Set([
  "Sales Manager",
  "Sales Executive",
  "Sales Coordinator",
]);

const TECHNICIAN_ROLES = new Set([
  "Technician",
  "Senior Technician",
  "Field Technician",
]);

function isCustomerActor(actor: RequestActor): boolean {
  return actor.role === "Customer";
}

function isStaffActor(actor: RequestActor): boolean {
  return !isCustomerActor(actor);
}

function hasFullInventoryAccess(role: string): boolean {
  return FULL_ACCESS_ROLES.has(role);
}

function isSalesRole(role: string): boolean {
  return SALES_ROLES.has(role);
}

function isTechnicianRole(role: string): boolean {
  return TECHNICIAN_ROLES.has(role);
}

export function evaluateInventoryPermission(
  actor: RequestActor | undefined,
  action: InventoryPermissionAction,
  options: InventoryPermissionOptions = {}
): InventoryPermissionDecision {
  if (!actor) {
    return { allowed: false, reason: "unauthenticated" };
  }

  if (isCustomerActor(actor)) {
    return { allowed: false, reason: "customer_denied" };
  }

  if (!isStaffActor(actor)) {
    return { allowed: false, reason: "not_staff" };
  }

  if (hasFullInventoryAccess(actor.role)) {
    return { allowed: true, reason: "inventory_full_access_role" };
  }

  if (action === "read") {
    if (options.allowSalesRead && isSalesRole(actor.role)) {
      return { allowed: true, reason: "sales_read_explicitly_allowed" };
    }
    if (options.allowTechnicianRead && isTechnicianRole(actor.role)) {
      return { allowed: true, reason: "technician_read_explicitly_allowed" };
    }
  }

  if (action === "read" && (isSalesRole(actor.role) || isTechnicianRole(actor.role))) {
    return { allowed: false, reason: "read_requires_explicit_allowance" };
  }

  return { allowed: false, reason: "deny_by_default" };
}

export function canActorReadInventory(
  actor: RequestActor | undefined,
  options?: InventoryPermissionOptions
): boolean {
  return evaluateInventoryPermission(actor, "read", options).allowed;
}

export function canActorWriteInventory(actor: RequestActor | undefined): boolean {
  return evaluateInventoryPermission(actor, "write").allowed;
}

export function canActorManageInventory(actor: RequestActor | undefined): boolean {
  return evaluateInventoryPermission(actor, "manage").allowed;
}

export function assertInventoryReadAccess(
  actor: RequestActor | undefined,
  options?: InventoryPermissionOptions
): void {
  const decision = evaluateInventoryPermission(actor, "read", options);
  if (!decision.allowed) {
    throw new InventoryPermissionError(decision.reason, actor ? 403 : 401);
  }
}

export function assertInventoryWriteAccess(actor: RequestActor | undefined): void {
  const decision = evaluateInventoryPermission(actor, "write");
  if (!decision.allowed) {
    throw new InventoryPermissionError(decision.reason, actor ? 403 : 401);
  }
}

export function assertInventoryManageAccess(actor: RequestActor | undefined): void {
  const decision = evaluateInventoryPermission(actor, "manage");
  if (!decision.allowed) {
    throw new InventoryPermissionError(decision.reason, actor ? 403 : 401);
  }
}

export function inventoryFullAccessRoles(): readonly string[] {
  return [...FULL_ACCESS_ROLES];
}
