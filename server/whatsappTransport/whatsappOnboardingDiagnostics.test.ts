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
    assert.equal(diag.webhookVerifyToken, "verify-token-for-meta");
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

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
