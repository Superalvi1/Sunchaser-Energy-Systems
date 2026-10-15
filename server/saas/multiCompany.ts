/** Feature switch and constants for multi-company mode. Off by default: behaviour is then exactly as before. */
export const FOUNDING_COMPANY_ID = "sunchaser";

export const COMPANY_ID_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

export function isMultiCompanyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MULTI_COMPANY_ENABLED || "").trim().toLowerCase() === "true";
}

export function isValidCompanyId(value: unknown): value is string {
  return typeof value === "string" && COMPANY_ID_PATTERN.test(value);
}

/** Fail fast at boot: multi-company mode cannot run on the local JSON fallback or without the tenant key. */
export function assertMultiCompanyConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!isMultiCompanyEnabled(env)) return;
  const missing: string[] = [];
  if (!String(env.RAILWAY_POSTGREST_URL || env.SUPABASE_URL || "").trim()) missing.push("RAILWAY_POSTGREST_URL");
  if (!String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!String(env.CRM_TENANT_POSTGREST_KEY || "").trim()) missing.push("CRM_TENANT_POSTGREST_KEY");
  if (missing.length) {
    throw new Error(`MULTI_COMPANY_ENABLED=true requires: ${missing.join(", ")}`);
  }
}
