/**
 * marketplaceRouteLockdown — admin marketplace finance routes.
 * Requires MARKETPLACE_ENABLED + CRM JWT (req.actor) + finance verification role.
 */
import type { NextFunction, Request, Response } from "express";
import type { RequestActor } from "../../middleware/actor.ts";

/** Contract-approved finance / payment verification roles. */
export const MARKETPLACE_FINANCE_ROLES = new Set([
  "Accounts Manager",
  "Super Admin",
  "Admin",
]);

export function isMarketplaceFinanceRole(role: string | undefined): boolean {
  return MARKETPLACE_FINANCE_ROLES.has(String(role || ""));
}

export function adminActorScope(actor: RequestActor): string {
  if (actor.role === "Super Admin") return `admin:super:${actor.id}`;
  if (actor.role === "Admin") return `admin:${actor.id}`;
  return `admin:finance:${actor.id}`;
}

export type LockdownDeps = {
  marketplaceEnabled: boolean;
};

export function createMarketplaceRouteLockdown(deps: LockdownDeps) {
  return function marketplaceRouteLockdown(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!deps.marketplaceEnabled) {
      res.status(503).json({
        ok: false,
        error: {
          code: "MARKETPLACE_DISABLED",
          message: "Marketplace is disabled.",
        },
      });
      return;
    }

    const actor = req.actor;
    if (!actor) {
      res.status(401).json({
        ok: false,
        error: { code: "INVALID_TOKEN", message: "Authentication required." },
      });
      return;
    }

    if (actor.role === "Customer") {
      res.status(403).json({
        ok: false,
        error: { code: "ORDER_NOT_AUTHORIZED", message: "Not authorized." },
      });
      return;
    }

    if (!isMarketplaceFinanceRole(actor.role)) {
      res.status(403).json({
        ok: false,
        error: { code: "ORDER_NOT_AUTHORIZED", message: "Not authorized." },
      });
      return;
    }

    next();
  };
}
