/**
 * Super-Admin Catalogue Manager API.
 * Mounted at /api/marketplace/admin/catalogue-manager
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
import { CatalogueManagerError } from "./catalogueManagerTypes.ts";
import {
  createMemoryCatalogueManagerRepository,
  type CatalogueManagerRepository,
} from "./memoryCatalogueManagerRepository.ts";
import {
  parseBulkCategoryBody,
  parseBulkPublishBody,
  parseManualPrimaryImageBody,
  parsePatchProductBody,
  parseProductListQuery,
  parseSetOverrideBody,
  parseSupplierMediaBody,
} from "./catalogueManagerValidation.ts";

export type CatalogueManagerRouterDeps = {
  env?: NodeJS.ProcessEnv;
  repository?: CatalogueManagerRepository;
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
  if (err instanceof CatalogueManagerError) {
    return sendError(res, err.status, err.code, err.message);
  }
  return sendError(
    res,
    500,
    "INTERNAL_ERROR",
    "Unable to process catalogue manager request.",
  );
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
      "Catalogue Manager requires Super Admin.",
    );
    return null;
  }
  return actor;
}

function actorRef(actor: RequestActor) {
  return { id: actor.id, username: actor.username, role: actor.role };
}

export function createCatalogueManagerRouter(
  deps: CatalogueManagerRouterDeps = {},
): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const repo = deps.repository ?? createMemoryCatalogueManagerRepository();

  router.use(createMarketplaceRouteLockdown({ env }));

  router.get("/products", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const filters = parseProductListQuery(req.query as Record<string, unknown>);
      const data = await repo.listProducts(filters);
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/products/bulk/publish", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const input = parseBulkPublishBody(req.body);
      const updated = await repo.bulkPublish(input, actorRef(actor));
      return sendOk(res, { updated });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/products/bulk/category", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const input = parseBulkCategoryBody(req.body);
      const updated = await repo.bulkCategory(input, actorRef(actor));
      return sendOk(res, { updated });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/products/:id", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const data = await repo.getProduct(String(req.params.id || ""));
      if (!data) {
        return sendError(res, 404, "PRODUCT_NOT_FOUND", "Product not found.");
      }
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.patch("/products/:id", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const patch = parsePatchProductBody(req.body);
      const data = await repo.patchProduct(
        String(req.params.id || ""),
        patch,
        actorRef(actor),
      );
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/products/:id/overrides", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const input = parseSetOverrideBody(req.body);
      const data = await repo.setOverride(
        String(req.params.id || ""),
        input,
        actorRef(actor),
      );
      return sendOk(res, data, 201);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.delete("/products/:id/overrides/:fieldName", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const cleared = await repo.clearOverride(
        String(req.params.id || ""),
        String(req.params.fieldName || ""),
        actorRef(actor),
      );
      return sendOk(res, { cleared });
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/products/:id/media", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const data = await repo.listMedia(String(req.params.id || ""));
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/products/:id/media/supplier", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const { images, supplier } = parseSupplierMediaBody(req.body);
      const data = await repo.replaceSupplierMedia(
        String(req.params.id || ""),
        images,
        supplier,
      );
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/products/:id/media/manual-primary", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const url = parseManualPrimaryImageBody(req.body);
      const data = await repo.setManualPrimaryImage(
        String(req.params.id || ""),
        url,
        actorRef(actor),
      );
      return sendOk(res, data, 201);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/products/:id/audit", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const data = await repo.listAudit(String(req.params.id || ""));
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/reconciliation", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) return;
    try {
      const data = await repo.reconciliation({
        discoveredProducts:
          req.query.discoveredProducts !== undefined
            ? Number(req.query.discoveredProducts)
            : undefined,
        normalizedAcceptedObservations:
          req.query.normalizedAcceptedObservations !== undefined
            ? Number(req.query.normalizedAcceptedObservations)
            : undefined,
      });
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  return router;
}
