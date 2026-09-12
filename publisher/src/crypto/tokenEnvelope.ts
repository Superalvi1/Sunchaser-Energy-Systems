/**
 * AES-256-GCM token envelope.
 *
 * Wire format matches the existing CRM WhatsApp layer so Publisher can
 * share operational practice (not the same key):
 *   v1:<iv-base64>:<tag-base64>:<ciphertext-base64>
 *
 * Key: PUBLISHER_TOKEN_ENCRYPTION_KEY — exactly 32 decoded bytes (hex or base64).
 * Never log plaintext, keys, IVs, tags, or ciphertext blobs.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const TOKEN_ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ALGO = "aes-256-gcm";

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new TokenCryptoError("PUBLISHER_TOKEN_ENCRYPTION_KEY is missing");
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    const fromB64 = Buffer.from(trimmed, "base64");
    if (fromB64.length === KEY_BYTES) return fromB64;
  } catch {
    // fall through
  }
  throw new TokenCryptoError(
    "PUBLISHER_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64)"
  );
}

export function resolvePublisherTokenEncryptionKey(
  envValue: string | undefined = process.env.PUBLISHER_TOKEN_ENCRYPTION_KEY
): Buffer {
  if (envValue == null || !String(envValue).trim()) {
    throw new TokenCryptoError("PUBLISHER_TOKEN_ENCRYPTION_KEY is missing");
  }
  const key = decodeKeyMaterial(String(envValue));
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError(
      "PUBLISHER_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64)"
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (typeof plaintext !== "string" || !plaintext) {
    throw new TokenCryptoError("Secret plaintext is required");
  }
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError("Encryption key must be 32 bytes");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    TOKEN_ENVELOPE_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored: string, key: Buffer): string {
  if (typeof stored !== "string" || !stored.trim()) {
    throw new TokenCryptoError("Encrypted secret value is missing");
  }
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError("Decryption key must be 32 bytes");
  }
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== TOKEN_ENVELOPE_VERSION) {
    throw new TokenCryptoError("Encrypted secret format is invalid");
  }
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const ciphertext = Buffer.from(parts[3]!, "base64");
    if (iv.length !== IV_BYTES) {
      throw new TokenCryptoError("Encrypted secret IV is invalid");
    }
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString("utf8");
  } catch (err) {
    if (err instanceof TokenCryptoError) throw err;
    throw new TokenCryptoError("Secret decryption failed");
  }
}

export function looksLikeTokenEnvelope(value: string): boolean {
  return value.startsWith(`${TOKEN_ENVELOPE_VERSION}:`) && value.split(":").length === 4;
}
