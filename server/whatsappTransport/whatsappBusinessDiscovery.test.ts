/**
 * Server-side Meta Business Portfolio discovery.
 * Primary Graph path: GET /{wabaId}?fields=id,name,owner_business_info
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
import { getWhatsAppOnboardingDiagnostics } from "./whatsappOnboardingDiagnostics.ts";
import { makeMemoryOAuthStateStore } from "./whatsappOAuthStateStore.ts";

const TEST_COMPANY = "sunchaser";
const TEST_WABA_ID = "123456789098765";
const TEST_PHONE_NUMBER_ID = "987654321012345";
const PORTFOLIO_ID = "27296349086005";
const PORTFOLIO_NAME = "Sunchaser Energy pvt.Ltd";

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

function graphFetch(handlers: {
  waba?: Record<string, unknown> | { status: number; body: Record<string, unknown> };
  business?: Record<string, unknown> | { status: number; body: Record<string, unknown> };
  meBusinesses?: Record<string, unknown> | { status: number; body: Record<string, unknown> };
  owned?: Record<string, unknown>;
  extra?: (url: string) => Response | null;
}): typeof fetch {
  const wrap = (value: Record<string, unknown> | { status: number; body: Record<string, unknown> } | undefined, fallback: Record<string, unknown>) => {
    if (!value) return { status: 200, body: fallback };
    if ("status" in value && "body" in value && typeof value.status === "number") {
      return { status: value.status, body: value.body };
    }
    return { status: 200, body: value as Record<string, unknown> };
  };
  return async (input) => {
    const url = String(input);
    if (handlers.extra) {
      const extra = handlers.extra(url);
      if (extra) return extra;
    }
    if (url.includes("/me/businesses")) {
      const res = wrap(handlers.meBusinesses, { data: [] });
      return new Response(JSON.stringify(res.body), { status: res.status });
    }
    if (url.includes("owned_whatsapp_business_accounts")) {
      return new Response(JSON.stringify(handlers.owned ?? { data: [] }), { status: 200 });
    }
    if (url.includes(TEST_WABA_ID) && url.includes("owner_business_info")) {
      const res = wrap(handlers.waba, { id: TEST_WABA_ID });
      return new Response(JSON.stringify(res.body), { status: res.status });
    }
    if (url.includes(TEST_WABA_ID) && url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    if (url.includes("/subscribed_apps")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes(TEST_WABA_ID) && url.includes("fields=id") && !url.includes("owner_business")) {
      return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
    }
    if (url.includes(PORTFOLIO_ID) || (handlers.business && !url.includes("/me/"))) {
      const res = wrap(handlers.business, { id: PORTFOLIO_ID, name: PORTFOLIO_NAME });
      return new Response(JSON.stringify(res.body), { status: res.status });
    }
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };
}

async function onboard(fetchImpl: typeof fetch, extra?: { claimedBusinessId?: string; token?: string }) {
  await resetConnectionStoreForTests({
    wabaId: null, phoneNumberId: null, accessToken: null, stateOverride: null,
  });
  const stateStore = makeMemoryOAuthStateStore();
  const state = await stateStore.create(TEST_COMPANY, adminActor.id);
  return processEmbeddedSignupOnboarding(
    {
      code: "code-biz",
      state,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      companyId: TEST_COMPANY,
      actor: adminActor,
      claimedBusinessId: extra?.claimedBusinessId ?? null,
    },
    {
      exchangePort: makeTestExchangePort(extra?.token),
      stateStore,
      fetchImpl,
    }
  );
}

await test("1: successful authorization + owner_business_info discovery", async () => {
  const result = await discoverBusinessPortfolio(
    { accessToken: "token", wabaId: TEST_WABA_ID, version: "v21.0" },
    graphFetch({
      waba: {
        id: TEST_WABA_ID,
        name: "Sunchaser WhatsApp",
        owner_business_info: { id: PORTFOLIO_ID, name: PORTFOLIO_NAME, extra: "drop-me" },
      },
      business: { id: PORTFOLIO_ID, name: PORTFOLIO_NAME },
    })
  );
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.portfolioId, PORTFOLIO_ID);
    assert.equal(result.portfolioName, PORTFOLIO_NAME);
    assert.equal(result.wabaName, "Sunchaser WhatsApp");
    assert.equal(result.associationStatus, "confirmed");
    assert.equal(JSON.stringify(result).includes("drop-me"), false);
  }
});

await test("1b: onboarding persists verified portfolio and still succeeds", async () => {
  const status = await onboard(
    graphFetch({
      waba: {
        id: TEST_WABA_ID,
        name: "Sunchaser WhatsApp",
        owner_business_info: { id: PORTFOLIO_ID, name: PORTFOLIO_NAME },
      },
    })
  );
  assert.equal(status.status, "WEBHOOK_PENDING");
  const stored = await getWhatsAppConnectionRepository().get(TEST_COMPANY);
  assert.equal(stored?.businessDiscoveryStatus, "success");
  assert.equal(stored?.businessPortfolioId, PORTFOLIO_ID);
  assert.equal(stored?.businessPortfolioName, PORTFOLIO_NAME);
  assert.equal(stored?.businessAssociationStatus, "confirmed");
  assert.equal(stored?.wabaName, "Sunchaser WhatsApp");
});

await test("2: authorization succeeds when business discovery fails", async () => {
  const status = await onboard(
    graphFetch({
      waba: {
        status: 403,
        body: { error: { message: "Permission denied", code: 200, type: "OAuthException" } },
      },
    })
  );
  assert.equal(status.status, "WEBHOOK_PENDING");
  const stored = await getWhatsAppConnectionRepository().get(TEST_COMPANY);
  assert.equal(stored?.businessDiscoveryStatus, "failed");
  assert.equal(stored?.businessAssociationStatus, "not_available");
  assert.ok(stored?.businessDiscoveryReason);
  assert.ok(!stored?.businessDiscoveryReason?.includes("EAAG"));
});

await test("3: association confirmed from WABA owner_business_info", async () => {
  const result = await discoverBusinessPortfolio(
    { accessToken: "token", wabaId: TEST_WABA_ID, version: "v21.0" },
    graphFetch({
      waba: {
        id: TEST_WABA_ID,
        owner_business_info: { id: PORTFOLIO_ID, name: PORTFOLIO_NAME },
      },
    })
  );
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.associationStatus, "confirmed");
  }
});

await test("4: claimed business ID mismatch is not confirmed", async () => {
  const result = await discoverBusinessPortfolio(
    {
      accessToken: "token",
      wabaId: TEST_WABA_ID,
      version: "v21.0",
      claimedBusinessId: "999999999999",
    },
    graphFetch({
      waba: {
        id: TEST_WABA_ID,
        owner_business_info: { id: PORTFOLIO_ID, name: PORTFOLIO_NAME },
      },
    })
  );
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.associationStatus, "mismatch");
    assert.equal(result.portfolioId, PORTFOLIO_ID);
  }
});

await test("5: missing token fails discovery without guessing a portfolio", async () => {
  const result = await discoverBusinessPortfolio({
    accessToken: "",
    wabaId: TEST_WABA_ID,
    version: "v21.0",
  });
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.match(result.sanitizedReason, /missing or expired/i);
  }
});

await test("5b: expired token Graph error is classified", async () => {
  const result = await discoverBusinessPortfolio(
    { accessToken: "expired", wabaId: TEST_WABA_ID, version: "v21.0" },
    graphFetch({
      waba: {
        status: 401,
        body: { error: { message: "Error validating access token: Session has expired", code: 190 } },
      },
    })
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.match(result.sanitizedReason, /missing or expired/i);
    assert.equal(result.sanitizedReason.includes("EAAG"), false);
  }
});

await test("6: insufficient permission is sanitized and does not onboard-fail", async () => {
  const result = await discoverBusinessPortfolio(
    { accessToken: "token", wabaId: TEST_WABA_ID, version: "v21.0" },
    graphFetch({
      waba: {
        status: 403,
        body: { error: { message: "(#200) Requires business_management permission", code: 200 } },
      },
    })
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(
      result.sanitizedReason,
      "Meta token is missing the business_management permission"
    );
  }
});

await test("7: diagnostics Confirmed only when associationStatus is confirmed", async () => {
  await resetConnectionStoreForTests({
    wabaId: TEST_WABA_ID,
    phoneNumberId: TEST_PHONE_NUMBER_ID,
    accessToken: "EAAG_test",
    businessPortfolioId: PORTFOLIO_ID,
    businessPortfolioName: PORTFOLIO_NAME,
    businessDiscoveryStatus: "success",
    businessAssociationStatus: "unresolved",
  });
  const diag = await getWhatsAppOnboardingDiagnostics({
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  assert.equal(diag.businessDiagnostics.associationStatus, "unresolved");
  assert.notEqual(diag.businessDiagnostics.associationStatus, "confirmed");
});

await test("8: diagnostics contain no access token, app secret, or verify token", async () => {
  await resetConnectionStoreForTests({
    wabaId: TEST_WABA_ID,
    phoneNumberId: TEST_PHONE_NUMBER_ID,
    accessToken: "EAAG_MUST_NOT_APPEAR",
    businessPortfolioId: PORTFOLIO_ID,
    businessPortfolioName: PORTFOLIO_NAME,
    businessDiscoveryStatus: "success",
    businessAssociationStatus: "confirmed",
  });
  const prevVerify = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const prevSecret = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "VERIFY_SECRET_NEVER";
  process.env.WHATSAPP_APP_SECRET = "APP_SECRET_NEVER";
  try {
    const diag = await getWhatsAppOnboardingDiagnostics({
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    const serialized = JSON.stringify(diag);
    assert.equal(serialized.includes("EAAG_MUST_NOT_APPEAR"), false);
    assert.equal(serialized.includes("VERIFY_SECRET_NEVER"), false);
    assert.equal(serialized.includes("APP_SECRET_NEVER"), false);
    assert.equal(serialized.includes('"accessToken"'), false);
    assert.equal(diag.graphApi.detail, null);
  } finally {
    if (prevVerify === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = prevVerify;
    if (prevSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = prevSecret;
  }
});

await test("9: multiple /me/businesses does not pick the first without WABA proof", async () => {
  const result = await discoverBusinessPortfolio(
    { accessToken: "token", wabaId: TEST_WABA_ID, version: "v21.0" },
    graphFetch({
      waba: { id: TEST_WABA_ID },
      meBusinesses: {
        data: [
          { id: "1001", name: "First Biz" },
          { id: PORTFOLIO_ID, name: PORTFOLIO_NAME },
        ],
      },
      owned: { data: [] },
    })
  );
  assert.equal(result.status, "unresolved");
});

await test("9b: /me/businesses match via owned WABAs confirms association", async () => {
  const result = await discoverBusinessPortfolio(
    { accessToken: "token", wabaId: TEST_WABA_ID, version: "v21.0" },
    graphFetch({
      waba: { id: TEST_WABA_ID },
      meBusinesses: {
        data: [
          { id: "1001", name: "First Biz" },
          { id: PORTFOLIO_ID, name: PORTFOLIO_NAME },
        ],
      },
      extra: (url) => {
        if (url.includes(`${PORTFOLIO_ID}/owned_whatsapp_business_accounts`)) {
          return new Response(JSON.stringify({ data: [{ id: TEST_WABA_ID }] }), { status: 200 });
        }
        if (url.includes("owned_whatsapp_business_accounts")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return null;
      },
    })
  );
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.portfolioId, PORTFOLIO_ID);
    assert.equal(result.associationStatus, "confirmed");
  }
});

await test("owner_business_info unavailable uses a distinct sanitized reason", async () => {
  const result = await discoverBusinessPortfolio(
    { accessToken: "token", wabaId: TEST_WABA_ID, version: "v21.0" },
    graphFetch({
      waba: { id: TEST_WABA_ID, name: "Sunchaser WhatsApp" },
      meBusinesses: { data: [] },
    })
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.sanitizedReason, "WABA owner_business_info was not returned by Graph");
  }
});

await test("F: existing WABA/phone/subscribed_apps calls remain", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("owner_business_info")) {
      return new Response(
        JSON.stringify({
          id: TEST_WABA_ID,
          owner_business_info: { id: PORTFOLIO_ID, name: PORTFOLIO_NAME },
        }),
        { status: 200 }
      );
    }
    if (url.includes("/phone_numbers")) {
      return new Response(JSON.stringify({ data: [{ id: TEST_PHONE_NUMBER_ID }] }), { status: 200 });
    }
    if (url.includes("/subscribed_apps")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: TEST_WABA_ID }), { status: 200 });
  };
  await onboard(fetchImpl);
  assert.ok(seen.some((u) => u.includes(TEST_WABA_ID) && u.includes("fields=id") && !u.includes("phone_numbers")));
  assert.ok(seen.some((u) => u.includes("/phone_numbers")));
  assert.ok(seen.some((u) => u.includes("/subscribed_apps")));
  assert.ok(seen.some((u) => u.includes("owner_business_info")));
});
