/**
 * Direct Postgres URL for CEO auto-import atomic commits.
 * Required so the server can SET LOCAL statement_timeout BEFORE invoking
 * mp_ceo_auto_import_commit_batch (in-function set_config does not cancel).
 *
 * Privilege model: commit_batch EXECUTE is granted only to
 * mp_ceo_auto_import_runtime (not service_role). The login MUST be that role
 * or an explicit MEMBER; unauthorized logins are rejected before BEGIN.
 * Prefer MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_URL pointing at such a login.
 */
export function resolveAutoImportDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const dedicated = String(env.MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_URL ?? "").trim();
  if (dedicated) return dedicated;
  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  if (databaseUrl) return databaseUrl;
  const supabaseDb = String(env.SUPABASE_DB_URL ?? "").trim();
  if (supabaseDb) return supabaseDb;
  return null;
}

export function hasAutoImportTimeoutProtection(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveAutoImportDatabaseUrl(env) != null;
}

/** Dedicated SQL role that holds EXECUTE on commit_batch. */
export const CEO_AUTO_IMPORT_RUNTIME_ROLE = "mp_ceo_auto_import_runtime";
