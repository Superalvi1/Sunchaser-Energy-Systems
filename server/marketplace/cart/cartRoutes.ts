import type { Request, Response, Router } from "express";
import express from "express";
import { getSupabase } from "../../../dbManager.ts";
import type { Database } from "../../../dbManager.ts";
import {
  isMarketplaceCartEnabled,
  isMarketplaceEnabled,
  readMarketplaceConfig,
} from "../marketplaceConfig.ts";
import {
  resolveCreateIdentity,
  resolveOwnedIdentity,
  type CartIdentityDeps,
} from "./cartIdentity.ts";
import {
  CartRepositoryError,
  createSupabaseCartRepository,
  type CartRepository,
} from "./cartRepository.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "./cartTypes.ts";
import {
  hasTokenSmuggling,
  parseCartItemBody,
  parseCheckoutBody,
  parseDeliveryQuoteBody,
  parseIdempotencyKey,
  parsePublicRefParam,
} from "./cartValidation.ts";

export type CartRouterDeps = {
  env?: NodeJS.ProcessEnv;
  repository?: CartRepository;
  resolveLocalDb?: () => Database | undefined;
};

type DeliveryReadiness = {
  backendDatabaseCredentialReady: boolean;
  schemaReady: boolean;
  lhrZoneReady: boolean;
  lhrCodEligible: boolean;
  lhrDeliveryRateReady: boolean;
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

function statusForCode(code: string): number {
  switch (code) {
    case "CART_NOT_FOUND":
    case "VARIANT_NOT_FOUND":
    case "PRODUCT_NOT_FOUND":
      return 404;
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
    case "CART_NOT_AUTHORIZED":
      return 401;
    case "CART_EXPIRED":
    case "CART_ALREADY_CHECKED_OUT":
    case "PRODUCT_UNAVAILABLE":
    case "CONFIRM_PRICE_REQUIRED":
    case "STOCK_NOT_ELIGIBLE":
    case "INVALID_QUANTITY":
    case "INVALID_DELIVERY_ZONE":
    case "DELIVERY_NOT_AVAILABLE":
    case "COD_NOT_AVAILABLE":
    case "PRICE_CHANGED":
    case "EMPTY_CART":
    case "IDEMPOTENCY_KEY_REQUIRED":
    case "VALIDATION_ERROR":
      return 400;
    case "IDEMPOTENCY_CONFLICT":
    case "CONFLICT":
      return 409;
    case "MARKETPLACE_DISABLED":
    case "MARKETPLACE_CART_DISABLED":
      return 503;
    default:
      return 500;
  }
}

function handleRepoError(res: Response, err: unknown): Response {
  if (err instanceof CartRepositoryError) {
    return sendError(res, statusForCode(err.code), err.code, err.message);
  }
  return sendError(res, 500, "INTERNAL_ERROR", "Request failed.");
}

function rejectSmuggledTokens(req: Request, res: Response): boolean {
  if (hasTokenSmuggling(req.query as Record<string, unknown>, req.body)) {
    sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Tokens must be sent via approved headers only.",
    );
    return true;
  }
  return false;
}

