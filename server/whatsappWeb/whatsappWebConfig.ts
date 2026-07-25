/**
 * Server-only WhatsApp Web QR configuration.
 * Never import from browser/Vite bundles. Never log auth paths with secrets.
 */

export const WHATSAPP_WEB_QR_FLAG = "WHATSAPP_WEB_QR_ENABLED";
export const WHATSAPP_WEB_AUTH_DIR_ENV = "WHATSAPP_WEB_AUTH_DIR";

/** Stable synthetic channel id for Inbox whatsapp_channels.phone_number_id. */
export const WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID = "wa_web_qr_sunchaser";

/** Normalized messaging connection id for transport whatsapp_web_qr. */
export const WHATSAPP_WEB_QR_CONNECTION_ID = "wa_web_qr_sunchaser";

/** Single-tenant session folder name under the auth directory. */
export const WHATSAPP_WEB_SESSION_DIR_NAME = "sunchaser";

/** Production default auth directory (Render persistent disk). */
export const WHATSAPP_WEB_AUTH_DIR_PRODUCTION_DEFAULT =
  "/var/data/whatsapp-web-auth";

/** QR payload TTL used for expiry/regeneration signalling. */
export const WHATSAPP_WEB_QR_TTL_MS = 55_000;

export type WhatsAppWebConfig = {
  enabled: boolean;
  authDir: string | null;
  isProduction: boolean;
};

function readFlag(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = String(env[key] ?? "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

/**
 * Resolve QR connector config. Default enabled=false.
 * Auth directory: WHATSAPP_WEB_AUTH_DIR, else production default when NODE_ENV=production.
 */
export function readWhatsAppWebConfig(
  env: NodeJS.ProcessEnv = process.env
): WhatsAppWebConfig {
  const enabled = readFlag(env, WHATSAPP_WEB_QR_FLAG);
  const configured = String(env[WHATSAPP_WEB_AUTH_DIR_ENV] ?? "").trim();
  const isProduction = isProductionEnv(env);
  const authDir =
    configured ||
    (isProduction ? WHATSAPP_WEB_AUTH_DIR_PRODUCTION_DEFAULT : null);
  return { enabled, authDir, isProduction };
}

/**
 * Fail closed when QR mode is enabled but auth directory is missing/unusable.
 * Callers should invoke before starting a socket.
 */
export function assertWhatsAppWebAuthDirReady(config: WhatsAppWebConfig): void {
  if (!config.enabled) return;
  if (!config.authDir || !config.authDir.trim()) {
    throw new Error(
      `${WHATSAPP_WEB_QR_FLAG} is enabled but ${WHATSAPP_WEB_AUTH_DIR_ENV} is not configured`
    );
  }
}
