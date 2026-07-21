/**
 * PR 2 inbox capability helpers (Revision 3).
 * Pure functions — no I/O. Routes remain presentational for UI only.
 */
import { roleHasPermission } from "../../src/lib/roles.ts";
import type { RequestActor } from "../middleware/actor.ts";

/** Rev3 archive/reopen-archived admin set (includes Technical CEO). */
export const INBOX_ADMIN_ROLES = new Set([
  "Super Admin",
  "Director",
  "Technical CEO",
  "Admin",
]);

export function isApprovedStaff(actor: RequestActor | null | undefined): boolean {
  return !!actor && actor.accountStatus === "Approved";
}

export function canViewInbox(actor: RequestActor | null | undefined): boolean {
  if (!isApprovedStaff(actor)) return false;
  return roleHasPermission(actor!.role, "crm_leads");
}

export function isInboxAdminRole(role: string): boolean {
  return INBOX_ADMIN_ROLES.has(role);
}

/** Reassignment / unassign of another user's conversation. */
export function canReassignConversation(
  actor: RequestActor | null | undefined,
  currentAssignedUserId: string | null
): boolean {
  if (!canViewInbox(actor)) return false;
  if (currentAssignedUserId == null) return true;
  if (actor!.id === currentAssignedUserId) return true;
  return isInboxAdminRole(actor!.role);
}

export function canArchiveConversation(
  actor: RequestActor | null | undefined
): boolean {
  return canViewInbox(actor) && isInboxAdminRole(actor!.role);
}

export function canMutateAssignment(
  actor: RequestActor | null | undefined
): boolean {
  return canViewInbox(actor);
}

export function canLinkCrm(actor: RequestActor | null | undefined): boolean {
  return canViewInbox(actor);
}

export function canCreateLeadFromConversation(
  actor: RequestActor | null | undefined
): boolean {
  return canViewInbox(actor);
}
