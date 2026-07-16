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
  // Marketing / public lead ingestion (API-key gated inside the handler — not CRM JWT).
  { method: "POST", path: "/api/public/leads" },
  // WhatsApp Cloud API webhook (HMAC-gated inside the handler — not CRM JWT).
  { method: "GET", path: "/api/integrations/whatsapp/webhook" },
  { method: "POST", path: "/api/integrations/whatsapp/webhook" },
];

export function normalizeHttpMethod(method: string): HttpMethod {
  return String(method || "GET").toUpperCase() as HttpMethod;
}

export function isPublicApiRoute(method: string, pathname: string): boolean {
  const normalizedMethod = normalizeHttpMethod(method);
  const path = pathname.split("?")[0] || pathname;

  for (const entry of PUBLIC_ROUTE_ENTRIES) {
    if ("pathPrefix" in entry) {
      if (path.startsWith(entry.pathPrefix)) return true;
      continue;
    }
    if (entry.path === path && entry.method === normalizedMethod) return true;
  }
  return false;
}
