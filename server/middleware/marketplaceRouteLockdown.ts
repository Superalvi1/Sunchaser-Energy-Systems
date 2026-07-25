/**
 * Lockdown for /api/marketplace/admin/*.
 * Requires hydrated CRM JWT actor, MARKETPLACE_ENABLED, and `marketplace` permission.
 */
import type { NextFunction, Request, Response } from "express";
import { canAccessMarketplaceAdmin } from "../marketplace/MarketplacePermissions.ts";
import {
  isMarketplaceEnabled,
  readMarketplaceConfig,
} from "../marketplace/marketplaceConfig.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../marketplace/catalogue/catalogueTypes.ts";
import type { RequestActor } from "./actor.ts";

export type MarketplaceLockdownDeps = {
  env?: NodeJS.ProcessEnv;
};

function setApiVersion(res: Response): void {
  res.setHeader(MARKETPLACE_API_VERSION_HEADER, MARKETPLACE_API_VERSION);
}

function sendLockdownError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  setApiVersion(res);
  res.status(status).json({
    ok: false,
    error: { code, message },
  });
}

export function createMarketplaceRouteLockdown(
  deps: MarketplaceLockdownDeps = {},
) {
  const env = deps.env ?? process.env;

  return function marketplaceRouteLockdown(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    setApiVersion(res);

    const config = readMarketplaceConfig(env);
    if (!isMarketplaceEnabled(config)) {
      sendLockdownError(
        res,
        503,
        "MARKETPLACE_DISABLED",
        "Marketplace catalogue is disabled.",
      );
      return;
    }

    const actor = req.actor as RequestActor | undefined;
    if (!actor) {
      sendLockdownError(res, 401, "UNAUTHORIZED", "Unauthorized");
      return;
    }

    if (!canAccessMarketplaceAdmin(actor)) {
      sendLockdownError(
        res,
        403,
        "FORBIDDEN",
        "Marketplace admin access denied.",
      );
      return;
    }

    next();
  };
}
