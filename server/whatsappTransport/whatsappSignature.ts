import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type SignatureVerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "invalid" | "missing_secret" };

const SHA256_PREFIX = "sha256=";
const SHA256_HEX_LENGTH = 64;

/**
 * Validate X-Hub-Signature-256 against the exact raw request bytes.
 * Never call with JSON.stringify(req.body).
 */
export function verifyWhatsAppSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined | null,
  appSecret: string
): SignatureVerifyResult {
  if (!appSecret) {
    return { ok: false, reason: "missing_secret" };
  }
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { ok: false, reason: "missing" };
  }

  const header = signatureHeader.trim();
  if (!header.startsWith(SHA256_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }

  const hex = header.slice(SHA256_PREFIX.length).toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length !== SHA256_HEX_LENGTH) {
    return { ok: false, reason: "malformed" };
  }

  const expectedHex = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  const provided = Buffer.from(hex, "utf8");
  const expected = Buffer.from(expectedHex, "utf8");
  if (provided.length !== expected.length) {
    return { ok: false, reason: "invalid" };
  }
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}

/** SHA-256 digest of exact raw bytes (envelope idempotency key). */
export function sha256Hex(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
