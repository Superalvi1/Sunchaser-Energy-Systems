import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestActor } from "../middleware/actor.ts";
import {
  computeTokenHealth,
  computeWebhookHealth,
  disconnectWhatsApp,
  generateEmbeddedSignupState,
  getWhatsAppConnectionStatus,
  maskId,
  maskPhone,
  processEmbeddedSignupOnboarding,
  recordWebhookPing,
  resetConnectionStoreForTests,
  verifyWabaOwnership,
  verifyPhoneNumberIdOwnership,
} from "./whatsappConnectionService.ts";
import { InMemoryWhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import { WhatsAppInboxMemoryStore } from "./whatsappInboxRepoSupport.ts";
import type { OAuthStateStore } from "./whatsappOAuthStateStore.ts";
import { memoryOAuthStateStore } from "./whatsappOAuthStateStore.ts";

const adminActor: RequestActor = {
  id: "u-admin-1",
  email: "admin@sunchaser.pk",
  role: "Super Admin",
  status: "Approved",
  allowedModules: ["crm_leads"],
};

const salesActor: RequestActor = {
  id: "u-sales-1",
  email: "sales@sunchaser.pk",
  role: "Sales Representative",
  status: "Approved",
  allowedModules: ["crm_leads"],
};

const TEST_COMPANY = "sunchaser";

/** Create a test-only state store to avoid polluting the singleton. */
function makeTestStateStore(): OAuthStateStore {
  const entries = new Map<string, { companyId: string; expiresAt: number; used: boolean }>();
  return {
    create(companyId: string): string {
      const nonce = `test-nonce-${Date.now()}-${Math.random()}`;
      entries.set(nonce, { companyId, expiresAt: Date.now() + 900_000, used: false });
      return nonce;
    },
    consume(nonce: string, companyId: string) {
      const e = entries.get(nonce);
      if (!e) return { ok: false, reason: "not found" };
      if (e.used) return { ok: false, reason: "already used" };
      if (e.expiresAt < Date.now()) return { ok: false, reason: "expired" };
      if (e.companyId !== companyId) return { ok: false, reason: "company mismatch" };
      e.used = true;
      return { ok: true };
    },
    clear() {
      entries.clear();
    },
  };
}

/** A minimal exchange port that returns fixed credentials for tests. */
function makeTestExchangePort(overrides?: {
  accessToken?: string;
  wabaId?: string;
  phoneNumberId?: string;
}) {
  return async (input: { code: string; wabaId: string; phoneNumberId: string }) => ({
    accessToken: overrides?.accessToken ?? "EAAG_test_token",
    wabaId: input.wabaId || overrides?.wabaId || "123456789098765",
    phoneNumberId: input.phoneNumberId || overrides?.phoneNumberId || "987654321012345",
    phoneNumber: "923007776655",
  });
}

await test("maskId and maskPhone redact sensitive identifiers", () => {
  assert.equal(maskId(null), null);
  assert.equal(maskId(""), null);
  assert.equal(maskId("123456789098765"), "12****8765");

  assert.equal(maskPhone(null), null);
  assert.equal(maskPhone("923007776655"), "+92 300 **** 655");
});

await test("disconnected state when no credentials present", () => {
  resetConnectionStoreForTests({
    wabaId: null,
    phoneNumberId: null,
    phoneNumber: null,
    accessToken: null,
    stateOverride: null,
  });

  const status = getWhatsAppConnectionStatus();
  assert.equal(status.status, "NOT_CONNECTED");
  assert.equal(status.connectionMode, "COEXISTENCE");
  assert.equal(status.wabaIdMasked, null);
  assert.equal(status.phoneNumberIdMasked, null);
  assert.equal(status.phoneNumberMasked, null);
});

await test("successful Coexistence Embedded Signup onboarding", async () => {
  resetConnectionStoreForTests({
    wabaId: null,
    phoneNumberId: null,
    phoneNumber: null,
    accessToken: null,
    stateOverride: null,
  });

  const stateStore = makeTestStateStore();
  const state = stateStore.create(TEST_COMPANY, adminActor.id);

  const status = await processEmbeddedSignupOnboarding(
    {
      code: "valid_meta_embedded_code_123",
      state,
      wabaId: "123456789098765",
      phoneNumberId: "987654321012345",
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    {
      exchangePort: makeTestExchangePort(),
      stateStore,
      skipOwnershipVerification: true,
    }
  );

  assert.equal(status.status, "CONNECTED");
  assert.equal(status.connectionMode, "COEXISTENCE");
  assert.equal(status.wabaIdMasked, "12****8765");
  assert.equal(status.phoneNumberIdMasked, "98****2345");
  assert.equal(status.phoneNumberMasked, "+92 300 **** 655");
  assert.equal(status.tokenHealth, "valid");
});

await test("CSRF: missing state parameter throws invalid_argument", async () => {
  resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state: "",
          wabaId: "123456789098765",
          phoneNumberId: "987654321012345",
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("CSRF: invalid/unknown state nonce throws invalid_argument", async () => {
  resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state: "not-a-real-nonce",
          wabaId: "123456789098765",
          phoneNumberId: "987654321012345",
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("CSRF: replay — consuming same state nonce twice throws invalid_argument", async () => {
  resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeTestStateStore();
  const state = stateStore.create(TEST_COMPANY, adminActor.id);

  // First use: succeeds
  await processEmbeddedSignupOnboarding(
    {
      code: "code-1",
      state,
      wabaId: "123456789098765",
      phoneNumberId: "987654321012345",
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
  );

  // Second use with same nonce: must be rejected
  resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "code-2",
          state,
          wabaId: "123456789098765",
          phoneNumberId: "987654321012345",
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("missing code throws invalid_argument", async () => {
  resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();
  const state = stateStore.create(TEST_COMPANY, adminActor.id);

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "   ",
          state,
          wabaId: "123456789098765",
          phoneNumberId: "987654321012345",
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("missing wabaId throws invalid_argument", async () => {
  resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();
  const state = stateStore.create(TEST_COMPANY, adminActor.id);

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state,
          wabaId: "",
          phoneNumberId: "987654321012345",
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("non-admin actor onboarding is forbidden", async () => {
  resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();
  const state = stateStore.create(TEST_COMPANY, salesActor.id);

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state,
          wabaId: "123456789098765",
          phoneNumberId: "987654321012345",
          companyId: TEST_COMPANY,
          actor: salesActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "forbidden"
  );
});

await test("non-admin disconnect is forbidden", async () => {
  resetConnectionStoreForTests();
  await assert.rejects(
    () => disconnectWhatsApp(salesActor, { skipRevoke: true }),
    (err: any) => err.code === "forbidden"
  );
});

await test("disconnect clears credentials and returns NOT_CONNECTED", async () => {
  resetConnectionStoreForTests({
    accessToken: "EAAG_test",
    phoneNumberId: "987654321012345",
    wabaId: "123456789098765",
  });

  const status = await disconnectWhatsApp(adminActor, { skipRevoke: true });
  assert.equal(status.status, "NOT_CONNECTED");
  assert.equal(status.wabaIdMasked, null);
  assert.equal(status.phoneNumberIdMasked, null);
});

await test("secret redaction: access token is never leaked in status payload", () => {
  resetConnectionStoreForTests({
    accessToken: "EAAG_secret_token_never_expose",
    phoneNumberId: "987654321012345",
    wabaId: "123456789098765",
  });

  const status = getWhatsAppConnectionStatus();
  assert.equal("accessToken" in status, false);
  assert.equal(JSON.stringify(status).includes("EAAG_secret_token"), false);
});

await test("webhook health and timestamp recording", () => {
  resetConnectionStoreForTests();
  const now = new Date().toISOString();
  recordWebhookPing(now);

  const status = getWhatsAppConnectionStatus();
  assert.equal(status.lastWebhookAt, now);
  assert.equal(status.webhookHealth, "healthy");

  assert.equal(computeWebhookHealth(null), "unknown");
  assert.equal(
    computeWebhookHealth(new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString()),
    "degraded"
  );
  assert.equal(
    computeWebhookHealth(new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString()),
    "failing"
  );
});

await test("token health evaluation", () => {
  assert.equal(computeTokenHealth(null, null, null), "reauth_required");
  assert.equal(computeTokenHealth("valid_token", null, null), "valid");
  assert.equal(
    computeTokenHealth("valid_token", Date.now() - 1000, null),
    "expired"
  );
  assert.equal(
    computeTokenHealth("valid_token", Date.now() + 1000 * 60 * 60 * 24 * 2, null),
    "expiring_soon"
  );
});

await test("WABA ownership verification rejects mismatched WABA", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "999999" }] }), { status: 200 });

  await assert.rejects(
    () => verifyWabaOwnership("token", "123456789098765", "v21.0", mockFetch),
    (err: any) => err.code === "forbidden"
  );
});

await test("WABA ownership verification passes on matching WABA", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "123456789098765" }] }), { status: 200 });

  // Should not throw
  await verifyWabaOwnership("token", "123456789098765", "v21.0", mockFetch);
});

