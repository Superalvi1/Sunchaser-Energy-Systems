import type { Router } from "express";
import express from "express";
import { readWhatsAppConfig, type WhatsAppConfig } from "./whatsappConfig.ts";
import {
  createDefaultWhatsAppRepository,
  type WhatsAppRepository,
} from "./whatsappRepository.ts";
import { sendOutboundPlainText } from "./whatsappOutboundService.ts";

export type WhatsAppOutboundRouterDeps = {
  repo?: WhatsAppRepository;
  config?: WhatsAppConfig;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

/**
 * Protected outbound route: POST /api/conversations/:id/messages
 * Relies on centralized JWT authorization (not on the public allowlist).
 * Staff outbound permission is enforced in the service (crm_leads roles only).
 */
export function createWhatsAppOutboundRouter(
  deps: WhatsAppOutboundRouterDeps = {}
): Router {
  const router = express.Router();
  const repo = deps.repo ?? createDefaultWhatsAppRepository();

  router.post("/:id/messages", async (req, res) => {
    if (!req.actor) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const config =
      deps.config ?? readWhatsAppConfig(deps.env ?? process.env);
    const conversationId = String(req.params.id || "").trim();
    if (!conversationId) {
      return res.status(400).json({ error: "conversation id is required" });
    }

    // Recipient/sender/channel/company are never accepted from the browser body.
    const result = await sendOutboundPlainText(
      conversationId,
      (req.body as { text?: unknown } | undefined)?.text,
      {
        repo,
        config,
        actor: req.actor,
        fetchImpl: deps.fetchImpl,
      }
    );

    if (result.httpStatus === 201) {
      return res.status(201).json({
        messageId: result.messageId,
        providerMessageId: result.providerMessageId,
        status: result.status,
      });
    }

    const body: Record<string, unknown> = { error: result.error };
    if (result.messageId) body.messageId = result.messageId;
    if (result.providerMessageId) {
      body.providerMessageId = result.providerMessageId;
    }
    if (result.status) body.status = result.status;
    return res.status(result.httpStatus).json(body);
  });

  return router;
}
