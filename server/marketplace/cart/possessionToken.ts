/**
 * Guest possession tokens — raw token returned once; only SHA-256 hash stored.
 * Never log raw or hashed tokens.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export function generatePossessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashPossessionToken(rawToken: string): string {
  return createHash("sha256").update(String(rawToken), "utf8").digest("hex");
}

/** Constant-time compare of raw token against stored hash. */
export function verifyPossessionToken(
  rawToken: string,
  storedHash: string,
): boolean {
  if (!rawToken || !storedHash) return false;
  const computed = Buffer.from(hashPossessionToken(rawToken), "utf8");
  const expected = Buffer.from(String(storedHash), "utf8");
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

/**
 * Read guest token from approved headers only:
 * - X-Marketplace-Token
 * - Authorization: Marketplace <token>
 * Rejects query/body usage by never reading them.
 */
export function readPossessionTokenFromHeaders(
  headers: Record<string, unknown> | {
    get?(name: string): string | null | undefined;
    [key: string]: unknown;
  },
): string | null {
  const get = (name: string): string => {
    if (typeof headers.get === "function") {
      return String(headers.get(name) || "").trim();
    }
    const direct = headers[name] ?? headers[name.toLowerCase()];
    return String(direct || "").trim();
  };

  const dedicated = get("x-marketplace-token") || get("X-Marketplace-Token");
  if (dedicated) return dedicated;

  const auth = get("authorization") || get("Authorization");
  const match = /^Marketplace\s+(.+)$/i.exec(auth);
  if (match?.[1]) return match[1].trim();

  return null;
}
