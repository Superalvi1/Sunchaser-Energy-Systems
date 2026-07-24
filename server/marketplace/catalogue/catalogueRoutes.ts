import type { Request, Response, Router } from "express";
import express from "express";
import {
  isMarketplaceEnabled,
  readMarketplaceConfig,
} from "../marketplaceConfig.ts";
import {
  CatalogueRepositoryError,
  createSupabaseCatalogueRepository,
  type CatalogueRepository,
} from "./catalogueRepository.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "./catalogueTypes.ts";
import {
  isValidCatalogueSlug,
  parseFeaturedFilter,
  parseOptionalSlugFilter,
} from "./catalogueValidation.ts";

export type CatalogueRouterDeps = {
  env?: NodeJS.ProcessEnv;
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
    "CATALOGUE_QUERY_FAILED",
    "Unable to load catalogue data.",
  );
}

/**
 * Public catalogue read API.
 * Requires MARKETPLACE_ENABLED=true. Defaults remain disabled.
 */
export function createCatalogueRouter(deps: CatalogueRouterDeps = {}): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const repository = deps.repository ?? createSupabaseCatalogueRepository();

  router.use((_req, res, next) => {
    setApiVersion(res);
    const config = readMarketplaceConfig(env);
    if (!isMarketplaceEnabled(config)) {
      return sendError(
        res,
        503,
        "MARKETPLACE_DISABLED",
        "Marketplace catalogue is disabled.",
      );
    }
    return next();
  });

  router.get("/categories", async (_req: Request, res: Response) => {
    try {
      const data = await repository.listCategories();
      return sendOk(res, data);
    } catch (err) {
      return handleRepositoryError(res, err);
    }
  });

  router.get("/brands", async (_req: Request, res: Response) => {
    try {
      const data = await repository.listBrands();
      return sendOk(res, data);
    } catch (err) {
      return handleRepositoryError(res, err);
    }
  });

  router.get("/products", async (req: Request, res: Response) => {
    try {
      const category = parseOptionalSlugFilter(req.query.category, "category");
      if (category === "invalid") {
        return sendError(
          res,
          400,
          "INVALID_FILTER",
          "Invalid category filter.",
        );
      }
      const brand = parseOptionalSlugFilter(req.query.brand, "brand");
      if (brand === "invalid") {
        return sendError(res, 400, "INVALID_FILTER", "Invalid brand filter.");
      }
      const featured = parseFeaturedFilter(req.query.featured);
      if (featured === "invalid") {
        return sendError(
          res,
          400,
          "INVALID_FILTER",
          "Invalid featured filter.",
        );
      }

      const data = await repository.listProducts({
        category,
        brand,
        featured,
      });
      return sendOk(res, data);
    } catch (err) {
      return handleRepositoryError(res, err);
    }
  });

  router.get("/products/:slug", async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug || "").trim().toLowerCase();
      if (!isValidCatalogueSlug(slug)) {
        return sendError(res, 400, "INVALID_SLUG", "Invalid product slug.");
      }
      const product = await repository.getProductBySlug(slug);
      if (!product) {
        return sendError(
          res,
          404,
          "PRODUCT_NOT_FOUND",
          "Product not found.",
        );
      }
      return sendOk(res, product);
    } catch (err) {
      return handleRepositoryError(res, err);
    }
  });

  return router;
}
