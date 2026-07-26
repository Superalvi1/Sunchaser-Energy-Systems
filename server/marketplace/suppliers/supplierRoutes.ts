/**
 * WS4 admin routes — alerts, price-check run, supplier mappings.
 * Mounted at /api/marketplace/admin after marketplace lockdown.
 */
import type { Request, Response, Router } from "express";
import express from "express";
import type { RequestActor } from "../../middleware/actor.ts";
import { createMarketplaceRouteLockdown } from "../../middleware/marketplaceRouteLockdown.ts";
import {
  canAccessMarketplaceAdmin,
  canAccessMarketplacePricing,
  superAdminActorScope,
} from "../MarketplacePermissions.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../catalogue/catalogueTypes.ts";
import { createSupplierIngestionService } from "./supplierIngestionService.ts";
import {
  createSupabaseSupplierRepository,
  type SupplierRepository,
} from "./supplierRepository.ts";
import { SupplierError } from "./supplierTypes.ts";
import { parseMappingBody, parsePriceCheckBody } from "./supplierValidation.ts";

export type SupplierRouterDeps = {
  env?: NodeJS.ProcessEnv;
  repository?: SupplierRepository;
  ingestion?: ReturnType<typeof createSupplierIngestionService>;
};

function setApiVersion(res: Response): void {
  res.setHeader(MARKETPLACE_API_VERSION_HEADER, MARKETPLACE_API_VERSION);
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): Response {
  setApiVersion(res);
  return res.status(status).json({ ok: false, error: { code, message } });
}

function sendOk<T>(res: Response, data: T, status = 200): Response {
  setApiVersion(res);
  return res.status(status).json({ ok: true, data });
}

function handleError(res: Response, err: unknown): Response {
  if (err instanceof SupplierError) {
    return sendError(res, err.status, err.code, err.message);
  }
  return sendError(res, 500, "INTERNAL_ERROR", "Unable to process supplier request.");
}

function requireMarketplaceStaff(
  req: Request,
  res: Response,
): RequestActor | null {
  const actor = req.actor as RequestActor | undefined;
  if (!actor) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return null;
  }
  if (!canAccessMarketplaceAdmin(actor)) {
    sendError(res, 403, "FORBIDDEN", "Marketplace admin access denied.");
    return null;
  }
  return actor;
}

function requireSuperAdmin(req: Request, res: Response): RequestActor | null {
  const actor = requireMarketplaceStaff(req, res);
  if (!actor) return null;
  if (!canAccessMarketplacePricing(actor)) {
    sendError(
      res,
      403,
      "FORBIDDEN",
      "Supplier mapping changes require Super Admin.",
    );
    return null;
  }
  return actor;
}

function adminScope(actor: RequestActor): string {
  if (canAccessMarketplacePricing(actor)) return superAdminActorScope(actor);
  return `admin:${actor.id}`;
}

/**
 * Routes (relative to /api/marketplace/admin):
 * - GET  /price-alerts
 * - POST /price-check/run
 * - POST /suppliers/mappings
 */
export function createMarketplaceSupplierRouter(
  deps: SupplierRouterDeps = {},
): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const repository = deps.repository ?? createSupabaseSupplierRepository();
  const ingestion =
    deps.ingestion ??
    createSupplierIngestionService({ repository, env });

  router.use(createMarketplaceRouteLockdown({ env }));

  router.get("/price-alerts", async (req, res) => {
    const actor = requireMarketplaceStaff(req, res);
    if (!actor) return;
    try {
      const resolved =
        typeof req.query.resolved === "string"
          ? req.query.resolved === "true"
            ? true
            : req.query.resolved === "false"
              ? false
              : null
          : null;
      const alerts = await repository.listAlerts(adminScope(actor), resolved);
      return sendOk(res, { alerts });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/price-check/run", async (req, res) => {
    const actor = requireMarketplaceStaff(req, res);
    if (!actor) return;
    try {
      // Reject role spoofing via headers (actor is server-hydrated only).
      if (req.headers["x-actor-role"] || req.headers["x-actor-scope"]) {
        return sendError(
          res,
          400,
          "FORBIDDEN_FIELD",
          "Client-supplied actor headers are not allowed.",
        );
      }
      const { trigger } = parsePriceCheckBody(req.body);
      const result = await ingestion.runPriceCheck({
        trigger,
        actorScope: adminScope(actor),
        changedBy: actor.id,
      });
      return sendOk(res, result, 202);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/suppliers/mappings", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      if (req.headers["x-actor-role"] || req.headers["x-actor-scope"]) {
        return sendError(
          res,
          400,
          "FORBIDDEN_FIELD",
          "Client-supplied actor headers are not allowed.",
        );
      }
      const input = parseMappingBody(req.body);
      const result = await repository.upsertMapping(
        input,
        superAdminActorScope(actor),
      );
      return sendOk(res, result, 201);
    } catch (err) {
      return handleError(res, err);
    }
  });

  return router;
}
