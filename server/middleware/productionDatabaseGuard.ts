/**
 * Production must fail fast when Supabase is not configured/active.
 * Local JSON (database.json) is allowed only for development/test.
 */

export function assertProductionDatabaseReady(options: {
  nodeEnv?: string | null;
  supabaseActive: boolean;
}): void {
  const env = String(options.nodeEnv || "").trim().toLowerCase();
  if (env !== "production") return;
  if (options.supabaseActive) return;
  throw new Error(
    "FATAL: Production requires an active Supabase database. " +
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. " +
      "Local database.json fallback is disabled in production."
  );
}

export function isLocalDatabaseJsonFallbackAllowed(
  nodeEnv: string | null | undefined = process.env.NODE_ENV
): boolean {
  const env = String(nodeEnv || "").trim().toLowerCase();
  return env !== "production";
}
