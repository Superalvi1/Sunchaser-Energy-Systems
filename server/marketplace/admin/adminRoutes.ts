/**
 * Marketplace admin router — WS2B access foundation.
 * Read-only taxonomy endpoints only (brands / categories).
 */
import type { Request, Response, Router } from "express";
import express from "express";
import { createMarketplaceRouteLockdown } from "../../middleware/marketplaceRouteLockdown.ts";
import {
  CatalogueRepositoryError,
  createSupabaseCatalogueRepository,
  type CatalogueRepository,
} from "../catalogue/catalogueRepository.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "../catalogue/catalogueTypes.ts";

export type MarketplaceAdminRouterDeps = {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests — backs mp_brands / mp_categories only. */
  repository?: CatalogueRepository;
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
  return res.status(status).json({
    ok: false,
    error: { code, message },
  });
}

function sendOk<T>(res: Response, data: T, status = 200): Response {
  setApiVersion(res);
  return res.status(status).json({ ok: true, data });
}

function handleRepositoryError(res: Response, err: unknown): Response {
  if (err instanceof CatalogueRepositoryError) {
    const status = err.code === "CATALOGUE_UNAVAILABLE" ? 503 : 500;
    return sendError(res, status, err.code, err.message);
  }
  return sendError(
    res,
    500,
    "ADMIN_QUERY_FAILED",
    "Unable to load marketplace admin data.",
  );
}

/**
 * Protected admin catalogue taxonomy API.
 * Requires JWT + marketplace permission + MARKETPLACE_ENABLED.
 */
export function createMarketplaceAdminRouter(
  deps: MarketplaceAdminRouterDeps = {},
): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const repository = deps.repository ?? createSupabaseCatalogueRepository();

  router.use(createMarketplaceRouteLockdown({ env }));

  router.get("/brands", async (_req: Request, res: Response) => {
    try {
      const data = await repository.listBrands();
      return sendOk(res, data);
    } catch (err) {
      return handleRepositoryError(res, err);
    }
  });

  router.get("/categories", async (_req: Request, res: Response) => {
    try {
      const data = await repository.listCategories();
      return sendOk(res, data);
    } catch (err) {
      return handleRepositoryError(res, err);
    }
  });

  return router;
}
