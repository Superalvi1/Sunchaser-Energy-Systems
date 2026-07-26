/**
 * Marketplace admin router — WS2B taxonomy + WS2C product/variant management.
 */
import type { Request, Response, Router } from "express";
import express from "express";
import type { RequestActor } from "../../middleware/actor.ts";
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
import {
  createSupabaseAdminProductRepository,
  type AdminProductRepository,
} from "./adminProductRepository.ts";
import { AdminProductError } from "./adminTypes.ts";
import {
  parseCreateProductBody,
  parseCreateVariantBody,
  parsePatchProductBody,
  parsePatchVariantBody,
  parseProductListQuery,
} from "./adminValidation.ts";

export type MarketplaceAdminRouterDeps = {
  env?: NodeJS.ProcessEnv;
  /** Taxonomy reads (mp_brands / mp_categories). */
  repository?: CatalogueRepository;
  /** Product/variant admin writes and reads. */
  productRepository?: AdminProductRepository;
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

function handleError(res: Response, err: unknown): Response {
  if (err instanceof AdminProductError) {
    return sendError(res, err.status, err.code, err.message);
  }
  if (err instanceof CatalogueRepositoryError) {
    const status = err.code === "CATALOGUE_UNAVAILABLE" ? 503 : 500;
    return sendError(res, status, err.code, err.message);
  }
  return sendError(
    res,
    500,
    "ADMIN_QUERY_FAILED",
    "Unable to process marketplace admin request.",
  );
}

function actorRef(req: Request) {
  const actor = req.actor as RequestActor;
  return {
    id: actor.id,
    username: actor.username,
    role: actor.role,
  };
}

/**
 * Protected admin catalogue API.
 * Requires JWT + marketplace permission + MARKETPLACE_ENABLED.
 */
export function createMarketplaceAdminRouter(
  deps: MarketplaceAdminRouterDeps = {},
): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const taxonomy = deps.repository ?? createSupabaseCatalogueRepository();
  const products =
    deps.productRepository ?? createSupabaseAdminProductRepository();

  router.use(createMarketplaceRouteLockdown({ env }));

  router.get("/brands", async (_req: Request, res: Response) => {
    try {
      const data = await taxonomy.listBrands();
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/categories", async (_req: Request, res: Response) => {
    try {
      const data = await taxonomy.listCategories();
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/products", async (req: Request, res: Response) => {
    try {
      const filters = parseProductListQuery(
        req.query as Record<string, unknown>,
      );
      const data = await products.listProducts(filters);
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.get("/products/:id", async (req: Request, res: Response) => {
    try {
      const data = await products.getProductById(String(req.params.id || ""));
      if (!data) {
        return sendError(res, 404, "PRODUCT_NOT_FOUND", "Product not found.");
      }
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post("/products", async (req: Request, res: Response) => {
    try {
      const input = parseCreateProductBody(req.body);
      const data = await products.createProduct(input, actorRef(req));
      return sendOk(res, data, 201);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.patch("/products/:id", async (req: Request, res: Response) => {
    try {
      const input = parsePatchProductBody(req.body);
      const data = await products.updateProduct(
        String(req.params.id || ""),
        input,
        actorRef(req),
      );
      return sendOk(res, data);
    } catch (err) {
      return handleError(res, err);
    }
  });

  router.post(
    "/products/:productId/variants",
    async (req: Request, res: Response) => {
      try {
        const input = parseCreateVariantBody(req.body);
        const data = await products.createVariant(
          String(req.params.productId || ""),
          input,
          actorRef(req),
        );
        return sendOk(res, data, 201);
      } catch (err) {
        return handleError(res, err);
      }
    },
  );

  router.patch(
    "/products/:productId/variants/:variantId",
    async (req: Request, res: Response) => {
      try {
        const input = parsePatchVariantBody(req.body);
        const data = await products.updateVariant(
          String(req.params.productId || ""),
          String(req.params.variantId || ""),
          input,
          actorRef(req),
        );
        return sendOk(res, data);
      } catch (err) {
        return handleError(res, err);
      }
    },
  );

  return router;
}