async function probeLhrDeliveryReadiness(
  env: NodeJS.ProcessEnv,
): Promise<DeliveryReadiness> {
  const backendDatabaseCredentialReady = Boolean(
    String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  );
  const empty: DeliveryReadiness = {
    backendDatabaseCredentialReady,
    schemaReady: false,
    lhrZoneReady: false,
    lhrCodEligible: false,
    lhrDeliveryRateReady: false,
  };

  // WS5 RPCs intentionally are not browser-role RPCs. Require the backend
  // service-role credential before declaring checkout production-ready.
  if (!backendDatabaseCredentialReady) return empty;

  const supabase = getSupabase();
  if (!supabase) return empty;

  try {
    const { data: zones, error: zoneError } = await supabase
      .from("mp_delivery_zones")
      .select("id,code,cod_eligible,active")
      .eq("code", "LHR")
      .limit(1);

    if (zoneError) return empty;

    const zone = Array.isArray(zones) ? zones[0] : null;
    if (!zone) {
      return { ...empty, schemaReady: true };
    }

    const lhrZoneReady = zone.active === true && zone.code === "LHR";
    const lhrCodEligible = lhrZoneReady && zone.cod_eligible === true;

    const { data: rates, error: rateError } = await supabase
      .from("mp_delivery_rates")
      .select("id,active")
      .eq("zone_id", String(zone.id))
      .eq("active", true)
      .limit(1);

    if (rateError) {
      return {
        ...empty,
        schemaReady: false,
        lhrZoneReady,
        lhrCodEligible,
      };
    }

    return {
      backendDatabaseCredentialReady,
      schemaReady: true,
      lhrZoneReady,
      lhrCodEligible,
      lhrDeliveryRateReady: Array.isArray(rates) && rates.length > 0,
    };
  } catch {
    return empty;
  }
}

/** Paths owned by WS5 cart/checkout (relative to /api/marketplace). */
function isCartOwnedPath(path: string): boolean {
  if (path === "/cart" || path.startsWith("/cart/")) return true;
  if (path === "/checkout" || path.startsWith("/checkout/")) return true;
  if (path === "/delivery/quote" || path.startsWith("/delivery/quote/")) {
    return true;
  }
  // Order read is cart-owned; payment/COD subpaths are not.
  if (path.startsWith("/orders/")) {
    if (path.includes("/payments") || path.includes("/cod")) return false;
    return true;
  }
  return false;
}

/**
 * Cart, delivery quote, checkout, and order-read routes.
 * Requires MARKETPLACE_ENABLED=true AND MARKETPLACE_CART_ENABLED=true.
 * Defaults remain disabled so CEO auto-import can enable independently.
 */
