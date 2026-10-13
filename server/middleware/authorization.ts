import type { NextFunction, Request, Response } from "express";
import type { Database } from "../../dbManager";
import { hydrateActorFromJwt, readBearerToken } from "./actor.ts";
import { isCustomerAllowedApiRoute } from "./customerRoutePolicy.ts";
import { isProtectedApiRoute, resolveRouteAccessPolicy } from "./routePolicy.ts";
import { runAsFoundingCompany, runWithCompany } from "../saas/companyContext.ts";
import { resolveCompany, type CompanyStore } from "../saas/companyResolver.ts";
import { resolveCompanyScope } from "../saas/companyScopePolicy.ts";
import { isMultiCompanyEnabled } from "../saas/multiCompany.ts";

declare global {
  namespace Express {
    interface Request {
      actor?: import("./actor.ts").RequestActor;
      /** Session details of the verified JWT (start time, current password version); set with `actor`. */
      authSession?: import("./actor.ts").AuthSessionInfo;
    }
  }
}

export type AuthorizationMiddlewareDeps = {
  resolveLocalDb: () => Database;
  /** Required when MULTI_COMPANY_ENABLED=true. */
  companyStore?: CompanyStore;
  /** Second, independent company check for object routes (see server/saas/ownershipGuard.ts). Runs after the company is resolved. */
  ownershipGuard?: (req: Request, res: Response, next: NextFunction, companyId: string) => Promise<void>;
};

function sendAuthFailure(
  res: Response,
  status: 401 | 403 | 503,
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

    const multi = isMultiCompanyEnabled();
    const scope = multi ? resolveCompanyScope(req.method, path) : "none";

    if (multi && scope === "unmatched") {
      sendAuthFailure(res, 403, "This route is not enabled for company accounts.");
      return;
    }

    if (!isProtectedApiRoute(req.method, path)) {
      // Non-API paths and public intake. Public intake is not yet resolved per company: it runs as the founding company.
      if (multi && scope !== "none") runAsFoundingCompany(() => next());
      else next();
      return;
    }

    const policy = resolveRouteAccessPolicy(req.method, path);
    if (policy.kind === "public") {
      if (multi && scope !== "none") runAsFoundingCompany(() => next());
      else next();
      return;
    }

    const token = readBearerToken(req);
    if (!token) {
      sendAuthFailure(res, 401, "Unauthorized");
      return;
    }

    let hydrated;
    try {
      hydrated = await hydrateActorFromJwt(token, deps.resolveLocalDb());
    } catch (err) {
      // The account/session store could not be read: refuse (fail closed) instead of hanging the request.
      console.error("[Auth] session lookup failed:", (err as Error)?.message);
      sendAuthFailure(res, 503, "Authentication service temporarily unavailable.");
      return;
    }
    if (!hydrated.ok) {
      sendAuthFailure(res, (hydrated as any).status, (hydrated as any).error);
      return;
    }

    req.actor = hydrated.actor;
    req.authSession = hydrated.session;
    if (req.actor.role === "Customer" && !isCustomerAllowedApiRoute(path)) {
      sendAuthFailure(res, 403, "Not authorized for staff routes.");
      return;
    }

    if (multi && scope !== "none" && scope !== "signed_link") {
      if (!deps.companyStore) {
        sendAuthFailure(res, 403, "Company access is not configured.");
        return;
      }
      let resolution;
      try {
        resolution = await resolveCompany(
          { actor: req.actor, tokenCompanyId: hydrated.tokenCompanyId, scope },
          deps.companyStore
        );
      } catch (err) {
        console.error("[company] could not resolve company:", err instanceof Error ? err.message : err);
        res.status(503).json({ error: "Company lookup is temporarily unavailable." });
        return;
      }
      if (!resolution.ok) {
        res.status(resolution.status).json({ error: resolution.error, code: resolution.code });
        return;
      }
      // Permissions follow the role the user holds in THIS company, not a global role.
      req.actor = { ...req.actor, role: resolution.role, companyId: resolution.companyId };
      const companyId = resolution.companyId;
      runWithCompany(
        { companyId, userId: req.actor.id, role: resolution.role, membershipId: resolution.membershipId },
        () => (deps.ownershipGuard ? void deps.ownershipGuard(req, res, next, companyId) : next())
      );
      return;
    }
    next();
  };
}
