/**
 * Server-only runtime configuration for normalized messaging Postgres wiring.
 * Never import from browser/Vite bundles. Never log connection strings.
 */

/** Must stay aligned with DEFAULT_COMPANY_ID in whatsappConstants. */
export const MESSAGING_TRUSTED_ORGANIZATION_ID = "sunchaser";

export const UNIFIED_MESSAGING_POSTGRES_FLAG =
  "UNIFIED_MESSAGING_POSTGRES_ENABLED";

export type MessagingRuntimeConfig = {
  /** When false, WhatsApp runtime is unchanged (whatsapp_* only). */
  enabled: boolean;
  /**
   * Trusted organization scope for normalized writes.
   * Resolved from server constants — never from webhook/browser input.
   */
  organizationId: string;
  /**
   * Optional Postgres connection string (DATABASE_URL or SUPABASE_DB_URL).
   * Present only in server process env — never exposed to clients.
   */
  databaseUrl: string | null;
};

function readFlag(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = String(env[key] ?? "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * Resolve normalized-messaging runtime config from process env.
 * Database URL prefers DATABASE_URL, then SUPABASE_DB_URL (existing server convention).
 */
export function readMessagingRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): MessagingRuntimeConfig {
  const databaseUrl =
    String(env.DATABASE_URL ?? "").trim() ||
    String(env.SUPABASE_DB_URL ?? "").trim() ||
    null;
  return {
    enabled: readFlag(env, UNIFIED_MESSAGING_POSTGRES_FLAG),
    organizationId: MESSAGING_TRUSTED_ORGANIZATION_ID,
    databaseUrl,
  };
}

/**
 * Stable opaque connection id derived from trusted WhatsApp phone_number_id.
 * Never taken from untrusted webhook body fields alone.
 */
export function trustedMetaConnectionId(phoneNumberId: string): string {
  const id = phoneNumberId.trim();
  if (!id) {
    throw new Error("trusted phoneNumberId is required for connection id");
  }
  return `meta_wa_${id}`;
}

/**
 * Validate startup when the feature flag is enabled.
 * Throws a clear error when enabled without a database URL.
 */
export function assertMessagingRuntimeStartup(
  config: MessagingRuntimeConfig
): void {
  if (!config.enabled) return;
  if (!config.databaseUrl) {
    throw new Error(
      `${UNIFIED_MESSAGING_POSTGRES_FLAG} is enabled but DATABASE_URL / SUPABASE_DB_URL is not configured`
    );
  }
  if (!config.organizationId.trim()) {
    throw new Error("Normalized messaging organizationId is missing");
  }
}
