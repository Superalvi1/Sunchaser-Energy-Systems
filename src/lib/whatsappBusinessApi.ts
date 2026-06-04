/**
 * Phase 2 — WhatsApp Business API (Cloud API) integration layer.
 * Phase 1 uses click-to-chat only; this module defines contracts and stubs.
 */

export type WhatsAppDeliveryChannel = "click_to_chat" | "business_api";

export type WhatsAppBusinessMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export interface WhatsAppBusinessConfig {
  /** Meta WhatsApp Business phone number ID */
  phoneNumberId: string;
  /** Permanent access token (store in env, never in client bundle) */
  accessToken: string;
  /** Graph API version, e.g. v21.0 */
  graphApiVersion: string;
  /** Webhook verify token for inbound status callbacks */
  webhookVerifyToken: string;
  /** Optional WABA ID for template management */
  businessAccountId?: string;
}

export interface WhatsAppOutboundMessage {
  to: string;
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: string[];
  text?: string;
  messageType: string;
  customerId?: string;
  leadId?: string;
  projectDeliveryId?: string;
}

export interface WhatsAppSendResult {
  channel: WhatsAppDeliveryChannel;
  messageId?: string;
  status: WhatsAppBusinessMessageStatus;
  error?: string;
}

/** Read config from server environment (not available in browser). */
export function getWhatsAppBusinessConfigFromEnv(): WhatsAppBusinessConfig | null {
  if (typeof process === "undefined" || !process.env) return null;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return {
    phoneNumberId,
    accessToken,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0",
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  };
}

export function isWhatsAppBusinessApiConfigured(): boolean {
  return getWhatsAppBusinessConfigFromEnv() != null;
}

/**
 * Phase 2 sender — implement Graph API POST /{phone-number-id}/messages here.
 * Until configured, returns a clear not-implemented result.
 */
export async function sendWhatsAppBusinessMessage(
  _config: WhatsAppBusinessConfig,
  message: WhatsAppOutboundMessage
): Promise<WhatsAppSendResult> {
  return {
    channel: "business_api",
    status: "failed",
    error: `WhatsApp Business API not enabled. Use click-to-chat for ${message.messageType}.`,
  };
}
