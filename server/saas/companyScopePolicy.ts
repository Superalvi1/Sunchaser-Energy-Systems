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
type PatternRule = { pattern: RegExp; scope: Exclude<CompanyScope, "unmatched"> };

/**
 * After-sales group (server/saas/moduleGate.ts, "afterSales"): not finished for companies other than the founding one. Patterns, because
 * several of these paths carry an id in the middle. Checked before the prefix rules.
 */
export const AFTER_SALES_PATTERNS: RegExp[] = [
  /^\/api\/admin\/deliveries(\/|$)/,
  /^\/api\/admin\/delivery-dashboard(\/|$)/,
  /^\/api\/admin\/invoices\/[^/]+\/(deliveries|delivery-summary)$/,
  /^\/api\/admin\/project-deliveries(\/|$)/,
  /^\/api\/admin\/project-completion(\/|$)/,
  /^\/api\/admin\/customer-warranties(\/|$)/,
  /^\/api\/admin\/customers\/[^/]+\/warranty-certificate$/,
  /^\/api\/admin\/warranty-claims(\/|$)/,
  /^\/api\/customer-portal\/(deliveries|project-delivery|warranties|warranty-)/,
  /^\/api\/export\/pdf\/warranty-handover(\/|$)/,
  /^\/api\/technical\/project-deliveries(\/|$)/,
  /^\/api\/warranties(\/|$)/,
];

/**
 * Design tools (server/saas/moduleGate.ts, "designTools"): interactive proposals, Proposal Studio and Roof Studio. Their pricing and
 * equipment catalogue are Sunchaser's and they were not exercised with two companies, so they are founding-only until they are.
 */
export const DESIGN_TOOLS_PATTERNS: RegExp[] = [
  /^\/api\/interactive-proposals(\/|$)/,
  /^\/api\/leads\/[^/]+\/design-session$/,
  /^\/api\/export\/pdf\/design-studio-proposal(\/|$)/,
  // The AI assistant and the solar sizing wizard (moduleGate.ts, "assistants"): Sunchaser prompts and catalogue.
  /^\/api\/ai(\/|$)/,
  /^\/api\/gemini(\/|$)/,
];


// Order matters: first match wins, so specific rules precede general ones.
const RULES: Rule[] = [
  { prefix: "/health", scope: "none", exact: true },
  { prefix: "/api/maintenance-status", scope: "none", exact: true },   // answers before any session check: is serving paused by the isolation guard
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
  // Boot payload of the CRM: company-scoped (every table it reads is tenant data; users are never included).
  { prefix: "/api/state", scope: "company", exact: true },
  // Staff and user administration spans identities; company members are managed under /api/company/members.
  { prefix: "/api/admin/users", scope: "founding_only" },
  { prefix: "/api/admin/roles", scope: "founding_only" },
  { prefix: "/api/admin/customer-accounts", scope: "founding_only" },
  { prefix: "/api/admin/customer-linking", scope: "founding_only" },
  { prefix: "/api/admin/backfill-client-profiles", scope: "founding_only" },
  { prefix: "/api/admin/website-catalog-sync", scope: "founding_only" },
  // AutoSizer prices from Sunchaser's own price list: no per-company price book yet (server/saas/moduleGate.ts).
  { prefix: "/api/admin/autosizer-presets", scope: "founding_only" },
  { prefix: "/api/export/pdf/auto-sizer/", scope: "founding_only" },
  { prefix: "/api/admin/whatsapp", scope: "founding_only" },
  { prefix: "/api/admin/", scope: "company" },
  { prefix: "/api/customer-portal/", scope: "company" },
  { prefix: "/api/leads", scope: "company" },
  { prefix: "/api/export/", scope: "company" },
  { prefix: "/api/technical/", scope: "company" },
  { prefix: "/api/tickets", scope: "company" },
  { prefix: "/api/onboarding", scope: "company" },
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
  // The WhatsApp inbox needs a WhatsApp connection, which exists for the founding company only (/api/admin/whatsapp, /api/whatsapp-agent).
  { prefix: "/api/conversations", scope: "founding_only" },
  { prefix: "/api/inbox", scope: "founding_only" },
];

export function resolveCompanyScope(method: string, pathname: string): CompanyScope {
  const path = (pathname.split("?")[0] || pathname).replace(/\/+$/, "") || "/";
  void normalizeHttpMethod(method);
  if (AFTER_SALES_PATTERNS.some((re) => re.test(path)) || DESIGN_TOOLS_PATTERNS.some((re) => re.test(path))) return "founding_only";
  for (const rule of RULES) {
    if (rule.exact ? path === rule.prefix : path === rule.prefix.replace(/\/$/, "") || path.startsWith(rule.prefix)) {
      return rule.scope;
    }
  }
  return path === "/api" || path.startsWith("/api/") ? "unmatched" : "none";
}

export const COMPANY_SCOPE_RULES: readonly Rule[] = RULES;
