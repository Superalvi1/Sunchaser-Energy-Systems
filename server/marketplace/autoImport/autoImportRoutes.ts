/**
 * Super-Admin routes for CEO automatic supplier import + sync health.
 */
import type { Request, Response, Router } from "express";
import express from "express";
import type { RequestActor } from "../../middleware/actor.ts";
import { createMarketplaceRouteLockdown } from "../../middleware/marketplaceRouteLockdown.ts";
import {
  canAccessMarketplacePricing,
  superAdminActorScope,
} from "../MarketplacePermissions.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../catalogue/catalogueTypes.ts";
import { createAutoImportService } from "./autoImportService.ts";

export type AutoImportRouterDeps = {
  env?: NodeJS.ProcessEnv;
  service?: ReturnType<typeof createAutoImportService>;
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

function requireSuperAdmin(req: Request, res: Response): RequestActor | null {
  const actor = req.actor as RequestActor | undefined;
  if (!actor) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return null;
  }
  if (!canAccessMarketplacePricing(actor)) {
    sendError(
      res,
      403,
      "FORBIDDEN",
      "CEO auto-import requires Super Admin.",
    );
    return null;
  }
  return actor;
}

/**
 * Routes (relative to /api/marketplace/admin):
 * - POST /suppliers/auto-import/run
 * - GET  /suppliers/auto-import/health
 * - GET  /suppliers/auto-import/listings
 */
export function createMarketplaceAutoImportRouter(
  deps: AutoImportRouterDeps = {},
): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const service = deps.service ?? createAutoImportService({ env });

  router.use(createMarketplaceRouteLockdown({ env }));

  router.post("/suppliers/auto-import/run", async (req, res) => {
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
      const result = await service.runAutomaticImport({
        actorScope: superAdminActorScope(actor),
      });
      return sendOk(res, result, 202);
    } catch {
      return sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Unable to run automatic supplier import.",
      );
    }
  });

  router.get("/suppliers/auto-import/health", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      return sendOk(res, await service.getHealth());
    } catch {
      return sendError(res, 500, "INTERNAL_ERROR", "Unable to load sync health.");
    }
  });

  router.get("/suppliers/auto-import/listings", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const listings = await service.listListings();
      return sendOk(res, {
        count: listings.length,
        listings: listings.slice(0, 200).map((l) => ({
          identityKey: l.identityKey,
          title: l.title,
          slug: l.slug,
          websitePricePkr: l.websitePricePkr,
          selectedSupplier: l.selectedSupplier,
          availability: l.availability,
          lastSyncedAt: l.lastSyncedAt,
          priceReason: l.priceReason,
          matchReason: l.matchReason,
          sourceUrls: l.sourceUrls,
        })),
      });
    } catch {
      return sendError(res, 500, "INTERNAL_ERROR", "Unable to list import listings.");
    }
  });

  return router;
}