export function createCartRouter(deps: CartRouterDeps = {}): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const repository = deps.repository ?? createSupabaseCartRepository();
  const identityDeps: CartIdentityDeps = {
    resolveLocalDb: deps.resolveLocalDb,
  };

  // Read-only operational readiness. It creates no cart/order, publishes no
  // secrets, is never cached, and is explicitly excluded from search indexing.
  router.get("/checkout/readiness", async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    const config = readMarketplaceConfig(env);
    const delivery = await probeLhrDeliveryReadiness(env);
    const ready =
      config.enabled === true &&
      config.cartEnabled === true &&
      config.codEnabled === true &&
      delivery.backendDatabaseCredentialReady &&
      delivery.schemaReady &&
      delivery.lhrZoneReady &&
      delivery.lhrCodEligible &&
      delivery.lhrDeliveryRateReady;

    return sendOk(res, {
      ready,
      marketplaceEnabled: config.enabled,
      cartEnabled: config.cartEnabled,
      codEnabled: config.codEnabled,
      catalogueSource: config.catalogueSource,
      expectedDeliveryZone: "LHR",
      ...delivery,
    });
  });

  router.use((req, res, next) => {
    // Only gate cart/checkout/order-read paths; pass other /api/marketplace/*
    // traffic through so payments/COD can apply their own feature gates.
    if (!isCartOwnedPath(req.path)) {
      return next("router");
    }
    setApiVersion(res);
    const config = readMarketplaceConfig(env);
    if (!isMarketplaceEnabled(config)) {
      return sendError(
        res,
        503,
        "MARKETPLACE_DISABLED",
        "Marketplace is disabled.",
      );
    }
    if (!isMarketplaceCartEnabled(config)) {
      return sendError(
        res,
        503,
        "MARKETPLACE_CART_DISABLED",
        "Marketplace cart/checkout is disabled.",
      );
    }
    return next();
  });

  router.post("/cart", async (req: Request, res: Response) => {
    try {
      if (rejectSmuggledTokens(req, res)) return;
      if (
        req.body != null &&
        typeof req.body === "object" &&
        !Array.isArray(req.body) &&
        Object.keys(req.body as object).length > 0
      ) {
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "Request contains unsupported fields.",
        );
      }
      const identity = await resolveCreateIdentity(req, identityDeps);
      if (identity.ok === false) {
        return sendError(res, identity.status, identity.code, identity.message);
      }
      const config = readMarketplaceConfig(env);
      const data = await repository.createCart(
        identity.identity,
        config.possessionTokenTtlHours,
      );
      return sendOk(res, data, 201);
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  router.post("/cart/:public_ref/items", async (req: Request, res: Response) => {
    try {
      if (rejectSmuggledTokens(req, res)) return;
      const ref = parsePublicRefParam(req.params.public_ref);
      if (ref.ok === false) {
        return sendError(res, 404, ref.code, ref.message);
      }
      if (!ref.value.startsWith("mpcref_")) {
        return sendError(res, 404, "CART_NOT_FOUND", "Cart not found.");
      }
      const parsed = parseCartItemBody(req.body);
      if (parsed.ok === false) {
        return sendError(res, statusForCode(parsed.code), parsed.code, parsed.message);
      }
      const identity = await resolveOwnedIdentity(req, ref.value, identityDeps);
      if (identity.ok === false) {
        return sendError(res, identity.status, identity.code, identity.message);
      }
      const data = await repository.upsertItem(
        identity.identity,
        ref.value,
        parsed.value.sku,
        parsed.value.quantity,
      );
      return sendOk(res, data);
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  router.post("/delivery/quote", async (req: Request, res: Response) => {
    try {
      if (rejectSmuggledTokens(req, res)) return;
      const parsed = parseDeliveryQuoteBody(req.body);
      if (parsed.ok === false) {
        return sendError(res, statusForCode(parsed.code), parsed.code, parsed.message);
      }
      const identity = await resolveOwnedIdentity(
        req,
        parsed.value.publicRef,
        identityDeps,
      );
      if (identity.ok === false) {
        return sendError(res, identity.status, identity.code, identity.message);
      }
      const data = await repository.quoteDelivery(
        identity.identity,
        parsed.value.publicRef,
        parsed.value.zoneCode,
      );
      return sendOk(res, data);
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  router.post("/checkout", async (req: Request, res: Response) => {
    try {
      if (rejectSmuggledTokens(req, res)) return;
      const parsed = parseCheckoutBody(req.body);
      if (parsed.ok === false) {
        return sendError(res, statusForCode(parsed.code), parsed.code, parsed.message);
      }
      const idem = parseIdempotencyKey(
        req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
      );
      if (idem.ok === false) {
        return sendError(res, statusForCode(idem.code), idem.code, idem.message);
      }
      const identity = await resolveOwnedIdentity(
        req,
        parsed.value.publicRef,
        identityDeps,
      );
      if (identity.ok === false) {
        return sendError(res, identity.status, identity.code, identity.message);
      }
      const data = await repository.checkout(identity.identity, {
        publicRef: parsed.value.publicRef,
        zoneCode: parsed.value.zoneCode,
        planType: parsed.value.planType,
        idempotencyKey: idem.value,
      });
      return sendOk(res, data, data.replay ? 200 : 201);
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  router.get("/orders/:public_ref", async (req: Request, res: Response) => {
    try {
      if (rejectSmuggledTokens(req, res)) return;
      const ref = parsePublicRefParam(req.params.public_ref);
      if (ref.ok === false) {
        return sendError(res, 404, ref.code, ref.message);
      }
      if (!ref.value.startsWith("mporef_")) {
        return sendError(res, 404, "CART_NOT_FOUND", "Not found.");
      }
      const identity = await resolveOwnedIdentity(req, ref.value, identityDeps);
      if (identity.ok === false) {
        return sendError(res, identity.status, identity.code, identity.message);
      }
      const data = await repository.getOrder(identity.identity, ref.value);
      return sendOk(res, data);
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  return router;
}
