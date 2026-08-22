/**
 * Production CORS for the Vercel CRM frontend talking to the Render API.
 *
 * Never pairs Access-Control-Allow-Credentials: true with "*".
 * Reflect only explicitly allowed origins and always Vary: Origin.
 */
import type { NextFunction, Request, Response } from "express";

export const PRODUCTION_CRM_ORIGIN = "https://crm.sunchaserenergy.co";

/**
 * Capacitor iOS serves the bundled app from `capacitor://localhost`. Unlike Android
 * (which uses `https`), this scheme cannot be changed: `server.iosScheme` explicitly
 * cannot be set to http/https because WKWebView reserves those, so the origin must be
 * allowlisted here or every API call from the iOS app fails CORS.
 */
export const CAPACITOR_IOS_ORIGIN = "capacitor://localhost";

const STATIC_ALLOWED_ORIGINS = new Set<string>([
  PRODUCTION_CRM_ORIGIN,
  CAPACITOR_IOS_ORIGIN,
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
]);

const ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS =
  "Content-Type, Authorization, Accept, Origin, X-Requested-With, X-Public-Lead-Key, Idempotency-Key";

function parseEnvOrigins(raw: string | undefined): string[] {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Exposed for tests — resolves allowlist from defaults + env. */
export function resolveCorsAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env
): Set<string> {
  const allowed = new Set(STATIC_ALLOWED_ORIGINS);
  for (const origin of parseEnvOrigins(env.CORS_ALLOWED_ORIGINS)) {
    allowed.add(origin);
  }
  for (const origin of parseEnvOrigins(env.FRONTEND_ORIGIN)) {
    allowed.add(origin);
  }
  return allowed;
}

export function isAllowedCorsOrigin(
  origin: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const value = String(origin || "").trim();
  if (!value) return false;
  if (resolveCorsAllowedOrigins(env).has(value)) return true;
  try {
    const url = new URL(value);
    // Local Vite / Express development on any port.
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function applyCorsHeaders(req: Request, res: Response): boolean {
  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);

  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    return true;
  }

  // No Origin (curl/server) or disallowed Origin: do not emit wildcard with credentials.
  return false;
}

export function createCorsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    applyCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    return next();
  };
}
