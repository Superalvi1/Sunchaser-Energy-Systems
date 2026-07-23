import type { Request, Response, Router } from "express";
import express from "express";
import {
  hasSignatureConfig,
  hasWebhookVerifyConfig,
  isWhatsAppEnabled,
  readWhatsAppConfig,
  type WhatsAppConfig,
} from "./whatsappConfig.ts";
import {
  AUDIT_EVENTS,
  WHATSAPP_WEBHOOK_MAX_BODY_BYTES,
  WHATSAPP_WEBHOOK_PATH,
} from "./whatsappConstants.ts";
import {
  buildMinimizedMetadata,
  parseWebhookRawBody,
  type NormalizedWebhookEvent,
} from "./whatsappEnvelope.ts";
import {
  createDefaultWhatsAppRepository,
  safeAudit,
  type WhatsAppRepository,
} from "./whatsappRepository.ts";
import { sha256Hex, verifyWhatsAppSignature } from "./whatsappSignature.ts";
import { recordWebhookPing } from "./whatsappConnectionService.ts";

export type WhatsAppWebhookRouterDeps = {
  repo?: WhatsAppRepository;
  config?: WhatsAppConfig;
  env?: NodeJS.ProcessEnv;
  autoLinkLead?: (conversationId: string) => Promise<unknown>;
};

function resolveConfig(deps: WhatsAppWebhookRouterDeps): WhatsAppConfig {
  return deps.config ?? readWhatsAppConfig(deps.env ?? process.env);
}

function readRawBody(req: Request): Buffer | null {
  // Production webhook POST must use path-scoped express.raw() → Buffer only.
  if (Buffer.isBuffer(req.body)) return req.body;
  return null;
}

async function persistNormalizedEvents(
  repo: WhatsAppRepository,
  events: NormalizedWebhookEvent[],
  autoLinkLead?: (conversationId: string) => Promise<unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    for (const event of events) {
      if (event.kind === "inbound_text" || event.kind === "inbound_message") {
        const channel = await repo.resolveOrCreateChannel({
          phoneNumberId: event.phoneNumberId,
          displayPhoneNumber: event.displayPhoneNumber,
          wabaId: event.wabaEntryId,
        });
        const contact = await repo.resolveOrCreateContact({
          phoneE164: event.fromWaId,
          profileName: event.profileName,
        });
        const conversation = await repo.resolveOrCreateOpenConversation({
          channelId: channel.id,
          contactId: contact.id,
        });

        const textBody =
          event.kind === "inbound_text" ? event.text : event.textBody;
        const messageType =
          event.kind === "inbound_text"
            ? "text"
            : event.messageType || "unknown";

        const minimizedMeta = buildMinimizedMetadata({
          messageType,
          waMessageId: event.waMessageId,
          metaMediaId: event.metaMediaId,
          mimeType: event.mimeType,
          sha256: event.sha256,
          filename: event.filename,
          caption: event.caption,
          voice: event.voice,
          latitude: event.latitude,
          longitude: event.longitude,
          placeName: event.placeName,
          address: event.address,
        });

        const inserted = await repo.insertInboundMessage({
          conversationId: conversation.id,
          waMessageId: event.waMessageId,
          textBody: textBody ?? null,
          occurredAt: event.occurredAt,
          rawPayload: minimizedMeta,
          messageType,
          metaMediaId: event.metaMediaId ?? null,
          mimeType: event.mimeType ?? null,
          caption: event.caption ?? null,
          filename: event.filename ?? null,
          sha256: event.sha256 ?? null,
          voice: Boolean(event.voice),
          latitude: event.latitude ?? null,
          longitude: event.longitude ?? null,
          address: event.address ?? null,
          placeName: event.placeName ?? null,
          rawMetadata: minimizedMeta,
        });
        if (inserted.ok === false) {
          return { ok: false, error: inserted.error };
        }
        await repo.updateConversationLastMessageAt(
          conversation.id,
          event.occurredAt
        );

        if (autoLinkLead) {
          try {
            await autoLinkLead(conversation.id);
          } catch (autoLinkErr) {
            console.error(
              "Auto lead linking failed for conversation:",
              conversation.id,
              autoLinkErr
            );
          }
        }

        await safeAudit(repo, {
          eventType: AUDIT_EVENTS.INBOUND_MESSAGE_STORED,
          entityType: "message",
          entityId: inserted.row.id,
          metadata: {
            conversationId: conversation.id,
            waMessageId: event.waMessageId,
            created: inserted.created,
            messageType,
          },
        });
        continue;
      }

      if (event.kind === "status") {
        const inserted = await repo.insertStatusEvent(event);
        if (inserted.ok === false) {
          return { ok: false, error: inserted.error };
        }
        await safeAudit(repo, {
          eventType: AUDIT_EVENTS.STATUS_EVENT_STORED,
          entityType: "status_event",
          entityId: inserted.row.id,
          metadata: {
            waMessageId: event.waMessageId,
            status: event.status,
            created: inserted.created,
            messageUpdated: inserted.row.messageUpdated === true,
          },
        });
        if (inserted.row.messageNotFound) {
          await safeAudit(repo, {
            eventType: AUDIT_EVENTS.STATUS_MESSAGE_NOT_FOUND,
            entityType: "status_event",
            entityId: inserted.row.id,
            metadata: {
              waMessageId: event.waMessageId,
              status: event.status,
            },
          });
        }
        continue;
      }

      await safeAudit(repo, {
        eventType: AUDIT_EVENTS.UNSUPPORTED_MESSAGE_IGNORED,
        entityType: "message",
        entityId: event.waMessageId,
        metadata: {
          messageType: event.messageType,
          phoneNumberId: event.phoneNumberId,
        },
      });
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "persistence failed";
    return { ok: false, error: message };
  }
}

