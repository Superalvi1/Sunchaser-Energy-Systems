import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const PREFIX = "s1:";

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64);
  return `${PREFIX}${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored) return false;
  if (!stored.startsWith(PREFIX)) {
    return plain === stored;
  }
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plain, salt, 64);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
