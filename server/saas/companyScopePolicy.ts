import { normalizeHttpMethod } from "../middleware/publicRoutes.ts";

/**
 * Company scope of every API path. Fail closed: a path no rule matches is "unmatched" and is refused in
 * multi-company mode. A test walks the routes registered in server.ts and fails if any is unmatched.
 *
 *  none          identity or health: no company needed (login, register, password reset, health)
 *  company       authenticated and acting for the caller's company (database restricted by the tenant role)
 *  founding_only global or not-yet-scoped feature; only the founding company's members may use it
 *  public_founding public intake that is not yet resolved per company (Phase 4/5): runs as the founding company
 *  signed_link   bearer-signed storage link; the object key carries the company, no session
 *  platform      platform administrators only
 */
export type CompanyScope = "none" | "company" | "founding_only" | "public_founding" | "signed_link" | "platform" | "unmatched";

type Rule = { prefix: string; scope: Exclude<CompanyScope, "unmatched">; exact?: boolean };

// Order matters: first match wins, so specific rules precede general ones.
const RULES: Rule[] = [
  { prefix: "/health", scope: "none", exact: true },
  // Self-registration links a customer profile (customers/leads), so it needs a company until Phase 3 adds company links.
  { prefix: "/api/auth/register", scope: "public_founding", exact: true },
  { prefix: "/api/auth/", scope: "none" },
  { prefix: "/api/platform/", scope: "platform" },
  { prefix: "/api/company/", scope: "company" },
  { prefix: "/api/storage/object/", scope: "signed_link" },
  { prefix: "/api/public/", scope: "public_founding" },
  { prefix: "/api/whatsapp/", scope: "public_founding" },
  { prefix: "/api/marketplace/", scope: "founding_only" },
  { prefix: "/api/learning/", scope: "founding_only" },
  { prefix: "/api/whatsapp-agent/", scope: "founding_only" },
  { prefix: "/api/diagnostics/", scope: "founding_only" },
  { prefix: "/api/debug/", scope: "founding_only" },
  { prefix: "/api/backup/", scope: "founding_only" },
  { prefix: "/api/db/", scope: "founding_only" },
  { prefix: "/api/state", scope: "founding_only", exact: true },
  // Staff and user administration spans identities; company members are managed under /api/company/members.
  { prefix: "/api/admin/users", scope: "founding_only" },
  { prefix: "/api/admin/roles", scope: "founding_only" },
  { prefix: "/api/admin/customer-accounts", scope: "founding_only" },
  { prefix: "/api/admin/customer-linking", scope: "founding_only" },
  { prefix: "/api/admin/backfill-client-profiles", scope: "founding_only" },
  { prefix: "/api/admin/website-catalog-sync", scope: "founding_only" },
  { prefix: "/api/admin/whatsapp", scope: "founding_only" },
  { prefix: "/api/admin/", scope: "company" },
  { prefix: "/api/customer-portal/", scope: "company" },
  { prefix: "/api/leads", scope: "company" },
  { prefix: "/api/export/", scope: "company" },
  { prefix: "/api/technical/", scope: "company" },
  { prefix: "/api/tickets", scope: "company" },
  { prefix: "/api/onboarding", scope: "company" },
  { prefix: "/api/gemini/", scope: "company" },
  { prefix: "/api/ai/", scope: "company" },
  { prefix: "/api/warranties", scope: "company" },
  { prefix: "/api/quote-assets", scope: "company" },
  { prefix: "/api/projects", scope: "company" },
  { prefix: "/api/orders", scope: "company" },
  { prefix: "/api/upload", scope: "company" },
  { prefix: "/api/staff/", scope: "company" },
  { prefix: "/api/payments/", scope: "company" },
  { prefix: "/api/notifications", scope: "company" },
  { prefix: "/api/inventory/", scope: "company" },
  { prefix: "/api/branding", scope: "company" },
  { prefix: "/api/conversations", scope: "company" },
  { prefix: "/api/inbox", scope: "company" },
  { prefix: "/api/interactive-proposals", scope: "company" },
];

export function resolveCompanyScope(method: string, pathname: string): CompanyScope {
  const path = (pathname.split("?")[0] || pathname).replace(/\/+$/, "") || "/";
  void normalizeHttpMethod(method);
  for (const rule of RULES) {
    if (rule.exact ? path === rule.prefix : path === rule.prefix.replace(/\/$/, "") || path.startsWith(rule.prefix)) {
      return rule.scope;
    }
  }
  return path === "/api" || path.startsWith("/api/") ? "unmatched" : "none";
}

export const COMPANY_SCOPE_RULES: readonly Rule[] = RULES;
