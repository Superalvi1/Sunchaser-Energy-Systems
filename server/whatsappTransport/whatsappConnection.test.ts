import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestActor } from "../middleware/actor.ts";
import {
  computeTokenHealth,
  computeWebhookHealth,
  disconnectWhatsApp,
  deregisterSubscribedApps,
  generateEmbeddedSignupState,
  getWhatsAppConnectionStatus,
  maskId,
  maskPhone,
  processEmbeddedSignupOnboarding,
  recordWebhookPing,
  registerSubscribedApps,
  resetConnectionStoreForTests,
  verifyWabaOwnership,
  verifyPhoneNumberIdOwnership,
} from "./whatsappConnectionService.ts";
import { InMemoryWhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import { WhatsAppInboxMemoryStore } from "./whatsappInboxRepoSupport.ts";
import type { OAuthStateStore } from "./whatsappOAuthStateStore.ts";
import { makeMemoryOAuthStateStore } from "./whatsappOAuthStateStore.ts";

const adminActor: RequestActor = {
  id: "u-admin-1",
  username: "admin",
  name: "Admin",
  email: "admin@sunchaser.pk",
  role: "Super Admin",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const salesActor: RequestActor = {
  id: "u-sales-1",
  username: "sales",
  name: "Sales",
  email: "sales@sunchaser.pk",
  role: "Sales Representative",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const TEST_COMPANY = "sunchaser";
const TEST_WABA_ID = "123456789098765";
const TEST_PHONE_NUMBER_ID = "987654321012345";

function makeTestStateStore(): OAuthStateStore {
  return makeMemoryOAuthStateStore();
}

/** A minimal exchange port that returns fixed credentials for tests. */
function makeTestExchangePort(overrides?: {
  accessToken?: string;
  wabaId?: string;
  phoneNumberId?: string;
}) {
  return async (input: { code: string; wabaId: string; phoneNumberId: string }) => ({
    accessToken: overrides?.accessToken ?? "EAAG_test_token",
    wabaId: input.wabaId || overrides?.wabaId || TEST_WABA_ID,
    phoneNumberId: input.phoneNumberId || overrides?.phoneNumberId || TEST_PHONE_NUMBER_ID,
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

await test("disconnected state when no credentials present", async () => {
  await resetConnectionStoreForTests({
    wabaId: null,
    phoneNumberId: null,
    phoneNumber: null,
    accessToken: null,
    stateOverride: null,
  });

  const status = await getWhatsAppConnectionStatus();
  assert.equal(status.status, "NOT_CONNECTED");
  assert.equal(status.connectionMode, "COEXISTENCE");
  assert.equal(status.wabaIdMasked, null);
  assert.equal(status.phoneNumberIdMasked, null);
  assert.equal(status.phoneNumberMasked, null);
});

await test("env credentials alone do not produce CONNECTED without persisted record", async () => {
  const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const origWaba = process.env.WHATSAPP_WABA_ID;
  process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_env_only_token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = TEST_PHONE_NUMBER_ID;
  process.env.WHATSAPP_WABA_ID = TEST_WABA_ID;

  try {
    await resetConnectionStoreForTests();
    const status = await getWhatsAppConnectionStatus();
    assert.equal(status.status, "NOT_CONNECTED");
    assert.equal(status.wabaIdMasked, null);
    assert.equal(status.phoneNumberIdMasked, null);
  } finally {
    if (origToken !== undefined) process.env.WHATSAPP_ACCESS_TOKEN = origToken;
    else delete process.env.WHATSAPP_ACCESS_TOKEN;
    if (origPhoneId !== undefined) process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
    else delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (origWaba !== undefined) process.env.WHATSAPP_WABA_ID = origWaba;
    else delete process.env.WHATSAPP_WABA_ID;
  }
});

await test("successful Coexistence Embedded Signup onboarding", async () => {
  await resetConnectionStoreForTests({
    wabaId: null,
    phoneNumberId: null,
    phoneNumber: null,
    accessToken: null,
    stateOverride: null,
  });

  const stateStore = makeTestStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  const status = await processEmbeddedSignupOnboarding(
    {
      code: "valid_meta_embedded_code_123",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
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

await test("subscribed_apps registration uses wabaId in Graph URL", async () => {
  const seenUrls: string[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    seenUrls.push(String(input));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  await registerSubscribedApps("token", TEST_WABA_ID, "v21.0", mockFetch);
  assert.equal(seenUrls.length, 1);
  assert.match(
    seenUrls[0],
    new RegExp(`/v21\\.0/${TEST_WABA_ID}/subscribed_apps$`)
  );
  assert.doesNotMatch(seenUrls[0], new RegExp(TEST_PHONE_NUMBER_ID));
});

await test("subscribed_apps deregistration uses wabaId in Graph URL", async () => {
  const seenUrls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    seenUrls.push(String(input));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  await deregisterSubscribedApps("token", TEST_WABA_ID, "v21.0", mockFetch);
  assert.equal(seenUrls.length, 1);
  assert.match(
    seenUrls[0],
    new RegExp(`/v21\\.0/${TEST_WABA_ID}/subscribed_apps$`)
  );
});

await test("CSRF: missing state parameter throws invalid_argument", async () => {
  await resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state: "",
          wabaId: TEST_WABA_ID,
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("CSRF: invalid/unknown state nonce throws invalid_argument", async () => {
  await resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state: "not-a-real-nonce",
          wabaId: TEST_WABA_ID,
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("CSRF: replay — consuming same state nonce twice throws invalid_argument", async () => {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeTestStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  await processEmbeddedSignupOnboarding(
    {
      code: "code-1",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
  );

  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "code-2",
          state,
          wabaId: TEST_WABA_ID,
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("CSRF: tenant mismatch rejects onboarding", async () => {
  await resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();
  const state = await stateStore.create("other-company", adminActor.id);

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state,
          wabaId: TEST_WABA_ID,
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) =>
      err.code === "invalid_argument" &&
      /company mismatch/i.test(err.message)
  );
});

await test("CSRF: expired state nonce rejects onboarding", async () => {
  await resetConnectionStoreForTests();
  const entries = new Map<
    string,
    { companyId: string; actorId: string; expiresAt: number; used: boolean }
  >();
  const stateStore: OAuthStateStore = {
    async create(companyId, actorId) {
      const nonce = "expired-nonce";
      entries.set(nonce, {
        companyId,
        actorId,
        expiresAt: Date.now() - 1000,
        used: false,
      });
      return nonce;
    },
    async consume(nonce, companyId, actorId) {
      const e = entries.get(nonce);
      if (!e) return { ok: false, reason: "not found" };
      if (e.used) return { ok: false, reason: "already used" };
      if (e.expiresAt < Date.now()) return { ok: false, reason: "State nonce expired" };
      if (e.companyId !== companyId) return { ok: false, reason: "company mismatch" };
      if (actorId != null && e.actorId !== actorId) {
        return { ok: false, reason: "actor mismatch" };
      }
      e.used = true;
      return { ok: true };
    },
    async clear() {
      entries.clear();
    },
  };
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state,
          wabaId: TEST_WABA_ID,
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) =>
      err.code === "invalid_argument" && /expired/i.test(err.message)
  );
});

await test("missing code throws invalid_argument", async () => {
  await resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "   ",
          state,
          wabaId: TEST_WABA_ID,
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("missing wabaId throws invalid_argument", async () => {
  await resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state,
          wabaId: "",
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          companyId: TEST_COMPANY,
          actor: adminActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("non-admin actor onboarding is forbidden", async () => {
  await resetConnectionStoreForTests();
  const stateStore = makeTestStateStore();
  const state = await stateStore.create(TEST_COMPANY, salesActor.id);

  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding(
        {
          code: "valid_code",
          state,
          wabaId: TEST_WABA_ID,
          phoneNumberId: TEST_PHONE_NUMBER_ID,
          companyId: TEST_COMPANY,
          actor: salesActor,
        },
        { stateStore, exchangePort: makeTestExchangePort(), skipOwnershipVerification: true }
      ),
    (err: any) => err.code === "forbidden"
  );
});

await test("non-admin disconnect is forbidden", async () => {
  await resetConnectionStoreForTests();
  await assert.rejects(
    () => disconnectWhatsApp(salesActor, { skipRevoke: true }),
    (err: any) => err.code === "forbidden"
  );
});

await test("disconnect clears credentials and returns NOT_CONNECTED", async () => {
  await resetConnectionStoreForTests({
    accessToken: "EAAG_test",
    phoneNumberId: TEST_PHONE_NUMBER_ID,
    wabaId: TEST_WABA_ID,
  });

  const status = await disconnectWhatsApp(adminActor, { skipRevoke: true });
  assert.equal(status.status, "NOT_CONNECTED");
  assert.equal(status.wabaIdMasked, null);
  assert.equal(status.phoneNumberIdMasked, null);
});

await test("disconnect returns revokeWarning when Meta revoke fails but still clears local", async () => {
  await resetConnectionStoreForTests({
    accessToken: "EAAG_test",
    phoneNumberId: TEST_PHONE_NUMBER_ID,
    wabaId: TEST_WABA_ID,
  });

  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), {
      status: 400,
    });

  const status = await disconnectWhatsApp(adminActor, { fetchImpl: mockFetch });
  assert.equal(status.status, "NOT_CONNECTED");
  assert.equal(status.wabaIdMasked, null);
  assert.ok(status.revokeWarning);
  assert.match(status.revokeWarning!, /deregistration failed/i);
  assert.doesNotMatch(status.revokeWarning!, /EAAG_test/);
});

await test("secret redaction: access token is never leaked in status payload", async () => {
  await resetConnectionStoreForTests({
    accessToken: "EAAG_secret_token_never_expose",
    phoneNumberId: TEST_PHONE_NUMBER_ID,
    wabaId: TEST_WABA_ID,
  });

  const status = await getWhatsAppConnectionStatus();
  assert.equal("accessToken" in status, false);
  assert.equal(JSON.stringify(status).includes("EAAG_secret_token"), false);
});

await test("webhook health and timestamp recording", async () => {
  await resetConnectionStoreForTests({
    accessToken: "EAAG_test",
    phoneNumberId: TEST_PHONE_NUMBER_ID,
    wabaId: TEST_WABA_ID,
  });
  const now = new Date().toISOString();
  await recordWebhookPing(now);

  const status = await getWhatsAppConnectionStatus();
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
    new Response(JSON.stringify({ id: "999999" }), { status: 200 });

  await assert.rejects(
    () => verifyWabaOwnership("token", TEST_WABA_ID, "v21.0", mockFetch),
    (err: any) => err.code === "forbidden"
  );
});

await test("WABA ownership verification uses GET /{wabaId} not /me/businesses", async () => {
  let requestedUrl = "";
  const mockFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };

  await verifyWabaOwnership("token", TEST_WABA_ID, "v21.0", mockFetch);
  assert.match(requestedUrl, new RegExp(`/${TEST_WABA_ID}\\?fields=id`));
  assert.doesNotMatch(requestedUrl, /me\/businesses/);
});

await test("WABA ownership verification passes when token can access WABA", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });

  await verifyWabaOwnership("token", TEST_WABA_ID, "v21.0", mockFetch);
});

await test("WABA ownership verification rejects Graph API access denial", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ error: { message: "Unsupported get request", code: 100 } }),
      { status: 400 }
    );

  await assert.rejects(
    () => verifyWabaOwnership("token", TEST_WABA_ID, "v21.0", mockFetch),
    (err: any) => err.code === "service_unavailable" || err.code === "forbidden"
  );
});

await test("Phone Number ID ownership verification rejects mismatched ID", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: "000000000000000" }] }), { status: 200 });

  await assert.rejects(
    () =>
      verifyPhoneNumberIdOwnership(
        "token",
        TEST_WABA_ID,
        TEST_PHONE_NUMBER_ID,
        "v21.0",
        mockFetch
      ),
    (err: any) => err.code === "forbidden"
  );
});

await test("no mock fallback: missing app credentials throws service_unavailable", async () => {
  const origId = process.env.WHATSAPP_APP_ID;
  const origSecret = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_ID;
  delete process.env.WHATSAPP_APP_SECRET;

  await resetConnectionStoreForTests({ wabaId: null, phoneNumberId: null, accessToken: null });
  const stateStore = makeTestStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  try {
    await assert.rejects(
      () =>
        processEmbeddedSignupOnboarding(
          {
            code: "code",
            state,
            wabaId: TEST_WABA_ID,
            phoneNumberId: TEST_PHONE_NUMBER_ID,
            companyId: TEST_COMPANY,
            actor: adminActor,
          },
          { stateStore }
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

await test("generateEmbeddedSignupState returns a non-empty nonce", async () => {
  const stateStore = makeTestStateStore();
  const nonce = await generateEmbeddedSignupState(TEST_COMPANY, adminActor.id, stateStore);
  assert.ok(nonce && nonce.length > 0, "nonce should be non-empty");
});

await test("human takeover sets aiOwnershipState to HUMAN_HANDLING and halts AI replies", async () => {
  const store = new WhatsAppInboxMemoryStore();
  const repo = new InMemoryWhatsAppInboxConversationRepository(store);
  const companyId = "00000000-0000-0000-0000-000000000001";

  store.conversations.set("c_1", {
    id: "c_1",
    companyId,
    contactId: "wct_1",
    channelId: "default",
    status: "open",
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    aiOwnershipState: "AI_SHADOW",
    lockVersion: 1,
    lastMessageAt: new Date().toISOString(),
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
