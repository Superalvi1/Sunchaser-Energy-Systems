/**
 * Admin-only WhatsApp Web QR API.
 *
 * GET  /api/whatsapp-web/status
 * POST /api/whatsapp-web/connect
 * GET  /api/whatsapp-web/qr
 * POST /api/whatsapp-web/disconnect
 * POST /api/whatsapp-web/logout
 * POST /api/whatsapp-web/sync
 * GET  /api/whatsapp-web/sync
 *
 * Authorization (JWT-hydrated actor only — never body/headers):
 * - Missing actor → 401
 * - accountStatus !== "Approved" → 403
 * - Role not Admin/Super Admin → 403
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import type { RequestActor } from "../middleware/actor.ts";
import {
  inboxFail,
  inboxOk,
} from "../whatsappTransport/whatsappInboxHttp.ts";
import {
  FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS,
  type WhatsAppWebSafeStatus,
} from "./whatsappWebTypes.ts";
import { canManageWhatsAppWebQr } from "./whatsappWebPermissions.ts";
import {
  createWhatsAppWebRateLimit,
  type WhatsAppWebRateLimitOptions,
} from "./whatsappWebRateLimit.ts";
import {
  getSharedWhatsAppWebSession,
  type WhatsAppWebSession,
} from "./whatsappWebSession.ts";

/** All WhatsApp Web Admin routes — used by tests to prove limiter coverage. */
export const WHATSAPP_WEB_ADMIN_ROUTES = [
  { method: "GET", path: "/status" },
  { method: "POST", path: "/connect" },
  { method: "GET", path: "/qr" },
  { method: "POST", path: "/disconnect" },
  { method: "POST", path: "/logout" },
  { method: "POST", path: "/sync" },
  { method: "GET", path: "/sync" },
] as const;

export function requireWhatsAppWebAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const actor = req.actor as RequestActor | undefined;
  if (!actor) {
    inboxFail(res, 401, "unauthorized", "Unauthorized");
    return;
  }
  // Ignore any spoofed status/role from body or headers — actor is JWT-hydrated.
  if (!canManageWhatsAppWebQr(actor)) {
    inboxFail(res, 403, "forbidden", "Admin access required");
    return;
  }
  next();
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function assertNoCredentialLeak(payload: unknown): void {
  const json = JSON.stringify(payload);
  for (const field of FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS) {
    // Match JSON object keys only — safeMessage may mention "session" in prose.
    if (json.includes(`"${field}"`)) {
      throw new Error(`Refusing to return forbidden field: ${field}`);
    }
  }
}

export type WhatsAppWebRouterDeps = {
  session?: WhatsAppWebSession;
  rateLimitStore?: Map<string, { count: number; resetAt: number }>;
  rateLimit?: WhatsAppWebRateLimitOptions;
};

export function createWhatsAppWebRouter(
  deps: WhatsAppWebRouterDeps = {}
): Router {
  const router = Router();
  const session = deps.session ?? getSharedWhatsAppWebSession();
  const rateLimit = createWhatsAppWebRateLimit({
    store: deps.rateLimitStore,
    ...(deps.rateLimit ?? {}),
  });

  // Limiter runs first; auth still required for any successful response.
  router.use(rateLimit);
  router.use(requireWhatsAppWebAdmin);

  router.get("/status", (_req, res) => {
    noStore(res);
    const status = session.getSafeStatus();
    assertNoCredentialLeak(status);
    return inboxOk(res, status);
  });

  router.post("/connect", async (_req, res) => {
    noStore(res);
    try {
      const status = await session.connect();
      assertNoCredentialLeak(status);
      return inboxOk(res, status);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "feature_disabled") {
        return inboxFail(
          res,
          503,
          "feature_disabled",
          "WhatsApp Web QR is disabled"
        );
      }
      if (code === "start_in_progress") {
        return inboxFail(
          res,
          409,
          "start_in_progress",
          "Connection start already in progress"
        );
      }
      return inboxFail(
        res,
        500,
        "connect_failed",
        "Failed to start WhatsApp Web connection"
      );
    }
  });

  router.get("/qr", async (_req, res) => {
    noStore(res);
    const qr = await session.getQrPayload();
    if (!qr) {
      return inboxFail(
        res,
        404,
        "qr_unavailable",
        "No active QR code. Start connect to generate one."
      );
    }
    assertNoCredentialLeak(qr);
    return inboxOk(res, qr);
  });

  router.post("/disconnect", async (_req, res) => {
    noStore(res);
    const status = await session.disconnect();
    assertNoCredentialLeak(status);
    return inboxOk(res, status);
  });

  router.post("/logout", async (_req, res) => {
    noStore(res);
    try {
      const status = await session.logout();
      assertNoCredentialLeak(status);
      return inboxOk(res, status as WhatsAppWebSafeStatus);
    } catch {
      return inboxFail(
        res,
        500,
        "logout_failed",
        "Failed to logout WhatsApp Web session"
      );
    }
  });

  router.get("/sync", async (_req, res) => {
    noStore(res);
    const snapshot = await session.getHistorySyncSnapshot();
    assertNoCredentialLeak(snapshot);
    return inboxOk(res, snapshot);
  });

  router.post("/sync", (_req, res) => {
    noStore(res);
    const result = session.startHistorySync();
    assertNoCredentialLeak(result.snapshot);
    if (!result.accepted && result.snapshot.status === "failed") {
      return inboxFail(
        res,
        409,
        "sync_unavailable",
        result.snapshot.errorSummary || "Sync unavailable"
      );
    }
    return inboxOk(res, {
      ...result.snapshot,
      joinedExisting: result.joinedExisting,
    });
  });

  return router;
}
