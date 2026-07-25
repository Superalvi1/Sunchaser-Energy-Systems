import type { Router } from "express";
import express from "express";
import { readWhatsAppConfig, type WhatsAppConfig } from "./whatsappConfig.ts";
import {
  createDefaultWhatsAppRepository,
  type WhatsAppRepository,
} from "./whatsappRepository.ts";
import { sendOutboundPlainText } from "./whatsappOutboundService.ts";
import type { MessagingRepository } from "../unifiedMessaging/messagingRepository.ts";

export type WhatsAppOutboundRouterDeps = {
  repo?: WhatsAppRepository;
  config?: WhatsAppConfig;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  messagingRepository?: MessagingRepository | null;
};

/**
 * Protected outbound route: POST /api/conversations/:id/messages
 * Relies on centralized JWT authorization (not on the public allowlist).
 * Staff outbound permission is enforced in the service (crm_leads roles only).
 *
 * Optional Idempotency-Key header (or body.idempotencyKey) is used when
 * normalized messaging Postgres wiring is enabled.
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

    const body = req.body as
      | { text?: unknown; idempotencyKey?: unknown; organizationId?: unknown }
      | undefined;

    // Browser cannot choose organizationId — ignore/reject spoof attempts.
    if (body && "organizationId" in body && body.organizationId != null) {
      return res.status(400).json({ error: "organizationId is not accepted" });
    }

    const headerKey = String(req.header("idempotency-key") ?? "").trim();
    const bodyKey =
      typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const clientIdempotencyKey = headerKey || bodyKey || null;

    // Recipient/sender/channel/company are never accepted from the browser body.
    const result = await sendOutboundPlainText(conversationId, body?.text, {
      repo,
      config,
      actor: req.actor,
      fetchImpl: deps.fetchImpl,
      messagingRepository: deps.messagingRepository,
      clientIdempotencyKey,
    });

    if (result.httpStatus === 201) {
      return res.status(201).json({
        messageId: result.messageId,
        providerMessageId: result.providerMessageId,
        status: result.status,
      });
    }

    if (result.httpStatus === 409) {
      return res.status(409).json({
        error: result.error,
        ...(result.messageId ? { messageId: result.messageId } : {}),
        ...(result.status ? { status: result.status } : {}),
      });
    }

    const responseBody: Record<string, unknown> = { error: result.error };
    if (result.messageId) responseBody.messageId = result.messageId;
    if (result.providerMessageId) {
      responseBody.providerMessageId = result.providerMessageId;
    }
    if (result.status) responseBody.status = result.status;
    if (result.persistenceStatus) {
      responseBody.persistenceStatus = result.persistenceStatus;
    }
    if (result.providerOutcome) {
      responseBody.providerOutcome = result.providerOutcome;
    }
    return res.status(result.httpStatus).json(responseBody);
  });

  return router;
}
