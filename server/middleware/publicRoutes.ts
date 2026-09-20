/** HTTP methods that may access a public route entry. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

type PublicRouteEntry =
  | { method: HttpMethod; path: string }
  | { pathPrefix: string };

/**
 * Explicit public allowlist for centralized authorization.
 * Every /api/* route NOT listed here requires authorization (fail closed).
 */
const PUBLIC_ROUTE_ENTRIES: PublicRouteEntry[] = [
  { method: "GET", path: "/health" },
  { method: "POST", path: "/api/auth/login" },
  { method: "POST", path: "/api/auth/register" },
  { method: "POST", path: "/api/auth/verify-email" },
  { method: "GET", path: "/api/auth/verify-email" },
  { method: "POST", path: "/api/auth/forgot-password" },
  { method: "POST", path: "/api/auth/reset-password" },
  // Marketing / public lead ingestion (API-key gated inside the POST handler — not CRM JWT).
  // GET is public so the router can return 405 Method Not Allowed (Allow: POST).
  { method: "POST", path: "/api/public/leads" },
  { method: "GET", path: "/api/public/leads" },
  // WhatsApp Cloud API webhook (HMAC-gated inside the handler — not CRM JWT).
  // Canonical path: /api/whatsapp/webhook (GET verify + POST inbound).
  { method: "GET", path: "/api/whatsapp/webhook" },
  { method: "POST", path: "/api/whatsapp/webhook" },
  // Marketplace public + guest possession-token APIs (handler-gated + MARKETPLACE_ENABLED).
  // Admin finance routes under /api/marketplace/admin/* are NOT public (JWT + lockdown).
  { pathPrefix: "/api/marketplace/" },
];

export function normalizeHttpMethod(method: string): HttpMethod {
  return String(method || "GET").toUpperCase() as HttpMethod;
}

export function isPublicApiRoute(method: string, pathname: string): boolean {
  const normalizedMethod = normalizeHttpMethod(method);
  const path = pathname.split("?")[0] || pathname;

  // Android opens this URL in an external browser without the CRM Bearer JWT.
  // Only GET of one UUID token bypasses JWT; the handler enforces expiry and
  // single-use consumption. Generation/staging and every other PDF route stay protected.
  if (
    normalizedMethod === "GET" &&
    /^\/api\/export\/pdf\/staged-public\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(path)
  ) {
    return true;
  }

  if (
    (normalizedMethod === "GET" || normalizedMethod === "POST") &&
    /^\/api\/public\/interactive-proposals\/[A-Za-z0-9_-]{40,80}(?:\/(?:preview|accept))?$/.test(path)
  ) {
    return true;
  }

  // marketplaceRouteLockdown surface — requires CRM JWT via central auth.
  // Admin + auto-import alias are never public (JWT + Super Admin gates).
  if (
    path === "/api/marketplace/admin" ||
    path.startsWith("/api/marketplace/admin/") ||
    path === "/api/marketplace/auto-import" ||
    path.startsWith("/api/marketplace/auto-import/")
  ) {
    return false;
  }

  for (const entry of PUBLIC_ROUTE_ENTRIES) {
    if ("pathPrefix" in entry) {
      if (path.startsWith(entry.pathPrefix)) return true;
      continue;
    }
    if (entry.path === path && entry.method === normalizedMethod) return true;
  }
  return false;
}
