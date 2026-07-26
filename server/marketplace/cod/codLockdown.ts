/**
 * COD admin lockdown — ops for fulfilment, finance for cash collection.
 */
import type { NextFunction, Request, Response } from "express";
import type { RequestActor } from "../../middleware/actor.ts";
import {
  MARKETPLACE_FINANCE_ROLES,
  isMarketplaceFinanceRole,
  adminActorScope as financeAdminActorScope,
} from "../payments/marketplaceRouteLockdown.ts";

/** Operational fulfilment roles (cannot collect cash). */
export const MARKETPLACE_OPS_ROLES = new Set([
  "Sales",
  "Sales Manager",
  "Sales Executive",
  "Technician",
  "Operations",
  "Admin",
  "Super Admin",
  "Accounts Manager",
]);

export function isMarketplaceOpsRole(role: string | undefined): boolean {
  return MARKETPLACE_OPS_ROLES.has(String(role || ""));
}

export function codAdminActorScope(actor: RequestActor): string {
  if (actor.role === "Super Admin") return `admin:super:${actor.id}`;
  if (actor.role === "Admin") return `admin:${actor.id}`;
  if (isMarketplaceFinanceRole(actor.role)) return `admin:finance:${actor.id}`;
  return `admin:ops:${actor.id}`;
}

export { MARKETPLACE_FINANCE_ROLES, isMarketplaceFinanceRole, financeAdminActorScope };

export type CodLockdownMode = "ops" | "finance";

export function createCodRouteLockdown(deps: {
  marketplaceEnabled: boolean;
  mode: CodLockdownMode;
}) {
  return function codRouteLockdown(
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

    if (deps.mode === "finance") {
      if (!isMarketplaceFinanceRole(actor.role)) {
        res.status(403).json({
          ok: false,
          error: { code: "ORDER_NOT_AUTHORIZED", message: "Not authorized." },
        });
        return;
      }
    } else if (!isMarketplaceOpsRole(actor.role)) {
      res.status(403).json({
        ok: false,
        error: { code: "ORDER_NOT_AUTHORIZED", message: "Not authorized." },
      });
      return;
    }

    next();
  };
}
