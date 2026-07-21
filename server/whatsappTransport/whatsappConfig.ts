import {
  WHATSAPP_GRAPH_API_VERSION_FALLBACK,
} from "./whatsappConstants.ts";

/** Strict Graph API version: vMAJOR.MINOR only. */
export const GRAPH_API_VERSION_PATTERN = /^v\d+\.\d+$/;

/** Meta phone_number_id values are digits-only identifiers. */
export const PHONE_NUMBER_ID_PATTERN = /^\d{5,40}$/;

export type WhatsAppConfig = {
  enabled: boolean;
  webhookVerifyToken: string;
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  /** Empty when configured version is present but invalid (fail closed). */
  graphApiVersion: string;
};

function readFlag(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = String(env[key] ?? "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function readSecret(env: NodeJS.ProcessEnv, key: string): string {
  return String(env[key] ?? "").trim();
}

export function isValidGraphApiVersion(version: string): boolean {
  return GRAPH_API_VERSION_PATTERN.test(version);
}

export function isValidPhoneNumberId(phoneNumberId: string): boolean {
  return PHONE_NUMBER_ID_PATTERN.test(phoneNumberId);
}

/**
 * Resolve Graph API version.
 * - unset → documented replaceable fallback
 * - set but invalid → empty string (outbound unavailable; no silent rewrite)
 */
export function resolveGraphApiVersion(configured: string): string {
  if (!configured) return WHATSAPP_GRAPH_API_VERSION_FALLBACK;
  if (!isValidGraphApiVersion(configured)) return "";
  return configured;
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
    graphApiVersion: resolveGraphApiVersion(configuredVersion),
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
    isValidPhoneNumberId(config.phoneNumberId) &&
    isValidGraphApiVersion(config.graphApiVersion)
  );
}
