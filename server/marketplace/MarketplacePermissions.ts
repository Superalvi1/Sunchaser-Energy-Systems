/**
 * Marketplace admin capability helpers.
 * Pure functions — use hydrated req.actor only (never client role headers).
 */
import { roleHasPermission } from "../../src/lib/roles.ts";
import type { RequestActor } from "../middleware/actor.ts";

export function isApprovedStaff(actor: RequestActor | null | undefined): boolean {
  return !!actor && actor.accountStatus === "Approved";
}

/** Staff with the additive `marketplace` permission may access admin catalogue APIs. */
export function canAccessMarketplaceAdmin(
  actor: RequestActor | null | undefined,
): boolean {
  if (!isApprovedStaff(actor)) return false;
  return roleHasPermission(actor!.role, "marketplace");
}
