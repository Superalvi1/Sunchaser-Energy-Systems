import type { Request, Response, Router } from "express";
import express from "express";
import type { Database } from "../../../dbManager.ts";
import {
  isMarketplaceEnabled,
  isMarketplacePaymentsEnabled,
  readMarketplaceConfig,
} from "../marketplaceConfig.ts";
import {
  resolveOwnedIdentity,
  type CartIdentityDeps,
} from "../cart/cartIdentity.ts";
import {
  MARKETPLACE_API_VERSION,
  MARKETPLACE_API_VERSION_HEADER,
} from "./paymentTypes.ts";
import {
  createPaymentRepository,
  PaymentRepositoryError,
  type PaymentRepository,
} from "./paymentRepository.ts";
import { createMemoryReceiptStorage } from "./receiptStorage.ts";
import {
  hasTokenSmuggling,
  parseEmptyBody,
  parseIdempotencyKey,
  parsePaymentIdParam,
  parsePublicRefParam,
  parseReceiptJsonBody,
  parseRejectBody,
  parseRefundBody,
  parseUploadIntentBody,
} from "./paymentValidation.ts";
import {
  adminActorScope,
  createMarketplaceRouteLockdown,
} from "./marketplaceRouteLockdown.ts";

export type PaymentRouterDeps = {
  env?: NodeJS.ProcessEnv;
  repository?: PaymentRepository;
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
    case "ORDER_NOT_FOUND":
    case "PAYMENT_NOT_FOUND":
    case "CART_NOT_FOUND":
      return 404;
    case "ORDER_NOT_AUTHORIZED":
    case "INVALID_TOKEN":
    case "CART_NOT_AUTHORIZED":
      return 401;
    case "PAYMENT_NOT_ALLOWED":
    case "PAYMENT_ALREADY_RECORDED":
    case "PAYMENT_NOT_PENDING":
    case "PAYMENT_ALREADY_VERIFIED":
    case "PAYMENT_ALREADY_REJECTED":
    case "INVALID_PAYMENT_METHOD":
    case "INVALID_AMOUNT":
    case "UPLOAD_INTENT_REQUIRED":
    case "UPLOAD_INTENT_INVALID":
    case "UPLOAD_INTENT_EXPIRED":
    case "UPLOAD_INTENT_USED":
    case "INVALID_FILE_TYPE":
    case "INVALID_FILE_CONTENT":
    case "FILE_TOO_LARGE":
    case "RECEIPT_UPLOAD_FAILED":
    case "REFUND_NOT_ALLOWED":
    case "REFUND_AMOUNT_EXCEEDED":
    case "IDEMPOTENCY_KEY_REQUIRED":
    case "FORBIDDEN_FIELD":
    case "UNKNOWN_FIELD":
    case "VALIDATION_ERROR":
      return 400;
    case "IDEMPOTENCY_CONFLICT":
    case "CONFLICT":
      return 409;
    case "MARKETPLACE_DISABLED":
    case "MARKETPLACE_PAYMENTS_DISABLED":
      return 503;
    default:
      return 500;
  }
}