export function createWhatsAppWebhookRouter(
  deps: WhatsAppWebhookRouterDeps = {}
): Router {
  const router = express.Router();
  const repo = deps.repo ?? createDefaultWhatsAppRepository();

  router.get("/webhook", (req, res) => {
    const config = resolveConfig(deps);
    if (!isWhatsAppEnabled(config)) {
      return res.status(404).json({ error: "Not found" });
    }
    if (!hasWebhookVerifyConfig(config)) {
      return res.status(503).json({ error: "WhatsApp verify token not configured" });
    }

    const mode = String(req.query["hub.mode"] ?? "");
    const token = String(req.query["hub.verify_token"] ?? "");
    const challenge = String(req.query["hub.challenge"] ?? "");

    if (mode !== "subscribe" || token !== config.webhookVerifyToken) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return res.status(200).type("text/plain").send(challenge);
  });

  router.post("/webhook", async (req, res) => {
    const config = resolveConfig(deps);
    if (!isWhatsAppEnabled(config)) {
      return res.status(404).json({ error: "Not found" });
    }
    if (!hasSignatureConfig(config)) {
      return res.status(503).json({ error: "WhatsApp app secret not configured" });
    }
    if (!repo.isActive()) {
      return res.status(503).json({ error: "WhatsApp persistence unavailable" });
    }

    const rawBody = readRawBody(req);
    if (!rawBody) {
      return res.status(400).json({
        error: "Webhook raw body must be a Buffer (middleware misconfigured)",
      });
    }
    if (rawBody.byteLength > WHATSAPP_WEBHOOK_MAX_BODY_BYTES) {
      return res.status(413).json({ error: "Payload too large" });
    }

    const signatureHeader = req.header("x-hub-signature-256");
    const signature = verifyWhatsAppSignature(
      rawBody,
      signatureHeader,
      config.appSecret
    );
    if (signature.ok === false) {
      if (signature.reason === "missing_secret") {
        return res.status(503).json({ error: "WhatsApp app secret not configured" });
      }
      await safeAudit(repo, {
        eventType: AUDIT_EVENTS.SIGNATURE_REJECTED,
        entityType: "webhook",
        metadata: { reason: signature.reason },
      });
      return res.status(401).json({ error: "Invalid signature" });
    }

    const payloadHash = sha256Hex(rawBody);
    await recordWebhookPing();
    await safeAudit(repo, {
      eventType: AUDIT_EVENTS.WEBHOOK_RECEIVED,
      entityType: "webhook",
      metadata: {
        payloadHash,
        bytes: rawBody.byteLength,
        path: WHATSAPP_WEBHOOK_PATH,
      },
    });

    const claim = await repo.claimWebhookEvent(payloadHash);
    if (claim.kind === "error") {
      return res.status(503).json({ error: "WhatsApp persistence unavailable" });
    }

    if (claim.kind === "existing_processed") {
      await safeAudit(repo, {
        eventType: AUDIT_EVENTS.WEBHOOK_DUPLICATE_COMPLETED,
        entityType: "webhook_event",
        entityId: claim.event.id,
        metadata: { payloadHash },
      });
      return res.status(200).json({ success: true, duplicate: true });
    }

    const parsed = parseWebhookRawBody(rawBody);
    if (parsed.ok === false) {
      await repo.markWebhookEventError(claim.event.id, parsed.error);
      return res.status(400).json({ error: "Malformed webhook payload" });
    }

    const persist = await persistNormalizedEvents(
      repo,
      parsed.events,
      deps.autoLinkLead
    );
    if (persist.ok === false) {
      await repo.markWebhookEventError(claim.event.id, persist.error);
      if (claim.kind === "existing_incomplete") {
        await safeAudit(repo, {
          eventType: AUDIT_EVENTS.WEBHOOK_REPROCESSING_INCOMPLETE,
          entityType: "webhook_event",
          entityId: claim.event.id,
          metadata: { payloadHash, error: persist.error },
        });
      }
      return res.status(500).json({ error: "Webhook persistence incomplete" });
    }

    await repo.markWebhookEventProcessed(claim.event.id);
    await safeAudit(repo, {
      eventType: AUDIT_EVENTS.WEBHOOK_PROCESSED,
      entityType: "webhook_event",
      entityId: claim.event.id,
      metadata: {
        payloadHash,
        eventCount: parsed.events.length,
        reprocessed: claim.kind === "existing_incomplete",
      },
    });
    return res.status(200).json({ success: true });
  });

  return router;
}

/** Express error helper for path-scoped raw parser oversizers. */
export function whatsappRawBodyErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: (err?: unknown) => void
): void {
  const path = req.path || req.originalUrl || "";
  const isWebhook =
    path === WHATSAPP_WEBHOOK_PATH ||
    path.endsWith("/integrations/whatsapp/webhook");
  const typed = err as { type?: string; status?: number; statusCode?: number };
  if (isWebhook && typed?.type === "entity.too.large") {
    res.status(413).json({ error: "Payload too large" });
    return;
  }
  next(err);
}
