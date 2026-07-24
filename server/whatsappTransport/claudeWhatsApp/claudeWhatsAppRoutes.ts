/**
 * Admin API for Claude WhatsApp — status, QR, kill switch.
 * Mounted at `/api/inbox` alongside the existing inbox router.
 */
import { Router, type Request, type Response } from "express";
import QRCode from "qrcode";
import type { RequestActor } from "../../middleware/actor.ts";
import { inboxFail, inboxOk } from "../whatsappInboxHttp.ts";
import { requireInboxRbac } from "../whatsappInboxRoutes.ts";
import type { ClaudeWhatsAppKillSwitch } from "./claudeWhatsAppKillSwitch.ts";
import { getClaudeWhatsAppKillSwitch } from "./claudeWhatsAppKillSwitch.ts";
import type { ClaudeWhatsAppProvider } from "./claudeWhatsAppProvider.ts";
import { getClaudeWhatsAppProvider } from "./claudeWhatsAppProvider.ts";

export type ClaudeWhatsAppRouterDeps = {
  provider?: ClaudeWhatsAppProvider;
  killSwitch?: ClaudeWhatsAppKillSwitch;
};

function requireAdmin(req: Request, res: Response): boolean {
  const actor = req.actor as RequestActor | undefined;
  if (!actor) {
    inboxFail(res, 401, "unauthorized", "Unauthorized");
    return false;
  }
  if (actor.role !== "Super Admin" && actor.role !== "Admin") {
    inboxFail(res, 403, "forbidden", "Admin access required");
    return false;
  }
  return true;
}

async function buildStatusPayload(
  provider: ClaudeWhatsAppProvider,
  killSwitch: ClaudeWhatsAppKillSwitch
) {
  await killSwitch.refresh();
  const live = provider.getStatus();
  let qrDataUrl: string | null = null;
  if (live.qr) {
    try {
      qrDataUrl = await QRCode.toDataURL(live.qr, {
        margin: 1,
        width: 280,
        errorCorrectionLevel: "M",
      });
    } catch {
      qrDataUrl = null;
    }
  }
  return {
    provider: "claude_whatsapp" as const,
    label: "Claude WhatsApp",
    enabled: killSwitch.isEnabled(),
    status: live.status,
    disconnectKind: live.disconnectKind,
    qrDataUrl,
    hasQr: Boolean(live.qr),
    lastError: live.lastError,
    phoneNumber: live.phoneNumber,
    reconnectAttempt: live.reconnectAttempt,
    killSwitchCheckedAt: new Date(killSwitch.lastCheckAt() || Date.now()).toISOString(),
  };
}

export function createClaudeWhatsAppRouter(
  deps: ClaudeWhatsAppRouterDeps = {}
): Router {
  const router = Router();
  const provider = deps.provider ?? getClaudeWhatsAppProvider();
  const killSwitch = deps.killSwitch ?? getClaudeWhatsAppKillSwitch();

  router.use(requireInboxRbac);

  router.get("/admin/claude-whatsapp/status", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const data = await buildStatusPayload(provider, killSwitch);
      return inboxOk(res, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return inboxFail(res, 500, "internal_error", message);
    }
  });

  router.post("/admin/claude-whatsapp/enabled", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== "boolean") {
      return inboxFail(
        res,
        400,
        "validation_error",
        "enabled must be a boolean"
      );
    }
    try {
      await killSwitch.setEnabled(enabled);
      await provider.applyKillSwitch(enabled);
      const data = await buildStatusPayload(provider, killSwitch);
      return inboxOk(res, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return inboxFail(res, 500, "internal_error", message);
    }
  });

  router.post("/admin/claude-whatsapp/reconnect", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await provider.forceNewQr();
      const data = await buildStatusPayload(provider, killSwitch);
      return inboxOk(res, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return inboxFail(res, 500, "internal_error", message);
    }
  });

  return router;
}
