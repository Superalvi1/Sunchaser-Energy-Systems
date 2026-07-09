/**
 * Phase 1B.2A — Customer JWT actors may only reach customer-portal routes
 * and a small set of shared endpoints (session + owned PDF exports).
 */

export function normalizeApiPathname(pathname: string): string {
  return pathname.split("?")[0] || pathname;
}

const CUSTOMER_ALLOWED_EXACT = new Set(["/api/auth/me", "/api/customer-portal"]);

const CUSTOMER_ALLOWED_PREFIXES = ["/api/customer-portal/"];

/** Staff PDF routes that customers may access when handler enforces ownership. */
const CUSTOMER_ALLOWED_STAFF_PDF_PREFIXES = [
  "/api/export/pdf/invoice/",
  "/api/export/pdf/warranty-handover/",
];

export function isCustomerAllowedApiRoute(pathname: string): boolean {
  const path = normalizeApiPathname(pathname);
  if (CUSTOMER_ALLOWED_EXACT.has(path)) return true;
  if (CUSTOMER_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (CUSTOMER_ALLOWED_STAFF_PDF_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return false;
}
