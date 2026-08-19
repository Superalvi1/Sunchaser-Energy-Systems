/**
 * WhatsApp onboarding diagnostics tests (Meta production readiness).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  getWhatsAppConnectionStatus,
  resetConnectionStoreForTests,
  testWhatsAppConnection,
} from "./whatsappConnectionService.ts";
import {
  buildWebhookCallbackUrl,
  getWhatsAppOnboardingDiagnostics,
} from "./whatsappOnboardingDiagnostics.ts";

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

await test("webhook callback URL uses PUBLIC_BASE_URL", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://crm.example.com";
  try {
    const { url, publicBaseUrlConfigured } = buildWebhookCallbackUrl();
    assert.equal(publicBaseUrlConfigured, true);
    assert.equal(
      url,
      "https://crm.example.com/api/whatsapp/webhook"
    );
  } finally {
    if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prev;
  }
});

await test("diagnostics checklist covers required Meta readiness items", async () => {
  await resetConnectionStoreForTests();
  const prevKey = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  const prevVerify = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const prevSecret = process.env.WHATSAPP_APP_SECRET;
  const prevApp = process.env.WHATSAPP_APP_ID;
  const prevConfig = process.env.VITE_META_CONFIG_ID;
  const prevPublic = process.env.PUBLIC_BASE_URL;

  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-token-for-meta";
  process.env.WHATSAPP_APP_SECRET = "app-secret";
  process.env.WHATSAPP_APP_ID = "app-id";
  process.env.VITE_META_CONFIG_ID = "config-id";
  process.env.PUBLIC_BASE_URL = "https://crm.example.com";

  try {
    const diag = await getWhatsAppOnboardingDiagnostics({
      fetchImpl: async () => new Response("forbidden", { status: 403 }),
    });
    const ids = diag.checklist.map((c) => c.id);
    assert.ok(ids.includes("meta_app_configured"));
    assert.ok(ids.includes("meta_config_id"));
    assert.ok(ids.includes("webhook_url"));
    assert.ok(ids.includes("verify_token_configured"));
    assert.ok(ids.includes("app_secret_configured"));
    assert.ok(ids.includes("callback_reachable"));
    assert.ok(ids.includes("encryption_key_present"));
    assert.ok(ids.includes("connected_waba"));
    assert.ok(ids.includes("connected_phone"));
    assert.ok(ids.includes("webhook_verified"));
    assert.equal(diag.webhookVerifyTokenConfigured, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(diag, "webhookVerifyToken"),
      false
    );
    const serialized = JSON.stringify(diag);
    assert.equal(serialized.includes("verify-token-for-meta"), false);
    assert.equal(serialized.includes('"webhookVerifyToken"'), false);
    assert.equal(diag.connection.status, "DISCONNECTED");
    assert.equal(
      diag.checklist.find((c) => c.id === "encryption_key_present")?.ok,
      true
    );
    assert.equal(
      diag.checklist.find((c) => c.id === "verify_token_configured")?.ok,
      true
    );
  } finally {
    if (prevKey === undefined) delete process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
    else process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = prevKey;
    if (prevVerify === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = prevVerify;
    if (prevSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = prevSecret;
    if (prevApp === undefined) delete process.env.WHATSAPP_APP_ID;
    else process.env.WHATSAPP_APP_ID = prevApp;
    if (prevConfig === undefined) delete process.env.VITE_META_CONFIG_ID;
    else process.env.VITE_META_CONFIG_ID = prevConfig;
    if (prevPublic === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prevPublic;
  }
});

await test("diagnostics never includes webhookVerifyToken key or value", async () => {
  await resetConnectionStoreForTests();
  const prevVerify = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "must-never-appear-in-diagnostics-payload";
  try {
    const diag = await getWhatsAppOnboardingDiagnostics({
      fetchImpl: async () => new Response("forbidden", { status: 403 }),
    });
    assert.equal(diag.webhookVerifyTokenConfigured, true);
    assert.equal("webhookVerifyToken" in diag, false);
    assert.equal(
      JSON.stringify(diag).includes("must-never-appear-in-diagnostics-payload"),
      false
    );
    assert.ok(typeof diag.webhookCallbackUrl === "string");
    assert.match(diag.webhookCallbackUrl, /\/api\/whatsapp\/webhook$/);
  } finally {
    if (prevVerify === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = prevVerify;
  }
});

await test("connected without webhook is WEBHOOK_PENDING; with webhook is CONNECTED", async () => {
  await resetConnectionStoreForTests({
    wabaId: "123456789098765",
    phoneNumberId: "987654321012345",
    phoneNumber: "923007776655",
    accessToken: "EAAG_test",
    lastWebhookAt: null,
  });
  let status = await getWhatsAppConnectionStatus();
  assert.equal(status.status, "WEBHOOK_PENDING");

  await resetConnectionStoreForTests({
    wabaId: "123456789098765",
    phoneNumberId: "987654321012345",
    phoneNumber: "923007776655",
    accessToken: "EAAG_test",
    lastWebhookAt: new Date().toISOString(),
  });
  status = await getWhatsAppConnectionStatus();
  assert.equal(status.status, "CONNECTED");
});

await test("test connection validates token/waba/phone via Graph", async () => {
  await resetConnectionStoreForTests({
    wabaId: "123456789098765",
    phoneNumberId: "987654321012345",
    phoneNumber: "923007776655",
    accessToken: "EAAG_test",
    lastWebhookAt: new Date().toISOString(),
  });

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/phone_numbers")) {
      return new Response(
        JSON.stringify({ data: [{ id: "987654321012345" }] }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ id: "123456789098765" }), {
      status: 200,
    });
  };

  const result = await testWhatsAppConnection(undefined, { fetchImpl: mockFetch });
  assert.equal(result.ok, true);
  assert.equal(result.tokenValid, true);
  assert.equal(result.wabaAccessOk, true);
  assert.equal(result.phoneAccessOk, true);
});

await test("businessDiagnostics is present and structurally valid", async () => {
  await resetConnectionStoreForTests();
  const diag = await getWhatsAppOnboardingDiagnostics({
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  assert.ok(
    Object.prototype.hasOwnProperty.call(diag, "businessDiagnostics"),
    "diagnostics must have businessDiagnostics property"
  );
  const bd = diag.businessDiagnostics;
  assert.ok(
    ["success", "unresolved", "failed", "not_attempted"].includes(bd.businessDiscovery),
    "businessDiscovery must be a valid status"
  );
  // Default (no connection) must be not_attempted
  assert.equal(bd.businessDiscovery, "not_attempted");
  assert.equal(bd.associationStatus, "not_available");

  // Must not include raw token fields
  const serialized = JSON.stringify(diag);
  assert.equal(serialized.includes('"accessToken"'), false);
  assert.equal(serialized.includes('"webhookVerifyToken"'), false);
});

await test("businessDiagnostics shows success when record has successful discovery", async () => {
  await resetConnectionStoreForTests({
    wabaId: "123456789098765",
    phoneNumberId: "987654321012345",
    accessToken: "EAAG_test",
    businessPortfolioId: "111222333444555",
    businessPortfolioName: "Sunchaser Energy",
    businessDiscoveryStatus: "success",
  });
  const diag = await getWhatsAppOnboardingDiagnostics({
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  const bd = diag.businessDiagnostics;
  assert.equal(bd.businessDiscovery, "success");
  assert.equal(bd.businessPortfolioName, "Sunchaser Energy");
  assert.equal(bd.associationStatus, "confirmed");
  // ID must be masked, not raw
  assert.ok(bd.businessPortfolioIdMasked != null);
  assert.ok(!bd.businessPortfolioIdMasked?.includes("111222333444555"), "raw portfolio ID must be masked");
  // Raw portfolio ID must not appear anywhere in serialized response
  const serialized = JSON.stringify(diag);
  assert.ok(!serialized.includes("111222333444555"), "raw business portfolio ID must never appear in diagnostics");
});

await test("businessDiagnostics never exposes access_token, app_secret or raw Graph fields", async () => {
  await resetConnectionStoreForTests({
    wabaId: "123456789098765",
    phoneNumberId: "987654321012345",
    accessToken: "EAAG_MUST_NOT_APPEAR_IN_DIAG",
    businessPortfolioId: "9998887776665",
    businessPortfolioName: "Test Biz",
    businessDiscoveryStatus: "success",
  });
  const prevSecret = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = "APP_SECRET_MUST_NOT_APPEAR";
  try {
    const diag = await getWhatsAppOnboardingDiagnostics({
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    const serialized = JSON.stringify(diag);
    assert.ok(!serialized.includes("EAAG_MUST_NOT_APPEAR_IN_DIAG"), "access token must not appear");
    assert.ok(!serialized.includes("APP_SECRET_MUST_NOT_APPEAR"), "app secret must not appear");
  } finally {
    if (prevSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = prevSecret;
  }
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
