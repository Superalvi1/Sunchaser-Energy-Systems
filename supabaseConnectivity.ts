/**
 * Supabase reachability helpers for auth and API error mapping.
 * No secrets logged. Local dev may fall back to database.json when upstream is down.
 */

export const SUPABASE_UNAVAILABLE_CODE = "SUPABASE_UNAVAILABLE";

export class SupabaseUnavailableError extends Error {
  code = SUPABASE_UNAVAILABLE_CODE;
  statusCode = 503;

  constructor(message = "Authentication service temporarily unavailable.") {
    super(message);
    this.name = "SupabaseUnavailableError";
  }
}

function collectErrorText(err: unknown): string {
  const parts: string[] = [];
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    parts.push(err.message);
    if (err.cause != null) parts.push(String(err.cause));
  }
  const obj = err as Record<string, unknown>;
  for (const key of ["message", "details", "hint", "code"]) {
    if (obj[key] != null) parts.push(String(obj[key]));
  }
  return parts.join(" ");
}

/** True when the failure looks like DNS / network / upstream fetch — not bad credentials. */
export function isSupabaseConnectivityError(err: unknown): boolean {
  const hay = collectErrorText(err).toLowerCase();
  if (!hay) return false;
  return (
    hay.includes("fetch failed") ||
    hay.includes("enotfound") ||
    hay.includes("getaddrinfo") ||
    hay.includes("econnrefused") ||
    hay.includes("etimedout") ||
    hay.includes("eai_again") ||
    hay.includes("network") ||
    hay.includes("dns") ||
    hay.includes("socket hang up")
  );
}

/** Local development may authenticate against database.json when Supabase is unreachable. */
export function isLocalDatabaseAuthFallbackEnabled(): boolean {
  return String(process.env.NODE_ENV || "development").toLowerCase() !== "production";
}

export function mapSupabaseAuthError(err: unknown): Error {
  if (!isSupabaseConnectivityError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  if (isLocalDatabaseAuthFallbackEnabled()) {
    return err instanceof Error ? err : new Error(String(err));
  }
  return new SupabaseUnavailableError();
}
