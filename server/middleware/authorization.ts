import type { NextFunction, Request, Response } from "express";
import type { Database } from "../../dbManager";
import { hydrateActorFromJwt, readBearerToken } from "./actor.ts";
import { isCustomerAllowedApiRoute } from "./customerRoutePolicy.ts";
import { isProtectedApiRoute, resolveRouteAccessPolicy } from "./routePolicy.ts";

declare global {
  namespace Express {
    interface Request {
      actor?: import("./actor.ts").RequestActor;
    }
  }
}

export type AuthorizationMiddlewareDeps = {
  resolveLocalDb: () => Database;
};

function sendAuthFailure(
  res: Response,
  status: 401 | 403,
  error: string
): void {
  res.status(status).json({ error });
}

/**
 * Centralized authorization for /api/* routes.
 *
 * - Public allowlist → pass through
 * - All other /api/* → require valid Bearer JWT → req.actor
 * - X-Sunchaser-* headers and body/query identity are never trusted here
 */
export function createAuthorizationMiddleware(deps: AuthorizationMiddlewareDeps) {
  return async function authorizationMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const path = req.path;

    if (!isProtectedApiRoute(req.method, path)) {
      next();
      return;
    }

    const policy = resolveRouteAccessPolicy(req.method, path);
    if (policy.kind === "public") {
      next();
      return;
    }

    const token = readBearerToken(req);
    if (!token) {
      sendAuthFailure(res, 401, "Unauthorized");
      return;
    }

    const hydrated = await hydrateActorFromJwt(token, deps.resolveLocalDb());
    if (!hydrated.ok) {
      sendAuthFailure(res, hydrated.status, hydrated.error);
      return;
    }

    req.actor = hydrated.actor;
    if (req.actor.role === "Customer" && !isCustomerAllowedApiRoute(path)) {
      sendAuthFailure(res, 403, "Not authorized for staff routes.");
      return;
    }
    next();
  };
}
