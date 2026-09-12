import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  looksLikeTokenEnvelope,
  resolvePublisherTokenEncryptionKey,
} from "../src/crypto/tokenEnvelope.ts";

describe("AES-256-GCM token envelope", () => {
  it("round-trips and matches v1:iv:tag:ciphertext format", () => {
    const key = randomBytes(32);
    const token = "EAAGnot-a-real-token-just-a-fixture";
    const stored = encryptSecret(token, key);
    assert.equal(looksLikeTokenEnvelope(stored), true);
    assert.equal(stored.split(":")[0], "v1");
    assert.equal(decryptSecret(stored, key), token);
  });

  it("fails closed on missing/short keys", () => {
    assert.throws(() => resolvePublisherTokenEncryptionKey(""));
    assert.throws(() => resolvePublisherTokenEncryptionKey("short"));
  });

  it("rejects tampered ciphertext", () => {
    const key = randomBytes(32);
    const stored = encryptSecret("hello", key);
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    assert.throws(() => decryptSecret(parts.join(":"), key));
  });
});
