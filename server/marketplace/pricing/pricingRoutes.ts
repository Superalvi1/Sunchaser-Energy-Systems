/**
 * WS3 Super-Admin pricing/cost/override/config/mapping routes.
 * Mounted at /api/marketplace/admin with marketplace lockdown + Super Admin gate.
 */
import type { Request, Response, Router } from "express";
import express from "express";
import type { RequestActor } from "../../middleware/actor.ts";
import { createMarketplaceRouteLockdown } from "../../middleware/marketplaceRouteLockdown.ts";
import { canAccessMarketplacePricing } from "../MarketplacePermissions.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../catalogue/catalogueTypes.ts";
import {
  createSupabasePricingRepository,
  type PricingRepository,
} from "./pricingRepository.ts";
import { PricingError } from "./pricingTypes.ts";
import {
  parseCreateCostBody,
  parseCreateOverrideBody,
  parsePatchCostBody,
  parsePricingConfigPatch,
  parsePublishBody,
  parseSupplierMappingBody,
} from "./pricingValidation.ts";

export type PricingRouterDeps = {
  env?: NodeJS.ProcessEnv;
  repository?: PricingRepository;
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
  if (err instanceof PricingError) {
    return sendError(res, err.status, err.code, err.message);
  }
  return sendError(
    res,
    500,
    "INTERNAL_ERROR",
    "Unable to process pricing request.",
  );
}

function requirePricingActor(req: Request, res: Response): RequestActor | null {
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
      "Marketplace pricing access requires Super Admin.",
    );
    return null;
  }
  return actor;
}

function actorRef(actor: RequestActor) {
  return { id: actor.id, username: actor.username, role: actor.role };
}

/**
 * Pricing admin API (Super Admin only after marketplace lockdown).
 *
 * Routes (relative to /api/marketplace/admin):
 * - GET/POST /costs
 * - PATCH /costs/:id
 * - GET /variants/:id/margin
 * - POST /pricing/publish
 * - POST /overrides
 * - DELETE /overrides/:id  (soft revoke)
 * - GET/PATCH /pricing-config
 * - POST /suppliers/mappings
 */
export function createMarketplacePricingRouter(
  deps: PricingRouterDeps = {},
): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const repo = deps.repository ?? createSupabasePricingRepository();

  router.use(createMarketplaceRouteLockdown({ env }));

  router.get("/costs", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      const variantId =
        typeof req.query.variantId === "string"
          ? req.query.variantId
          : undefined;
      return sendOk(res, await repo.listCosts(variantId));
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/costs", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      const input = parseCreateCostBody(req.body);
      return sendOk(res, await repo.createCost(input, actorRef(actor)), 201);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.patch("/costs/:id", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      const patch = parsePatchCostBody(req.body);
      return sendOk(
        res,
        await repo.updateCost(String(req.params.id || ""), patch, actorRef(actor)),
      );
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/variants/:id/margin", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      return sendOk(
        res,
        await repo.getMargin(String(req.params.id || "")),
      );
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/pricing/publish", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      const input = parsePublishBody(req.body);
      return sendOk(
        res,
        await repo.publishPrice(input.variantId, actorRef(actor)),
      );
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/overrides", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      const input = parseCreateOverrideBody(req.body);
      return sendOk(
        res,
        await repo.createOverride(input, actorRef(actor)),
        201,
      );
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.delete("/overrides/:id", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      return sendOk(
        res,
        await repo.revokeOverride(
          String(req.params.id || ""),
          actorRef(actor),
        ),
      );
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/pricing-config", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      return sendOk(res, await repo.getPricingConfig());
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.patch("/pricing-config", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      const patch = parsePricingConfigPatch(req.body);
      return sendOk(
        res,
        await repo.updatePricingConfig(patch, actorRef(actor)),
      );
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/suppliers/mappings", async (req, res) => {
    const actor = requirePricingActor(req, res);
    if (!actor) return;
    try {
      const input = parseSupplierMappingBody(req.body);
      return sendOk(
        res,
        await repo.upsertSupplierMapping(input, actorRef(actor)),
        201,
      );
    } catch (err) {
      return handleError(res, err);
    }
  });

  return router;
}