await test("Phone Number ID ownership verification rejects mismatched ID", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "000000000000000" }] }), { status: 200 });

  await assert.rejects(
    () =>
      verifyPhoneNumberIdOwnership(
        "token",
        "123456789098765",
        "987654321012345",
        "v21.0",
        mockFetch
      ),
    (err: any) => err.code === "forbidden"
  );
});

await test("no mock fallback: missing app credentials throws service_unavailable", async () => {
  // Temporarily clear env
  const origId = process.env.WHATSAPP_APP_ID;
  const origSecret = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_ID;
  delete process.env.WHATSAPP_APP_SECRET;

  resetConnectionStoreForTests({ wabaId: null, phoneNumberId: null, accessToken: null });
  const stateStore = makeTestStateStore();
  const state = stateStore.create(TEST_COMPANY, adminActor.id);

  try {
    await assert.rejects(
      () =>
        processEmbeddedSignupOnboarding(
          {
            code: "code",
            state,
            wabaId: "123456789098765",
            phoneNumberId: "987654321012345",
            companyId: TEST_COMPANY,
            actor: adminActor,
          },
          { stateStore } // No exchangePort → uses real default which requires app credentials
        ),
      (err: any) =>
        err.code === "service_unavailable" &&
        /WHATSAPP_APP_ID.*WHATSAPP_APP_SECRET/i.test(err.message)
    );
  } finally {
    if (origId !== undefined) process.env.WHATSAPP_APP_ID = origId;
    if (origSecret !== undefined) process.env.WHATSAPP_APP_SECRET = origSecret;
  }
});

