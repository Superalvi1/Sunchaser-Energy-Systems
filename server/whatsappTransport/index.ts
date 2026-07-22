import type { Express, RequestHandler } from "express";
import express from "express";
import {
  WHATSAPP_WEBHOOK_MAX_BODY_BYTES,
  WHATSAPP_WEBHOOK_PATH,
} from "./whatsappConstants.ts";
import { whatsappRawBodyErrorHandler } from "./whatsappWebhookRoutes.ts";

export { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
export {
  WHATSAPP_GRAPH_API_VERSION_FALLBACK,
  WHATSAPP_MAX_TEXT_LENGTH,
  WHATSAPP_WEBHOOK_MAX_BODY_BYTES,
  WHATSAPP_WEBHOOK_PATH,
  AUDIT_EVENTS,
} from "./whatsappConstants.ts";
export {
  readWhatsAppConfig,
  isWhatsAppEnabled,
  hasWebhookVerifyConfig,
  hasSignatureConfig,
  hasOutboundSendConfig,
  isValidGraphApiVersion,
  isValidPhoneNumberId,
  resolveGraphApiVersion,
  type WhatsAppConfig,
} from "./whatsappConfig.ts";
export {
  verifyWhatsAppSignature,
  sha256Hex,
} from "./whatsappSignature.ts";
export {
  parseWebhookRawBody,
  digitsOnlyPhone,
} from "./whatsappEnvelope.ts";
export {
  InMemoryWhatsAppRepository,
  SupabaseWhatsAppRepository,
  createDefaultWhatsAppRepository,
  isUniqueViolation,
  type WhatsAppRepository,
} from "./whatsappRepository.ts";
export {
  createWhatsAppWebhookRouter,
  whatsappRawBodyErrorHandler,
  type WhatsAppWebhookRouterDeps,
} from "./whatsappWebhookRoutes.ts";
export {
  createWhatsAppOutboundRouter,
  type WhatsAppOutboundRouterDeps,
} from "./whatsappOutboundRoutes.ts";
export {
  createWhatsAppInboxRouter,
  requireInboxRbac,
  type WhatsAppInboxRouterDeps,
} from "./whatsappInboxRoutes.ts";
export {
  buildProductionInboxServiceOptions,
  buildProductionWebhookAutoLinkLead,
  type ProductionInboxWiringDeps,
} from "./whatsappInboxProductionWiring.ts";
export {
  createInboxOutboundSendPort,
  isInboxSendTransportReady,
  type InboxSendTransportDeps,
} from "./whatsappInboxSendTransport.ts";
export {
  sendOutboundPlainText,
  validateOutboundText,
  type OutboundSendResult,
} from "./whatsappOutboundService.ts";
export {
  sendWhatsAppTextMessage,
  sanitizeProviderError,
  buildWhatsAppMessagesUrl,
} from "./whatsappGraphClient.ts";
export {
  canSendOutboundWhatsApp,
  authorizeOutboundWhatsAppActor,
} from "./whatsappPermissions.ts";

/**
 * Path-scoped raw-body middleware for Meta webhook signature verification.
 * Must be registered immediately after `const app = express()` and before
 * the global `express.json()` parser so req.body remains the exact Buffer.
 */
export function installWhatsAppRawBodyMiddleware(app: Express): void {
  const rawParser = express.raw({
    type: "*/*",
    limit: WHATSAPP_WEBHOOK_MAX_BODY_BYTES,
  });

  const scoped: RequestHandler = (req, res, next) => {
    if (req.method !== "POST") {
      next();
      return;
    }
    rawParser(req, res, (err) => {
      if (err) {
        const typed = err as { type?: string };
        // Mounted only on the WhatsApp webhook path — fail closed with 413.
        if (typed?.type === "entity.too.large") {
          res.status(413).json({ error: "Payload too large" });
          return;
        }
        whatsappRawBodyErrorHandler(err, req, res, next);
        return;
      }
      next();
    });
  };

  app.use(WHATSAPP_WEBHOOK_PATH, scoped);
}
