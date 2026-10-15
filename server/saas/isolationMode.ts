import { isMultiCompanyEnabled } from "./multiCompany.ts";

/**
 * What this process tells the database about itself, in the header x-isolation-mode of every service-role request (see scripts/saas/phase2i-tenancy-barrier.sql).
 *   multi        the multi-company flag is on: every query is bound to a company, row-level security does the rest
 *   single       the flag is off: the single-company code path (no company filter). Refused by the database while the tenancy marker is on.
 *   global-only  a job that declared (declareGlobalOnlyProcess) that it only touches tables no pilot company has data in; the database lets it reach marketplace
 *                and learning paths only.
 * The header is an assertion that stops code which does not know about companies. It is not a credential.
 */
let declared: "global-only" | null = null;
let declaredReason = "";

export function getIsolationMode(env: NodeJS.ProcessEnv = process.env): "multi" | "single" | "global-only" {
  if (declared) return declared;
  return isMultiCompanyEnabled(env) ? "multi" : "single";
}

/**
 * For a standalone job (a cron entry point) that reads and writes only sunchaser_only tables (scripts/saas/table-classification.json: marketplace, learning).
 * Never call this from the web server: it would let the server's service-role requests through the barrier for marketplace paths only, which is harmless,
 * but it would also mask a flag-off server from the barrier for those paths and is therefore refused when the multi-company flag is on.
 */
export function declareGlobalOnlyProcess(reason: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!reason || reason.trim().length < 3) throw new Error("declareGlobalOnlyProcess needs a reason");
  if (isMultiCompanyEnabled(env)) throw new Error("A multi-company process is not a global-only job.");
  declared = "global-only";
  declaredReason = reason;
}

export function describeIsolationMode(): string {
  return declared ? `global-only (${declaredReason})` : getIsolationMode();
}

export function resetIsolationModeForTests(): void {
  declared = null;
  declaredReason = "";
}
