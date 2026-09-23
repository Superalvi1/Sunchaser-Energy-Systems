/**
 * Explicit health-only Railway migration pilot. This is NOT a replacement for
 * production database, authentication or WhatsApp functionality.
 *
 * Startup fails closed if a live credential or public Railway domain is
 * accidentally attached. The matching server middleware exposes /health only.
 */
export function assertRailwayPrivateSmokeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.RAILWAY_CRM_PRIVATE_SMOKE_MODE !== "true") return false;
  if (env.NODE_ENV !== "production" || !String(env.RAILWAY_PROJECT_ID || "").trim()) {
    throw new Error("Private Railway smoke mode requires NODE_ENV=production on Railway.");
  }
  const forbiddenVariables = [
    "RAILWAY_PUBLIC_DOMAIN", "RAILWAY_STATIC_URL",
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY",
    "DATABASE_URL", "SUPABASE_DB_URL", "PUBLIC_BASE_URL", "PUBLIC_LEAD_API_KEY",
    "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_TOKEN_ENCRYPTION_KEY",
  ];
  for (const name of forbiddenVariables) {
    if (String(env[name] || "").trim()) {
      // Do not reveal or log variable values.
      throw new Error("Private Railway smoke mode forbids " + name + ".");
    }
  }
  const forbiddenFlags = [
    "WHATSAPP_CONVERSATIONS_ENABLED", "WHATSAPP_AI_AUTO_REPLY_ENABLED",
    "WHATSAPP_AI_QUERY_DRAFT_ENABLED", "WHATSAPP_AI_LIVE_PROVIDER_ENABLED",
    "UNIFIED_MESSAGING_POSTGRES_ENABLED", "MARKETPLACE_ENABLED",
    "MARKETPLACE_GATEWAY_ENABLED", "MARKETPLACE_CART_ENABLED",
    "MARKETPLACE_CHECKOUT_ENABLED", "MARKETPLACE_PAYMENTS_ENABLED",
    "MARKETPLACE_COD_ENABLED",
  ];
  for (const name of forbiddenFlags) {
    if (["1", "true", "yes"].includes(String(env[name] || "").trim().toLowerCase())) {
      throw new Error("Private Railway smoke mode forbids enabled " + name + ".");
    }
  }
  return true;
}