function handleRepoError(res: Response, err: unknown): Response {
  if (err instanceof PaymentRepositoryError) {
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

/** Paths owned by WS6a payments (relative to /api/marketplace). */
function isPaymentsOwnedPath(path: string): boolean {
  if (path.startsWith("/admin/payments")) return true;
  if (path.startsWith("/orders/") && path.includes("/payments")) return true;
  return false;
}

/**
 * Customer/guest bank-transfer routes + admin finance routes.
 *
 * Route naming note vs contract §6.1:
 * - Contract: POST /orders/:public_ref/payments (combined upload+record)
 * - WS6a:     POST /orders/:public_ref/payments/receipt (explicit receipt step)
 *   plus GET  /orders/:public_ref/payments and admin reject (not only reject-cod).
 *
 * Requires MARKETPLACE_ENABLED + MARKETPLACE_PAYMENTS_ENABLED (default false).
 */
export function createPaymentRouter(deps: PaymentRouterDeps = {}): Router {
  const router = express.Router();
  const env = deps.env ?? process.env;
  const repository =
    deps.repository ??
    createPaymentRepository({ storage: createMemoryReceiptStorage() });
  const identityDeps: CartIdentityDeps = {
    resolveLocalDb: deps.resolveLocalDb,
  };

  router.use((req, res, next) => {
    if (!isPaymentsOwnedPath(req.path)) {
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
    if (!isMarketplacePaymentsEnabled(config)) {
      return sendError(
        res,
        503,
        "MARKETPLACE_PAYMENTS_DISABLED",
        "Marketplace payments are disabled.",
      );
    }
    return next();
  });

  // ---- Customer / guest ----------------------------------------------------

  router.post(
    "/orders/:public_ref/payments/preflight",
    async (req: Request, res: Response) => {
      try {
        if (rejectSmuggledTokens(req, res)) return;
        const empty = parseEmptyBody(req.body);
        if (empty.ok === false) {
          return sendError(res, statusForCode(empty.code), empty.code, empty.message);
        }
        const ref = parsePublicRefParam(req.params.public_ref);
        if (ref.ok === false || !ref.value.startsWith("mporef_")) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const identity = await resolveOwnedIdentity(req, ref.value, identityDeps);
        if (identity.ok === false) {
          // Uniform not-found for unauthorized cross-order probes
          if (
            identity.code === "INVALID_TOKEN" ||
            identity.code === "CART_NOT_AUTHORIZED"
          ) {
            return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
          }
          return sendError(res, identity.status, identity.code, identity.message);
        }
        const data = await repository.preflight(identity.identity, ref.value);
        return sendOk(res, data);
      } catch (err) {
        if (
          err instanceof PaymentRepositoryError &&
          (err.code === "ORDER_NOT_FOUND" || err.code === "ORDER_NOT_AUTHORIZED")
        ) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        return handleRepoError(res, err);
      }
    },
  );

  router.post(
    "/orders/:public_ref/payments/upload-intent",
    async (req: Request, res: Response) => {
      try {
        if (rejectSmuggledTokens(req, res)) return;
        const body = parseUploadIntentBody(req.body);
        if (body.ok === false) {
          return sendError(res, statusForCode(body.code), body.code, body.message);
        }
        const ref = parsePublicRefParam(req.params.public_ref);
        if (ref.ok === false || !ref.value.startsWith("mporef_")) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const idem = parseIdempotencyKey(
          req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
        );
        if (idem.ok === false) {
          return sendError(res, statusForCode(idem.code), idem.code, idem.message);
        }
        const identity = await resolveOwnedIdentity(req, ref.value, identityDeps);
        if (identity.ok === false) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const data = await repository.createUploadIntent(
          identity.identity,
          ref.value,
          idem.value,
        );
        return sendOk(res, data, data.replay ? 200 : 201);
      } catch (err) {
        if (
          err instanceof PaymentRepositoryError &&
          (err.code === "ORDER_NOT_FOUND" || err.code === "ORDER_NOT_AUTHORIZED")
        ) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        return handleRepoError(res, err);
      }
    },
  );

  router.post(
    "/orders/:public_ref/payments/receipt",
    async (req: Request, res: Response) => {
      try {
        if (rejectSmuggledTokens(req, res)) return;
        const ref = parsePublicRefParam(req.params.public_ref);
        if (ref.ok === false || !ref.value.startsWith("mporef_")) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const idem = parseIdempotencyKey(
          req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
        );
        if (idem.ok === false) {
          return sendError(res, statusForCode(idem.code), idem.code, idem.message);
        }
        const parsed = parseReceiptJsonBody(req.body);
        if (parsed.ok === false) {
          return sendError(
            res,
            statusForCode(parsed.code),
            parsed.code,
            parsed.message,
          );
        }

        let bytes: Buffer;
        try {
          bytes = Buffer.from(parsed.value.contentBase64, "base64");
        } catch {
          return sendError(
            res,
            400,
            "INVALID_FILE_CONTENT",
            "Receipt content is invalid.",
          );
        }

        const identity = await resolveOwnedIdentity(req, ref.value, identityDeps);
        if (identity.ok === false) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }

        const data = await repository.submitReceipt(identity.identity, ref.value, {
          uploadIntentId: parsed.value.uploadIntentId,
          mimeType: parsed.value.mimeType,
          bytes,
          fileName: parsed.value.fileName,
          idempotencyKey: idem.value,
        });
        return sendOk(res, data, data.replay ? 200 : 201);
      } catch (err) {
        if (
          err instanceof PaymentRepositoryError &&
          (err.code === "ORDER_NOT_FOUND" || err.code === "ORDER_NOT_AUTHORIZED")
        ) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        return handleRepoError(res, err);
      }
    },
  );

  router.get(
    "/orders/:public_ref/payments",
    async (req: Request, res: Response) => {
      try {
        if (rejectSmuggledTokens(req, res)) return;
        const ref = parsePublicRefParam(req.params.public_ref);
        if (ref.ok === false || !ref.value.startsWith("mporef_")) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const identity = await resolveOwnedIdentity(req, ref.value, identityDeps);
        if (identity.ok === false) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        const payments = await repository.listOrderPayments(
          identity.identity,
          ref.value,
        );
        return sendOk(res, { publicRef: ref.value, payments });
      } catch (err) {
        if (
          err instanceof PaymentRepositoryError &&
          (err.code === "ORDER_NOT_FOUND" || err.code === "ORDER_NOT_AUTHORIZED")
        ) {
          return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found.");
        }
        return handleRepoError(res, err);
      }
    },
  );

  // ---- Admin / finance -----------------------------------------------------
  // Mounted at /admin/payments only so catalogue/pricing/COD /admin/* paths
  // are not intercepted by finance lockdown (pre-WS4 admin composition).

  const admin = express.Router();
  admin.use((req, res, next) => {
    const config = readMarketplaceConfig(env);
    return createMarketplaceRouteLockdown({
      marketplaceEnabled: isMarketplacePaymentsEnabled(config),
    })(req, res, next);
  });

  admin.get("/", async (req: Request, res: Response) => {
    try {
      const actor = req.actor!;
      const status =
        typeof req.query.status === "string" ? req.query.status.trim() : undefined;
      const data = await repository.adminListPayments(
        adminActorScope(actor),
        status || undefined,
      );
      return sendOk(res, { payments: data });
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  admin.post("/:id/verify", async (req: Request, res: Response) => {
    try {
      const empty = parseEmptyBody(req.body);
      if (empty.ok === false) {
        return sendError(res, statusForCode(empty.code), empty.code, empty.message);
      }
      const id = parsePaymentIdParam(req.params.id);
      if (id.ok === false) {
        return sendError(res, statusForCode(id.code), id.code, id.message);
      }
      const idem = parseIdempotencyKey(
        req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
      );
      if (idem.ok === false) {
        return sendError(res, statusForCode(idem.code), idem.code, idem.message);
      }
      const actor = req.actor!;
      const data = await repository.adminAction(
        adminActorScope(actor),
        actor.id,
        id.value,
        "verify",
        { idempotencyKey: idem.value },
      );
      return sendOk(res, data, data.replay ? 200 : 200);
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  admin.post("/:id/reject", async (req: Request, res: Response) => {
    try {
      const parsed = parseRejectBody(req.body);
      if (parsed.ok === false) {
        return sendError(
          res,
          statusForCode(parsed.code),
          parsed.code,
          parsed.message,
        );
      }
      const id = parsePaymentIdParam(req.params.id);
      if (id.ok === false) {
        return sendError(res, statusForCode(id.code), id.code, id.message);
      }
      const idem = parseIdempotencyKey(
        req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
      );
      if (idem.ok === false) {
        return sendError(res, statusForCode(idem.code), idem.code, idem.message);
      }
      const actor = req.actor!;
      const data = await repository.adminAction(
        adminActorScope(actor),
        actor.id,
        id.value,
        "reject",
        { reason: parsed.value.reason, idempotencyKey: idem.value },
      );
      return sendOk(res, data);
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  admin.post("/:id/refund", async (req: Request, res: Response) => {
    try {
      const parsed = parseRefundBody(req.body);
      if (parsed.ok === false) {
        return sendError(
          res,
          statusForCode(parsed.code),
          parsed.code,
          parsed.message,
        );
      }
      const id = parsePaymentIdParam(req.params.id);
      if (id.ok === false) {
        return sendError(res, statusForCode(id.code), id.code, id.message);
      }
      const idem = parseIdempotencyKey(
        req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"],
      );
      if (idem.ok === false) {
        return sendError(res, statusForCode(idem.code), idem.code, idem.message);
      }
      const actor = req.actor!;
      const data = await repository.adminAction(
        adminActorScope(actor),
        actor.id,
        id.value,
        "refund",
        {
          amount: parsed.value.amount,
          reason: parsed.value.reason,
          idempotencyKey: idem.value,
        },
      );
      return sendOk(res, data);
    } catch (err) {
      return handleRepoError(res, err);
    }
  });

  router.use("/admin/payments", admin);
  return router;
}
