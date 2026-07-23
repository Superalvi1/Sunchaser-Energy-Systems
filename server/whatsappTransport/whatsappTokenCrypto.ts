/**
 * AES-256-GCM encryption for WhatsApp access tokens at rest.
 *
 * Format: v1:<iv-base64>:<tag-base64>:<ciphertext-base64>
 *
 * Key: WHATSAPP_TOKEN_ENCRYPTION_KEY — exactly 32 decoded bytes (hex or base64).
 * Fail closed if missing/malformed. Never log tokens, keys, or ciphertext blobs.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ALGO = "aes-256-gcm";

export class WhatsAppTokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppTokenCryptoError";
  }
}

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new WhatsAppTokenCryptoError(
      "WHATSAPP_TOKEN_ENCRYPTION_KEY is missing"
    );
  }

  // Prefer hex when the string is exactly 64 hex chars.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const fromB64 = Buffer.from(trimmed, "base64");
    if (fromB64.length === KEY_BYTES) return fromB64;
  } catch {
    // fall through
  }

  throw new WhatsAppTokenCryptoError(
    "WHATSAPP_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64)"
  );
}

export function resolveWhatsAppTokenEncryptionKey(
  envValue: string | undefined = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY
): Buffer {
  if (envValue == null || !String(envValue).trim()) {
    throw new WhatsAppTokenCryptoError(
      "WHATSAPP_TOKEN_ENCRYPTION_KEY is missing"
    );
  }
  const key = decodeKeyMaterial(String(envValue));
  if (key.length !== KEY_BYTES) {
    throw new WhatsAppTokenCryptoError(
      "WHATSAPP_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64)"
    );
  }
  return key;
}

export function encryptWhatsAppToken(
  plaintext: string,
  key: Buffer = resolveWhatsAppTokenEncryptionKey()
): string {
  if (typeof plaintext !== "string" || !plaintext) {
    throw new WhatsAppTokenCryptoError("Token plaintext is required");
  }
  if (key.length !== KEY_BYTES) {
    throw new WhatsAppTokenCryptoError("Encryption key must be 32 bytes");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptWhatsAppToken(
  stored: string,
  key: Buffer = resolveWhatsAppTokenEncryptionKey()
): string {
  if (typeof stored !== "string" || !stored.trim()) {
    throw new WhatsAppTokenCryptoError("Encrypted token value is missing");
  }
  if (key.length !== KEY_BYTES) {
    throw new WhatsAppTokenCryptoError("Decryption key must be 32 bytes");
  }

  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new WhatsAppTokenCryptoError("Encrypted token format is invalid");
  }

  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const ciphertext = Buffer.from(parts[3]!, "base64");
    if (iv.length !== IV_BYTES) {
      throw new WhatsAppTokenCryptoError("Encrypted token IV is invalid");
    }
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch (err) {
    if (err instanceof WhatsAppTokenCryptoError) throw err;
    throw new WhatsAppTokenCryptoError("Token decryption failed");
  }
}
