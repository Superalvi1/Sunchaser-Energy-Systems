/**
 * Marketplace admin capability helpers.
 * Pure functions — use hydrated req.actor only (never client role headers).
 */
import { isSuperAdmin, roleHasPermission } from "../../src/lib/roles.ts";
import type { RequestActor } from "../middleware/actor.ts";

export function isApprovedStaff(actor: RequestActor | null | undefined): boolean {
  return !!actor && actor.accountStatus === "Approved";
}

/** Staff with the additive `marketplace` permission may access marketplace admin APIs. */
export function canAccessMarketplaceAdmin(
  actor: RequestActor | null | undefined,
): boolean {
  if (!isApprovedStaff(actor)) return false;
  return roleHasPermission(actor!.role, "marketplace");
}

/** WS3 pricing/cost endpoints: marketplace permission AND Super Admin. */
export function canAccessMarketplacePricing(
  actor: RequestActor | null | undefined,
): boolean {
  if (!canAccessMarketplaceAdmin(actor)) return false;
  return isSuperAdmin(actor!.username, actor!.role);
}

export function superAdminActorScope(actor: RequestActor): string {
  return `admin:super:${actor.id}`;
}
