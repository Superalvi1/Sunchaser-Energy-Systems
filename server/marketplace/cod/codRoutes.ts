import type { Request, Response, Router } from "express";
import express from "express";
import type { Database } from "../../../dbManager.ts";
import {
  isMarketplaceCodEnabled,
  isMarketplaceEnabled,
  readMarketplaceConfig,
} from "../marketplaceConfig.ts";
import {
  resolveOwnedIdentity,
  type CartIdentityDeps,
} from "../cart/cartIdentity.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "./codTypes.ts";
import type { CodAction } from "./codTypes.ts";
import {
  CodRepositoryError,
  createCodRepository,
  type CodRepository,
} from "./codRepository.ts";
import {
  hasTokenSmuggling,
  parseEmptyBody,
  parseIdempotencyKey,
  parseOrderRefParam,
  parsePublicRefParam,
  parseReasonBody,
} from "./codValidation.ts";
import {
  codAdminActorScope,
  createCodRouteLockdown,
} from "./codLockdown.ts";

export type CodRouterDeps = {
  env?: NodeJS.ProcessEnv;
  repository?: CodRepository;
  resolveLocalDb?: () => Database | undefined;
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

function statusForCode(code: string): number {
  switch (code) {
    case "ORDER_NOT_FOUND":
    case "PAYMENT_NOT_FOUND":
      return 404;
    case "ORDER_NOT_AUTHORIZED":
    case "INVALID_TOKEN":
      return 401;
    case "IDEMPOTENCY_CONFLICT":
    case "CONFLICT":
    case "COD_ALREADY_CONFIRMED":
    case "COD_ALREADY_COLLECTED":
      return 409;
    case "MARKETPLACE_DISABLED":
    case "MARKETPLACE_COD_DISABLED":
      return 503;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 400;
  }
}

function handleErr(res: Response, err: unknown): Response {
  if (err instanceof CodRepositoryError) {
    if (
      err.code === "ORDER_NOT_FOUND" ||
      err.code === "ORDER_NOT_AUTHORIZED"
    ) {
      return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
    }
    return sendError(res, statusForCode(err.code), err.code, err.message);
  }
  return sendError(res, 500, "INTERNAL_ERROR", "Request failed.");
}

function rejectSmuggle(req: Request, res: Response): boolean {
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

/** Paths owned by WS6b COD (relative to /api/marketplace). */
function isCodOwnedPath(path: string): boolean {
  if (path.startsWith("/admin/cod")) return true;
  if (path.startsWith("/orders/") && path.includes("/cod")) return true;
  return false;
}

/**
 * COD customer/guest + admin/ops routes.
 *
 * Route mapping vs contract §6.2:
 * - Contract: POST /admin/payments/:id/collect-cod|reject-cod
 * - WS6b: order-centric lifecycle under /admin/cod/orders/:id/*
 *   `:id` is order public_ref (mporef_*). collect uses the established
 *   cash_on_delivery payment model (status=collected).
 *
 * Requires MARKETPLACE_ENABLED + MARKETPLACE_COD_ENABLED (default false).
 */
export function createCodRouter(deps: CodRouterDeps = {}): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const repository = deps.repository ?? createCodRepository();
  const identityDeps: CartIdentityDeps = {
    resolveLocalDb: deps.resolveLocalDb,
  };

  router.use((req, res, next) => {
    if (!isCodOwnedPath(req.path)) {
      return next("router");
    }
    setApiVersion(res);
    const config = readMarketplaceConfig(env);
    if (!isMarketplaceEnabled(config)) {
      return sendError(res, 503, "MARKETPLACE_DISABLED", "Marketplace is disabled.");
    }
    if (!isMarketplaceCodEnabled(config)) {
      return sendError(
        res,
        503,
        "MARKETPLACE_COD_DISABLED",
        "Marketplace COD is disabled.",
      );
    }
    return next();
  });

  router.post(
    "/orders/:public_ref/cod/confirm",
    async (req: Request, res: Response) => {
      try {
        if (rejectSmuggle(req, res)) return;
        const empty = parseEmptyBody(req.body);
        if (!empty.ok) {
          return sendError(res, statusForCode(empty.code), empty.code, empty.message);
        }
        const ref = parsePublicRefParam(req.params.public_ref);
        if (!ref.ok || !ref.value.startsWith("mporef_")) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const idem = parseIdempotencyKey(
          req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
        );
        if (!idem.ok) {
          return sendError(res, statusForCode(idem.code), idem.code, idem.message);
        }
        const identity = await resolveOwnedIdentity(req, ref.value, identityDeps);
        if (!identity.ok) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const data = await repository.confirm(
          identity.identity,
          ref.value,
          idem.value,
        );
        return sendOk(res, data, data.replay ? 200 : 201);
      } catch (err) {
        return handleErr(res, err);
      }
    },
  );

  router.get(
    "/orders/:public_ref/cod",
    async (req: Request, res: Response) => {
      try {
        if (rejectSmuggle(req, res)) return;
        const ref = parsePublicRefParam(req.params.public_ref);
        if (!ref.ok || !ref.value.startsWith("mporef_")) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const identity = await resolveOwnedIdentity(req, ref.value, identityDeps);
        if (!identity.ok) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const data = await repository.get(identity.identity, ref.value);
        return sendOk(res, data);
      } catch (err) {
        return handleErr(res, err);
      }
    },
  );

  const ops = express.Router();
  const finance = express.Router();

  ops.use((req, res, next) => {
    const config = readMarketplaceConfig(env);
    return createCodRouteLockdown({
      marketplaceEnabled: isMarketplaceCodEnabled(config),
      mode: "ops",
    })(req, res, next);
  });

  finance.use((req, res, next) => {
    const config = readMarketplaceConfig(env);
    return createCodRouteLockdown({
      marketplaceEnabled: isMarketplaceCodEnabled(config),
      mode: "finance",
    })(req, res, next);
  });

  async function runTransition(
    req: Request,
    res: Response,
    action: CodAction,
    requireReason: boolean,
  ): Promise<Response | void> {
    try {
      const id = parseOrderRefParam(req.params.id);
      if (!id.ok) {
        return sendError(res, 404, id.code, id.message);
      }
      const idem = parseIdempotencyKey(
        req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
      );
      if (!idem.ok) {
        return sendError(res, statusForCode(idem.code), idem.code, idem.message);
      }

      let reason: string | undefined;
      if (requireReason) {
        const parsed = parseReasonBody(req.body);
        if (!parsed.ok) {
          return sendError(
            res,
            statusForCode(parsed.code),
            parsed.code,
            parsed.message,
          );
        }
        reason = parsed.value.reason;
      } else {
        const empty = parseEmptyBody(req.body);
        if (!empty.ok) {
          return sendError(
            res,
            statusForCode(empty.code),
            empty.code,
            empty.message,
          );
        }
      }

      const actor = req.actor!;
      const data = await repository.adminTransition(
        codAdminActorScope(actor),
        actor.id,
        id.value,
        action,
        { reason, idempotencyKey: idem.value },
      );
      return sendOk(res, data);
    } catch (err) {
      return handleErr(res, err);
    }
  }

  ops.get("/orders", async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const orders = await repository.adminList(codAdminActorScope(actor));
      return sendOk(res, { orders });
    } catch (err) {
      return handleErr(res, err);
    }
  });

  ops.post("/orders/:id/confirm", (req, res) =>
    runTransition(req, res, "confirm", false),
  );
  ops.post("/orders/:id/dispatch", (req, res) =>
    runTransition(req, res, "dispatch", false),
  );
  ops.post("/orders/:id/delivery-attempt", (req, res) =>
    runTransition(req, res, "delivery_attempt", true),
  );
  ops.post("/orders/:id/fail", (req, res) => runTransition(req, res, "fail", true));
  ops.post("/orders/:id/refuse", (req, res) =>
    runTransition(req, res, "refuse", true),
  );
  ops.post("/orders/:id/cancel", (req, res) =>
    runTransition(req, res, "cancel", true),
  );

  ops.post("/orders/:id/return-to-origin", async (req: Request, res: Response) => {
    try {
      const id = parseOrderRefParam(req.params.id);
      if (!id.ok) {
        return sendError(res, 404, id.code, id.message);
      }
      const idem = parseIdempotencyKey(
        req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
      );
      if (!idem.ok) {
        return sendError(res, statusForCode(idem.code), idem.code, idem.message);
      }

      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      for (const key of Object.keys(body)) {
        if (
          key === "__proto__" ||
          key === "constructor" ||
          key === "prototype" ||
          !["phase", "reason"].includes(key)
        ) {
          if (!["phase", "reason"].includes(key)) {
            return sendError(
              res,
              400,
              key.startsWith("__") ? "FORBIDDEN_FIELD" : "UNKNOWN_FIELD",
              "Request contains unsupported fields.",
            );
          }
        }
      }
      const phase = String(body.phase ?? "start").trim().toLowerCase();
      if (phase !== "start" && phase !== "complete") {
        return sendError(
          res,
          400,
          "VALIDATION_ERROR",
          "phase must be start or complete.",
        );
      }

      let reason: string | undefined;
      if (phase === "start") {
        const r = String(body.reason ?? "").trim();
        if (r.length < 3 || r.length > 500) {
          return sendError(
            res,
            400,
            "VALIDATION_ERROR",
            "Reason must be 3-500 characters.",
          );
        }
        reason = r;
      }

      const action: CodAction =
        phase === "complete" ? "return_complete" : "return_start";
      const actor = req.actor!;
      const data = await repository.adminTransition(
        codAdminActorScope(actor),
        actor.id,
        id.value,
        action,
        { reason, idempotencyKey: idem.value },
      );
      return sendOk(res, data);
    } catch (err) {
      return handleErr(res, err);
    }
  });

  finance.post("/orders/:id/collect", (req, res) =>
    runTransition(req, res, "collect", false),
  );

  router.use("/admin/cod", ops);
  router.use("/admin/cod", finance);
  return router;
}
