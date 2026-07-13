/**
 * CORS allowlist — never reflect arbitrary Origins.
 * Configure via CORS_ALLOWED_ORIGINS (comma-separated) plus APP_URL / Vercel defaults.
 */

export function parseCorsAllowlist(envValue?: string | null): string[] {
  return String(envValue || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function getAllowedCorsOrigins(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const fromEnv = parseCorsAllowlist(env.CORS_ALLOWED_ORIGINS);
  const appUrl = String(env.APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  const vercelHost = String(env.VERCEL_URL || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const vercelUrl = vercelHost ? `https://${vercelHost}` : "";

  const localDev = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];

  // Production/Vercel CRM domains commonly used by this project (explicit, not reflective).
  const knownProd = [
    "https://sunchaser-energy-systems.vercel.app",
  ];

  const merged = [
    ...fromEnv,
    ...(appUrl ? [appUrl] : []),
    ...(vercelUrl ? [vercelUrl] : []),
    ...localDev,
    ...knownProd,
  ];

  return [...new Set(merged)];
}

export function isOriginAllowed(
  origin: string | undefined | null,
  allowlist: string[] = getAllowedCorsOrigins()
): boolean {
  if (!origin) return false;
  const normalized = String(origin).trim().replace(/\/$/, "");
  return allowlist.includes(normalized);
}

export type CorsHeaderResult = {
  allowOrigin: string | null;
  allowed: boolean;
};

/** Resolve Access-Control-Allow-Origin for a request. Never echoes unapproved origins. */
export function resolveCorsAllowOrigin(
  origin: string | undefined | null,
  allowlist: string[] = getAllowedCorsOrigins()
): CorsHeaderResult {
  if (!origin) {
    // Non-browser or same-origin requests may omit Origin; omit ACAO rather than "*"+credentials.
    return { allowOrigin: null, allowed: true };
  }
  if (isOriginAllowed(origin, allowlist)) {
    return { allowOrigin: String(origin).trim().replace(/\/$/, ""), allowed: true };
  }
  return { allowOrigin: null, allowed: false };
}
