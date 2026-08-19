/**
 * Tests for server-side Meta Business Portfolio discovery (business_management).
 *
 * A. Successful discovery (single portfolio)
 * B. Permission / Graph failure — does NOT fail onboarding
 * C. Multiple portfolios → unresolved, no selection made
 * D. Security: no access token/code in HTTP response, no raw provider payload
 * E. Authorization: diagnostics remain admin-only (tested via whatsappInboxRoutes.test.ts)
 * F. Regression: existing WABA/phone/subscribed_apps behavior unchanged
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestActor } from "../middleware/actor.ts";
import {
  discoverBusinessPortfolio,
  getWhatsAppConnectionRepository,
  processEmbeddedSignupOnboarding,
  resetConnectionStoreForTests,
} from "./whatsappConnectionService.ts";
import { makeMemoryOAuthStateStore } from "./whatsappOAuthStateStore.ts";

const TEST_COMPANY = "sunchaser";
const TEST_WABA_ID = "123456789098765";
const TEST_PHONE_NUMBER_ID = "987654321012345";

const adminActor: RequestActor = {
  id: "u-admin-biz",
  username: "admin",
  name: "Admin",
  email: "admin@sunchaser.pk",
  role: "Super Admin",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

function makeTestExchangePort(token = "EAAG_test_token") {
  return async (input: { code: string; wabaId: string; phoneNumberId: string }) => ({
    accessToken: token,
    wabaId: input.wabaId || TEST_WABA_ID,
    phoneNumberId: input.phoneNumberId || TEST_PHONE_NUMBER_ID,
    phoneNumber: "923007776655",
  });
}

// ─── A. Successful business discovery ────────────────────────────────────────

await test("A1: discoverBusinessPortfolio returns success with single portfolio", async () => {
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    assert.ok(url.includes("/me/businesses"), "must call /me/businesses endpoint");
    assert.ok(url.includes("fields=id,name"), "must request id and name fields");
    return new Response(
      JSON.stringify({ data: [{ id: "1001001001", name: "Sunchaser Energy Pvt Ltd" }] }),
      { status: 200 }
    );
  };
  const result = await discoverBusinessPortfolio("token", "v21.0", mockFetch);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.portfolioId, "1001001001");
    assert.equal(result.portfolioName, "Sunchaser Energy Pvt Ltd");
  }
});

await test("A2: full onboarding persists business portfolio on success", async () => {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeMemoryOAuthStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/me/businesses")) {
      return new Response(
        JSON.stringify({ data: [{ id: "1001001001", name: "Sunchaser Energy" }] }),
        { status: 200 }
      );
    }
    // WABA + phone ownership checks
    if (url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };

  const status = await processEmbeddedSignupOnboarding(
    {
      code: "code-biz-a",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    {
      exchangePort: makeTestExchangePort(),
      stateStore,
      fetchImpl: mockFetch,
    }
  );
  // Onboarding must succeed regardless of business discovery.
  assert.equal(status.status, "WEBHOOK_PENDING");
  assert.equal(status.connectionMode, "COEXISTENCE");

  const stored = await getWhatsAppConnectionRepository().get(TEST_COMPANY);
  assert.equal(stored?.businessDiscoveryStatus, "success");
  assert.equal(stored?.businessPortfolioId, "1001001001");
  assert.equal(stored?.businessPortfolioName, "Sunchaser Energy");
  assert.equal(stored?.wabaId, TEST_WABA_ID);
});

await test("A3: discoverBusinessPortfolio extracts only id and name, drops extra fields", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "2002",
            name: "My Business",
            access_token: "EAAG_should_not_be_captured",
            extra_field: "ignored",
          },
        ],
      }),
      { status: 200 }
    );
  const result = await discoverBusinessPortfolio("token", "v21.0", mockFetch);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.portfolioId, "2002");
    assert.equal(result.portfolioName, "My Business");
    // No extra fields on the result shape
    assert.equal(Object.keys(result).length, 3); // status + portfolioId + portfolioName
  }
});

// ─── B. Permission / Graph failure — does NOT fail onboarding ────────────────

await test("B1: discoverBusinessPortfolio returns failed status on Graph 403", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ error: { message: "Permission denied", code: 200, type: "OAuthException" } }),
      { status: 403 }
    );
  const result = await discoverBusinessPortfolio("token", "v21.0", mockFetch);
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    // Sanitized reason must not contain raw token or URL secrets
    assert.ok(!result.sanitizedReason.includes("EAAG"), "must not leak token");
    assert.ok(typeof result.sanitizedReason === "string");
  }
});

await test("B2: graph permission failure does NOT fail full onboarding", async () => {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeMemoryOAuthStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/me/businesses")) {
      return new Response(
        JSON.stringify({ error: { message: "Permission denied", code: 200 } }),
        { status: 403 }
      );
    }
    if (url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };

  // Must NOT throw despite the /me/businesses 403
  const status = await processEmbeddedSignupOnboarding(
    {
      code: "code-biz-b",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    {
      exchangePort: makeTestExchangePort(),
      stateStore,
      fetchImpl: mockFetch,
    }
  );
  assert.equal(status.status, "WEBHOOK_PENDING");

  const stored = await getWhatsAppConnectionRepository().get(TEST_COMPANY);
  assert.equal(stored?.businessDiscoveryStatus, "failed");
  assert.equal(stored?.businessPortfolioId, null);
  assert.equal(stored?.businessPortfolioName, null);
  assert.equal(stored?.wabaId, TEST_WABA_ID);
});

await test("B3: failed discovery produces sanitized diagnostic (no raw Graph payload)", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Invalid OAuth access token. Bearer EAAG_secret access_token=abc123",
          code: 190,
        },
      }),
      { status: 403 }
    );
  const result = await discoverBusinessPortfolio("token", "v21.0", mockFetch);
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.ok(!result.sanitizedReason.includes("EAAG_secret"), "raw token must be redacted");
    assert.ok(!result.sanitizedReason.includes("access_token=abc123"), "access_token query must be redacted");
    assert.ok(!result.sanitizedReason.includes("{"), "raw JSON payload must not be forwarded");
  }
});

// ─── C. Multiple portfolios → unresolved, no arbitrary selection ──────────────

await test("C1: discoverBusinessPortfolio returns unresolved when multiple portfolios exist", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "1001", name: "Business A" },
          { id: "1002", name: "Business B" },
        ],
      }),
      { status: 200 }
    );
  const result = await discoverBusinessPortfolio("token", "v21.0", mockFetch);
  assert.equal(result.status, "unresolved");
  if (result.status === "unresolved") {
    assert.equal(result.portfolioCount, 2);
  }
  // Ensure portfolioId and portfolioName are NOT present on unresolved result
  const keys = Object.keys(result);
  assert.ok(!keys.includes("portfolioId"), "portfolioId must not be set when unresolved");
  assert.ok(!keys.includes("portfolioName"), "portfolioName must not be set when unresolved");
});

await test("C2: unresolved discovery does NOT fail onboarding", async () => {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeMemoryOAuthStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/me/businesses")) {
      return new Response(
        JSON.stringify({ data: [{ id: "1001", name: "A" }, { id: "1002", name: "B" }] }),
        { status: 200 }
      );
    }
    if (url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };

  const status = await processEmbeddedSignupOnboarding(
    {
      code: "code-biz-c",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    {
      exchangePort: makeTestExchangePort(),
      stateStore,
      fetchImpl: mockFetch,
    }
  );
  assert.equal(status.status, "WEBHOOK_PENDING");

  const stored = await getWhatsAppConnectionRepository().get(TEST_COMPANY);
  assert.equal(stored?.businessDiscoveryStatus, "unresolved");
  assert.equal(stored?.businessPortfolioId, null, "must not pick the first portfolio");
  assert.equal(stored?.businessPortfolioName, null);
});

// ─── D. Security ─────────────────────────────────────────────────────────────

await test("D1: onboarding HTTP response never contains access token", async () => {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeMemoryOAuthStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/me/businesses")) {
      return new Response(JSON.stringify({ data: [{ id: "1001", name: "A" }] }), { status: 200 });
    }
    if (url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };

  const SECRET_TOKEN = "EAAG_THIS_MUST_NOT_APPEAR";

  const result = await processEmbeddedSignupOnboarding(
    {
      code: "code-d1",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    {
      exchangePort: makeTestExchangePort(SECRET_TOKEN),
      stateStore,
      fetchImpl: mockFetch,
    }
  );

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SECRET_TOKEN), "access token must not appear in status payload");
  assert.ok(!serialized.includes("EAAG"), "any token-shaped string must not appear in payload");
  assert.ok(!serialized.includes("code-d1"), "authorization code must not appear in payload");
});

await test("D2: diagnostics payload never includes raw Graph response fields", async () => {
  // The businessDiagnostics section must only expose masked IDs, discovery status,
  // portfolio name and association status — not raw Graph response bodies.
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "9001",
            name: "Safe Name",
            access_token: "EAAG_raw_token_must_not_appear",
            verification_status: "verified",
            is_hidden: false,
            raw_payload: { secret: "must-not-appear" },
          },
        ],
      }),
      { status: 200 }
    );
  const result = await discoverBusinessPortfolio("token", "v21.0", mockFetch);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("EAAG_raw_token_must_not_appear"), "raw token must not be captured");
    assert.ok(!serialized.includes("verification_status"), "extra field must be dropped");
    assert.ok(!serialized.includes("raw_payload"), "raw payload must not be captured");
    assert.ok(!serialized.includes("must-not-appear"), "nested secret must not appear");
  }
});

// ─── F. Regression ────────────────────────────────────────────────────────────

await test("F1: WABA ownership verification is still called when business discovery is present", async () => {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeMemoryOAuthStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  const seenUrls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    seenUrls.push(url);
    if (url.includes("/me/businesses")) {
      return new Response(JSON.stringify({ data: [{ id: "1001", name: "A" }] }), { status: 200 });
    }
    if (url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    if (url.includes("/subscribed_apps")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    // WABA GET
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };

  await processEmbeddedSignupOnboarding(
    {
      code: "code-f1",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    {
      exchangePort: makeTestExchangePort(),
      stateStore,
      fetchImpl: mockFetch,
    }
  );

  // WABA ownership verification must still be called
  const wabaOwnershipUrl = seenUrls.find(
    (u) => u.includes(TEST_WABA_ID) && u.includes("fields=id") && !u.includes("phone_numbers")
  );
  assert.ok(wabaOwnershipUrl, "WABA ownership verification GET must be called");

  // Phone number ownership must still be called
  const phoneUrl = seenUrls.find((u) => u.includes("/phone_numbers"));
  assert.ok(phoneUrl, "Phone Number ID ownership verification must be called");

  // subscribed_apps must still be registered
  const subUrl = seenUrls.find((u) => u.includes("/subscribed_apps"));
  assert.ok(subUrl, "subscribed_apps registration must be called");

  // /me/businesses must also be called
  const bizUrl = seenUrls.find((u) => u.includes("/me/businesses"));
  assert.ok(bizUrl, "/me/businesses business discovery must be called");
});

await test("F2: skipBusinessDiscovery skips only business call, existing verifications unchanged", async () => {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeMemoryOAuthStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  const seenUrls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    seenUrls.push(url);
    if (url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    if (url.includes("/subscribed_apps")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };

  const status = await processEmbeddedSignupOnboarding(
    {
      code: "code-f2",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    {
      exchangePort: makeTestExchangePort(),
      stateStore,
      fetchImpl: mockFetch,
      skipBusinessDiscovery: true,
    }
  );
  assert.equal(status.status, "WEBHOOK_PENDING");
  // Must NOT have called /me/businesses
  const bizUrl = seenUrls.find((u) => u.includes("/me/businesses"));
  assert.equal(bizUrl, undefined, "/me/businesses must not be called when skipBusinessDiscovery=true");
});

await test("F3: network error in business discovery does not affect onboarding", async () => {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeMemoryOAuthStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/me/businesses")) {
      throw new Error("Network unreachable");
    }
    if (url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    if (url.includes("/subscribed_apps")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };

  const status = await processEmbeddedSignupOnboarding(
    {
      code: "code-f3",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
    },
    {
      exchangePort: makeTestExchangePort(),
      stateStore,
      fetchImpl: mockFetch,
    }
  );
  assert.equal(status.status, "WEBHOOK_PENDING", "onboarding succeeds despite network error in business discovery");
});
