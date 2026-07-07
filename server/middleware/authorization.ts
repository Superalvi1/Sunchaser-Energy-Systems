import type { NextFunction, Request, Response } from "express";
import type { Database } from "../../dbManager";
import {
  hydrateActorFromJwt,
  hydrateActorFromLegacyHeaders,
  readBearerToken,
  isLegacyHeaderAuthEnabled,
} from "./actor.ts";
import { isPublicApiRoute } from "./publicRoutes.ts";
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
 * - All other /api/* → require req.actor (JWT hydration, or legacy headers only when LEGACY_HEADER_AUTH=true)
 * - JWT-only routes (Phase 1A) → Bearer required; legacy headers never accepted here
 *
 * When LEGACY_HEADER_AUTH=false, middleware does not read X-Sunchaser-* headers.
 * Route handlers that still call readStaffAuth()/readPortalAuth() are unchanged and
 * remain a separate migration target — middleware auth ≠ handler trust.
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

    const localDb = deps.resolveLocalDb();
    const token = readBearerToken(req);

    if (token) {
      const hydrated = await hydrateActorFromJwt(token, localDb);
      if (hydrated.ok) {
        req.actor = hydrated.actor;
        next();
        return;
      }
      if (policy.kind === "jwt_only") {
        sendAuthFailure(res, hydrated.status, hydrated.error);
        return;
      }
    }

    if (policy.kind === "jwt_only") {
      sendAuthFailure(res, 401, "Unauthorized");
      return;
    }

    // Protected (non-JWT-only) /api/* — legacy headers only when explicitly enabled.
    if (!isLegacyHeaderAuthEnabled()) {
      sendAuthFailure(res, 401, "Unauthorized");
      return;
    }

    const legacy = await hydrateActorFromLegacyHeaders(req, localDb);
    if (!legacy.ok) {
      sendAuthFailure(res, legacy.status, legacy.error);
      return;
    }

    req.actor = legacy.actor;
    next();
  };
}
