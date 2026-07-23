/**
 * OAuth state store + connection repository unit tests (RC-1.2.4B).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  InMemoryWhatsAppConnectionRepository,
} from "./whatsappConnectionRepository.ts";
import {
  hashOAuthNonce,
  makeMemoryOAuthStateStore,
} from "./whatsappOAuthStateStore.ts";
import {
  encryptWhatsAppToken,
  resolveWhatsAppTokenEncryptionKey,
} from "./whatsappTokenCrypto.ts";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

await test("memory OAuth state: create/consume once; replay rejected", async () => {
  const store = makeMemoryOAuthStateStore();
  const nonce = await store.create("sunchaser", "actor-1");
  assert.ok(nonce.length >= 32);
  assert.notEqual(nonce, hashOAuthNonce(nonce));

  const first = await store.consume(nonce, "sunchaser", "actor-1");
  assert.equal(first.ok, true);
  const replay = await store.consume(nonce, "sunchaser", "actor-1");
  assert.equal(replay.ok, false);
});

await test("memory OAuth state: tenant mismatch rejected", async () => {
  const store = makeMemoryOAuthStateStore();
  const nonce = await store.create("sunchaser", "actor-1");
  const result = await store.consume(nonce, "other-co", "actor-1");
  assert.equal(result.ok, false);
});

await test("memory OAuth state: actor mismatch rejected", async () => {
  const store = makeMemoryOAuthStateStore();
  const nonce = await store.create("sunchaser", "actor-1");
  const result = await store.consume(nonce, "sunchaser", "actor-2");
  assert.equal(result.ok, false);
});

await test("memory OAuth state: expired rejected", async () => {
  const store = makeMemoryOAuthStateStore();
  // Reach into store via create then manually expire by consuming after TTL —
  // use a custom store with immediate expiry by patching Date.
  const nonce = await store.create("sunchaser", "actor-1");
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60 * 1000;
  try {
    const result = await store.consume(nonce, "sunchaser", "actor-1");
    assert.equal(result.ok, false);
  } finally {
    Date.now = realNow;
  }
});

await test("connection repository binds records to companyId", async () => {
  const repo = new InMemoryWhatsAppConnectionRepository();
  await repo.upsert({
    companyId: "sunchaser",
    wabaId: "w1",
    phoneNumberId: "p1",
    phoneNumber: "923001112233",
    accessToken: "tok",
    tokenExpiresAt: null,
    lastWebhookAt: null,
    lastError: null,
    stateOverride: null,
  });
  const row = await repo.get("sunchaser");
  assert.equal(row?.phoneNumberId, "p1");
  assert.equal(await repo.get("other"), null);
  await repo.clear("sunchaser");
  assert.equal(await repo.get("sunchaser"), null);
});

await test("encryption format used for persisted tokens (Supabase path)", () => {
  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const key = resolveWhatsAppTokenEncryptionKey();
  const enc = encryptWhatsAppToken("secret", key);
  assert.match(enc, /^v1:/);
  delete process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