await test("generateEmbeddedSignupState returns a non-empty nonce", () => {
  const stateStore = makeTestStateStore();
  const nonce = generateEmbeddedSignupState(TEST_COMPANY, adminActor.id, stateStore);
  assert.ok(nonce && nonce.length > 0, "nonce should be non-empty");
});

await test("human takeover sets aiOwnershipState to HUMAN_HANDLING and halts AI replies", async () => {
  const store = new WhatsAppInboxMemoryStore();
  const repo = new InMemoryWhatsAppInboxConversationRepository(store);
  const companyId = "00000000-0000-0000-0000-000000000001";

  store.conversations.set("c_1", {
    id: "c_1",
    companyId,
    customerPhone: "923007776655",
    customerName: "Customer",
    channelId: "default",
    status: "UNASSIGNED",
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    aiOwnershipState: "AI_SHADOW",
    lockVersion: 1,
    lastMessageAt: new Date().toISOString(),
    lastMessagePreview: "Hello",
    lastMessageDirection: "inbound",
    hasFailedMessage: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await repo.applyAssignmentChangeAtomic({
    conversationId: "c_1",
    expectedLockVersion: 1,
    assignedUserId: "u-sales-1",
    assignedAt: new Date().toISOString(),
    assignedBy: "u-admin-1",
    companyId,
  });

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.row.assignedUserId, "u-sales-1");
    assert.equal(res.row.aiOwnershipState, "HUMAN_HANDLING");
  }
});
