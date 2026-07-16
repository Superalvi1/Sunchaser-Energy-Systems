import {
  WHATSAPP_GRAPH_API_VERSION_FALLBACK,
} from "./whatsappConstants.ts";

export type WhatsAppConfig = {
  enabled: boolean;
  webhookVerifyToken: string;
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
};

function readFlag(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = String(env[key] ?? "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function readSecret(env: NodeJS.ProcessEnv, key: string): string {
  return String(env[key] ?? "").trim();
}

/** Server-only WhatsApp Cloud API configuration. Never use VITE_ prefixes. */
export function readWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  const configuredVersion = readSecret(env, "WHATSAPP_GRAPH_API_VERSION");
  return {
    enabled: readFlag(env, "WHATSAPP_CONVERSATIONS_ENABLED"),
    webhookVerifyToken: readSecret(env, "WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
    appSecret: readSecret(env, "WHATSAPP_APP_SECRET"),
    accessToken: readSecret(env, "WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: readSecret(env, "WHATSAPP_PHONE_NUMBER_ID"),
    // Documented replaceable fallback for local/dev compatibility only.
    graphApiVersion: configuredVersion || WHATSAPP_GRAPH_API_VERSION_FALLBACK,
  };
}

export function isWhatsAppEnabled(config: WhatsAppConfig): boolean {
  return config.enabled === true;
}

export function hasWebhookVerifyConfig(config: WhatsAppConfig): boolean {
  return config.webhookVerifyToken.length > 0;
}

export function hasSignatureConfig(config: WhatsAppConfig): boolean {
  return config.appSecret.length > 0;
}

export function hasOutboundSendConfig(config: WhatsAppConfig): boolean {
  return (
    config.accessToken.length > 0 &&
    config.phoneNumberId.length > 0 &&
    config.graphApiVersion.length > 0
  );
}
