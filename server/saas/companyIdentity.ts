import { getCompanyContext } from "./companyContext.ts";
import { FOUNDING_COMPANY_ID, isMultiCompanyEnabled } from "./multiCompany.ts";

/**
 * Company-specific settings live in tables with a global key (settings.key, website_content.key). The founding company keeps its
 * existing keys unchanged ("global", "company_branding", ...). Every other company stores the same settings under "<company>:<key>",
 * which cannot collide with anything the founding company or another company has. The database enforces the same rule (phase2d).
 */
export function settingsScopeCompany(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isMultiCompanyEnabled(env)) return null;
  const ctx = getCompanyContext();
  if (ctx?.kind !== "company") return null;
  return ctx.companyId === FOUNDING_COMPANY_ID ? null : ctx.companyId;
}

export function scopedSettingKey(key: string, companyId: string | null = settingsScopeCompany()): string {
  return companyId ? `${companyId}:${key}` : key;
}

/** Removes the company prefix from the keys of rows read for this company, so the rest of the code sees "global" as before. */
export function unscopeSettingRows<T extends { key?: unknown }>(rows: T[] | null | undefined, companyId: string | null = settingsScopeCompany()): T[] {
  if (!rows) return [];
  if (!companyId) return rows;
  const prefix = `${companyId}:`;
  return rows
    .filter((r) => typeof r?.key === "string" && (r.key as string).startsWith(prefix))
    .map((r) => ({ ...r, key: (r.key as string).slice(prefix.length) }));
}

/** True when documents of the current unit of work must not fall back to Sunchaser defaults. */
export function usesNeutralIdentity(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isMultiCompanyEnabled(env)) return false;
  const ctx = getCompanyContext();
  if (ctx?.kind === "company") return ctx.companyId !== FOUNDING_COMPANY_ID;
  return true; // multi-company mode without a company context: never default to Sunchaser
}
