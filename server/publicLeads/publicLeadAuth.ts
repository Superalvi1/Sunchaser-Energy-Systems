import { timingSafeEqual } from "crypto";
import type { Request } from "express";

export const PUBLIC_LEAD_API_KEY_HEADER = "x-public-lead-key";
export const PUBLIC_LEAD_API_KEY_ENV = "PUBLIC_LEAD_API_KEY";

/**
 * Constant-time API key comparison for the public lead gateway.
 * Key is read only from server env — never from client bundles.
 */
export function readPublicLeadApiKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string {
  return String(env[PUBLIC_LEAD_API_KEY_ENV] || "").trim();
}

export function extractPublicLeadApiKey(req: Request): string {
  const headerKey = req.headers[PUBLIC_LEAD_API_KEY_HEADER];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }
  if (Array.isArray(headerKey) && headerKey[0]?.trim()) {
    return headerKey[0].trim();
  }

  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

export function secureCompareSecrets(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Still run a compare against same-length buffer to reduce timing variance.
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

export function authenticatePublicLeadRequest(
  req: Request,
  env: NodeJS.ProcessEnv = process.env
): { ok: true } | { ok: false; status: 401; error: string } {
  const expected = readPublicLeadApiKeyFromEnv(env);
  if (!expected) {
    console.error("[public-leads] PUBLIC_LEAD_API_KEY is not configured");
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const provided = extractPublicLeadApiKey(req);
  if (!secureCompareSecrets(provided, expected)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
