import type { NextFunction, Request, Response } from "express";
import type { Database } from "../../dbManager";
import {
  actorToLegacyUser,
  hydrateActorFromJwt,
  readBearerToken,
  type RequestActor,
} from "./actor.ts";
import { isMigratedProtectedRoute, isProtectedApiPath } from "./routePolicy.ts";

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      actor?: RequestActor;
    }
  }
}

type RequireAuthDeps = {
  resolveLocalDb: () => Database;
};

function applyActorToRequest(req: Request, actor: RequestActor): void {
  req.actor = actor;
  req.user = actorToLegacyUser(actor);
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ error: "Unauthorized" });
}

export function createRequireAuth(deps: RequireAuthDeps) {
  return async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (req.actor) {
      req.user = actorToLegacyUser(req.actor);
      next();
      return;
    }

    const token = readBearerToken(req);
    if (!token) {
      sendUnauthorized(res);
      return;
    }

    try {
      const hydrated = await hydrateActorFromJwt(token, deps.resolveLocalDb());
      if (!hydrated.ok) {
        res.status(hydrated.status).json({ error: hydrated.error });
        return;
      }
      applyActorToRequest(req, hydrated.actor);
      next();
    } catch {
      sendUnauthorized(res);
    }
  };
}

/** @deprecated Phase 1A sync guard — prefer createRequireAuth with DB hydration. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readBearerToken(req);
  if (!token) {
    sendUnauthorized(res);
    return;
  }
  if (req.actor) {
    req.user = actorToLegacyUser(req.actor);
    next();
    return;
  }
  sendUnauthorized(res);
}

export { isMigratedProtectedRoute, isProtectedApiPath };

/** @deprecated Replaced by createAuthorizationMiddleware in Phase 1B.1. */
export function protectSelectedApiRoutes(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isMigratedProtectedRoute(req.path)) {
    next();
    return;
  }
  requireAuth(req, res, next);
}
