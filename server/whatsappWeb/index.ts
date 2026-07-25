export {
  WHATSAPP_WEB_QR_FLAG,
  WHATSAPP_WEB_AUTH_DIR_ENV,
  WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
  WHATSAPP_WEB_QR_CONNECTION_ID,
  WHATSAPP_WEB_AUTH_DIR_PRODUCTION_DEFAULT,
  readWhatsAppWebConfig,
  assertWhatsAppWebAuthDirReady,
} from "./whatsappWebConfig.ts";

export {
  maskPhoneNumber,
  FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS,
  WHATSAPP_WEB_LIFECYCLE_STATES,
  type WhatsAppWebLifecycleState,
  type WhatsAppWebSafeStatus,
  type WhatsAppWebQrPayload,
} from "./whatsappWebTypes.ts";

export {
  resolveWhatsAppWebAuthPaths,
  assertPathInsideRoot,
  ensureWhatsAppWebAuthDirWritable,
  deleteWhatsAppWebSessionDir,
} from "./whatsappWebAuthDir.ts";

export {
  WhatsAppWebSession,
  getSharedWhatsAppWebSession,
  __resetSharedWhatsAppWebSession,
  type WhatsAppWebSocketFactory,
  type WhatsAppWebInboundHandler,
} from "./whatsappWebSession.ts";

export {
  normalizeBaileysInbound,
  jidToWaId,
  waIdToChatJid,
} from "./whatsappWebNormalize.ts";

export {
  persistWhatsAppWebInbound,
  createWhatsAppWebMessagingBridge,
} from "./whatsappWebInbound.ts";

export {
  sendWhatsAppWebPlainText,
  isWhatsAppWebQrChannel,
} from "./whatsappWebOutbound.ts";

export { createWhatsAppWebTransportAdapter } from "./whatsappWebTransportAdapter.ts";
export { createWhatsAppWebRouter } from "./whatsappWebRoutes.ts";
export {
  createWhatsAppWebRateLimit,
  resetWhatsAppWebRateLimitStore,
} from "./whatsappWebRateLimit.ts";
