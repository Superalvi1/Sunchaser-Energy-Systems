/**
 * AES-256-GCM WhatsApp token crypto tests (RC-1.2.4B).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  decryptWhatsAppToken,
  encryptWhatsAppToken,
  resolveWhatsAppTokenEncryptionKey,
  WhatsAppTokenCryptoError,
} from "./whatsappTokenCrypto.ts";

const KEY_HEX = randomBytes(32).toString("hex");
const KEY_B64 = randomBytes(32).toString("base64");

await test("hex key round trip", () => {
  const key = resolveWhatsAppTokenEncryptionKey(KEY_HEX);
  const enc = encryptWhatsAppToken("EAAG_secret_token", key);
  assert.match(enc, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.equal(decryptWhatsAppToken(enc, key), "EAAG_secret_token");
});

await test("base64 key round trip", () => {
  const key = resolveWhatsAppTokenEncryptionKey(KEY_B64);
  const enc = encryptWhatsAppToken("plain-token", key);
  assert.equal(decryptWhatsAppToken(enc, key), "plain-token");
});

await test("same plaintext produces different ciphertext", () => {
  const key = resolveWhatsAppTokenEncryptionKey(KEY_HEX);
  const a = encryptWhatsAppToken("same", key);
  const b = encryptWhatsAppToken("same", key);
  assert.notEqual(a, b);
  assert.equal(decryptWhatsAppToken(a, key), "same");
  assert.equal(decryptWhatsAppToken(b, key), "same");
});

await test("tampered ciphertext fails closed", () => {
  const key = resolveWhatsAppTokenEncryptionKey(KEY_HEX);
  const enc = encryptWhatsAppToken("token", key);
  const parts = enc.split(":");
  const buf = Buffer.from(parts[3]!, "base64");
  buf[0] = (buf[0]! + 1) % 256;
  parts[3] = buf.toString("base64");
  assert.throws(
    () => decryptWhatsAppToken(parts.join(":"), key),
    (err: unknown) => err instanceof WhatsAppTokenCryptoError
  );
});

await test("tampered auth tag fails closed", () => {
  const key = resolveWhatsAppTokenEncryptionKey(KEY_HEX);
  const enc = encryptWhatsAppToken("token", key);
  const parts = enc.split(":");
  const tag = Buffer.from(parts[2]!, "base64");
  tag[0] = (tag[0]! + 1) % 256;
  parts[2] = tag.toString("base64");
  assert.throws(
    () => decryptWhatsAppToken(parts.join(":"), key),
    (err: unknown) => err instanceof WhatsAppTokenCryptoError
  );
});

await test("wrong key fails closed", () => {
  const keyA = resolveWhatsAppTokenEncryptionKey(KEY_HEX);
  const keyB = resolveWhatsAppTokenEncryptionKey(randomBytes(32).toString("hex"));
  const enc = encryptWhatsAppToken("token", keyA);
  assert.throws(
    () => decryptWhatsAppToken(enc, keyB),
    (err: unknown) => err instanceof WhatsAppTokenCryptoError
  );
});

await test("missing key fails closed", () => {
  assert.throws(
    () => resolveWhatsAppTokenEncryptionKey(""),
    (err: unknown) => err instanceof WhatsAppTokenCryptoError
  );
  assert.throws(
    () => resolveWhatsAppTokenEncryptionKey(undefined),
    (err: unknown) => err instanceof WhatsAppTokenCryptoError
  );
});

await test("malformed stored value fails closed", () => {
  const key = resolveWhatsAppTokenEncryptionKey(KEY_HEX);
  assert.throws(
    () => decryptWhatsAppToken("not-valid", key),
    (err: unknown) => err instanceof WhatsAppTokenCryptoError
  );
  assert.throws(
    () => decryptWhatsAppToken("v2:a:b:c", key),
    (err: unknown) => err instanceof WhatsAppTokenCryptoError
  );
});

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    process.exitCode = 1;
  }
}
