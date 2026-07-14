import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PREFIX = "s1:";

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64);
  return `${PREFIX}${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Legacy plaintext password comparison is opt-in for local/dev only.
 * Always disabled in production — even if ALLOW_LEGACY_PLAINTEXT_PASSWORDS is set.
 * Default: false (fail closed).
 */
export function isLegacyPlaintextPasswordAllowed(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  if (nodeEnv === "production") return false;
  return env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS === "true";
}

export function isScryptPasswordHash(stored: string): boolean {
  return String(stored || "").startsWith(PREFIX);
}

/**
 * Verify a password against a stored credential.
 * Never logs passwords or hashes.
 */
export function verifyPassword(
  plain: string,
  stored: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!stored) return false;
  if (!stored.startsWith(PREFIX)) {
    // Fail closed in production and when the legacy flag is unset.
    if (!isLegacyPlaintextPasswordAllowed(env)) return false;
    return plain === stored;
  }
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plain, salt, 64);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
