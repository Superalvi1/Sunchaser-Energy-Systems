/**
 * Outbound credential resolution tests.
 * Run: npm run test:whatsapp-outbound-credentials
 *
 * Official Meta Cloud API only. The Graph client is always stubbed — no test
 * performs a real Meta request.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import type { RequestActor } from "../middleware/actor.ts";
import { readWhatsAppConfig } from "./whatsappConfig.ts";
import type { WhatsAppConnectionRecord } from "./whatsappConnectionRepository.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import { sendOutboundPlainText } from "./whatsappOutboundService.ts";
import {
  hasLegacyEnvCredentials,
  isLegacyEnvFallbackEnabled,
  resetLegacyFallbackWarningForTests,
  resolveOutboundCredentials,
  selectOutboundConnection,
  type OutboundConnectionLookup,
} from "./whatsappOutboundCredentials.ts";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "whatsapp-credentials-test-secret-min-32-chars";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const CONNECTION_PHONE_ID = "109876543210987";
const ENV_PHONE_ID = "555000111222333";
const CONNECTION_TOKEN = "connection-token-from-embedded-signup";
const ENV_TOKEN = "legacy-env-access-token";
const COMPANY_ID = "sunchaser";

function envConfig(overrides: Record<string, string> = {}) {
  return readWhatsAppConfig({
    WHATSAPP_CONVERSATIONS_ENABLED: "true",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
    WHATSAPP_APP_SECRET: "secret",
    WHATSAPP_ACCESS_TOKEN: ENV_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: ENV_PHONE_ID,
    WHATSAPP_GRAPH_API_VERSION: "v21.0",
    ...overrides,
  });
}

function connectionRecord(
  overrides: Partial<WhatsAppConnectionRecord> = {}
): WhatsAppConnectionRecord {
  return {
    companyId: COMPANY_ID,
    wabaId: "waba-1",
    phoneNumberId: CONNECTION_PHONE_ID,
    phoneNumber: "15551234567",
    accessToken: CONNECTION_TOKEN,
    tokenExpiresAt: null,
    lastWebhookAt: "2026-09-01T00:00:00.000Z",
    lastError: null,
    stateOverride: null,
    businessPortfolioId: null,
    businessPortfolioName: null,
    businessDiscoveryStatus: null,
    businessDiscoveryReason: null,
    businessAssociationStatus: null,
    wabaName: null,
    ...overrides,
  };
}

function lookupOf(
  record: WhatsAppConnectionRecord | null
): OutboundConnectionLookup {
  return { get: async () => record };
}

function actorStub(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    id: "u-staff",
    username: "staff",
    name: "Staff User",
    email: "staff@test.com",
    role: "Sales Executive",
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

async function seedConversation(
  repo: InMemoryWhatsAppRepository,
  phoneNumberId: string = CONNECTION_PHONE_ID
) {
  const channel = await repo.resolveOrCreateChannel({
    phoneNumberId,
    displayPhoneNumber: "15551234567",
  });
  const contact = await repo.resolveOrCreateContact({
    phoneE164: "923001234567",
    profileName: "Ali",
  });
  const conversation = await repo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  return { channel, contact, conversation };
}

type GraphCapture = {
  count: number;
  authorization: string | null;
  url: string | null;
};

/** Stubbed Graph client. Captures what credentials the send actually used. */
function capturingGraphFetch(
  capture: GraphCapture,
  mode: "success" | "reject" = "success"
): typeof fetch {
  return (async (input: any, init: any) => {
    capture.count += 1;
    capture.url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    capture.authorization = headers.Authorization ?? null;
    if (mode === "reject") {
      return new Response(
        JSON.stringify({
          error: { message: "Invalid recipient", code: 131000 },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.FROM_CONNECTION" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
}

// ── 1. Connected Meta account: stored token is resolved and used ────────────

await test("1. connected Meta account: stored Embedded Signup token is used for send", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    config: envConfig(),
    actor: actorStub(),
    fetchImpl: capturingGraphFetch(capture),
    connectionLookup: lookupOf(connectionRecord()),
    companyId: COMPANY_ID,
  });

  assert.equal(result.httpStatus, 201);
  assert.equal(capture.count, 1);
  assert.equal(capture.authorization, `Bearer ${CONNECTION_TOKEN}`);
  // The deprecated env token must NOT have been used.
  assert.equal(capture.authorization?.includes(ENV_TOKEN), false);
});

// ── 2. Correct phone_number_id is used ──────────────────────────────────────

await test("2. Graph URL uses the stored connection phone_number_id, not the env one", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    config: envConfig(),
    actor: actorStub(),
    fetchImpl: capturingGraphFetch(capture),
    connectionLookup: lookupOf(connectionRecord()),
    companyId: COMPANY_ID,
  });

  assert.equal(result.httpStatus, 201);
  assert.ok(capture.url?.includes(`/${CONNECTION_PHONE_ID}/messages`));
  assert.equal(capture.url?.includes(ENV_PHONE_ID), false);
});

// ── 3. Token is never returned or logged ────────────────────────────────────

await test("3. decrypted token never appears in the send result or audit trail", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  let result;
  try {
    result = await sendOutboundPlainText(conversation.id, "hello", {
      repo,
      config: envConfig(),
      actor: actorStub(),
      fetchImpl: capturingGraphFetch(capture),
      connectionLookup: lookupOf(connectionRecord()),
      companyId: COMPANY_ID,
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.equal(result.httpStatus, 201);
  const serializedResult = JSON.stringify(result);
  assert.equal(serializedResult.includes(CONNECTION_TOKEN), false);
  assert.equal(serializedResult.includes(ENV_TOKEN), false);
  for (const line of logs) {
    assert.equal(line.includes(CONNECTION_TOKEN), false, "token leaked to logs");
    assert.equal(line.includes(ENV_TOKEN), false, "env token leaked to logs");
  }
  const auditDump = JSON.stringify(
    (repo as unknown as { auditLogs?: unknown }).auditLogs ?? []
  );
  assert.equal(auditDump.includes(CONNECTION_TOKEN), false);
});

// ── 4. Missing connection fails safely (no env credentials) ─────────────────

await test("4. no connection and no env credentials fails closed with 503, no Graph call", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    config: envConfig({
      WHATSAPP_ACCESS_TOKEN: "",
      WHATSAPP_PHONE_NUMBER_ID: "",
    }),
    actor: actorStub(),
    fetchImpl: capturingGraphFetch(capture),
    connectionLookup: lookupOf(null),
    companyId: COMPANY_ID,
  });

  assert.equal(result.httpStatus, 503);
  assert.equal(capture.count, 0);
  assert.equal(repo.messages.size, 0);
});

// ── 5. Inactive connection is rejected ──────────────────────────────────────

await test("5. disconnected connection is rejected and does NOT fall back to env", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    // Env credentials ARE present and valid — they must not rescue this send.
    config: envConfig({ WHATSAPP_PHONE_NUMBER_ID: CONNECTION_PHONE_ID }),
    actor: actorStub(),
    fetchImpl: capturingGraphFetch(capture),
    connectionLookup: lookupOf(connectionRecord({ stateOverride: "DISCONNECTED" })),
    companyId: COMPANY_ID,
  });

  assert.equal(result.httpStatus, 503);
  assert.equal(capture.count, 0);
});

await test("5b. expired stored token is rejected (TOKEN_EXPIRED and past expiry)", () => {
  const expiredOverride = selectOutboundConnection([
    connectionRecord({ stateOverride: "TOKEN_EXPIRED" }),
  ]);
  assert.equal(expiredOverride.ok, false);
  if (!expiredOverride.ok) assert.equal(expiredOverride.reason, "connection_inactive");

  const expiredAt = selectOutboundConnection([
    connectionRecord({ tokenExpiresAt: "2000-01-01T00:00:00.000Z" }),
  ]);
  assert.equal(expiredAt.ok, false);
  if (!expiredAt.ok) assert.equal(expiredAt.reason, "connection_inactive");
});

await test("5c. connection missing a token or phone_number_id is incomplete", () => {
  const noToken = selectOutboundConnection([connectionRecord({ accessToken: null })]);
  assert.equal(noToken.ok, false);
  if (!noToken.ok) assert.equal(noToken.reason, "connection_incomplete");

  const badPhone = selectOutboundConnection([
    connectionRecord({ phoneNumberId: "not-a-phone-id" }),
  ]);
  assert.equal(badPhone.ok, false);
  if (!badPhone.ok) assert.equal(badPhone.reason, "connection_incomplete");
});

// ── 6. Ambiguous connections fail closed ────────────────────────────────────

await test("6. multiple equally-valid connections fail closed (never guess)", () => {
  const ambiguous = selectOutboundConnection([
    connectionRecord({ phoneNumberId: "111111111111111" }),
    connectionRecord({ phoneNumberId: "222222222222222" }),
  ]);
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.equal(ambiguous.reason, "connection_ambiguous");

  // Two records claiming the SAME sender identity are still ambiguous.
  const duplicate = selectOutboundConnection(
    [connectionRecord(), connectionRecord()],
    CONNECTION_PHONE_ID
  );
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.reason, "connection_ambiguous");
});

await test("6b. phone-scoped selection picks the connection owning that channel", () => {
  const selected = selectOutboundConnection(
    [
      connectionRecord({ phoneNumberId: "111111111111111" }),
      connectionRecord({ phoneNumberId: CONNECTION_PHONE_ID }),
    ],
    CONNECTION_PHONE_ID
  );
  assert.equal(selected.ok, true);
  if (selected.ok) assert.equal(selected.record.phoneNumberId, CONNECTION_PHONE_ID);
});

// ── 7. Wrong phone/channel match is rejected ────────────────────────────────

await test("7. conversation on phone A never sends with credentials for phone B", async () => {
  const repo = new InMemoryWhatsAppRepository();
  // Channel belongs to a DIFFERENT sender than the stored connection.
  const { conversation } = await seedConversation(repo, "999888777666555");
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    config: envConfig(),
    actor: actorStub(),
    fetchImpl: capturingGraphFetch(capture),
    connectionLookup: lookupOf(connectionRecord()),
    companyId: COMPANY_ID,
  });

  assert.equal(result.httpStatus, 503);
  assert.equal(capture.count, 0, "must not call Meta with a mismatched sender");
});

await test("7b. resolver reports a sanitized phone mismatch reason", async () => {
  const resolution = await resolveOutboundCredentials({
    config: envConfig(),
    connectionLookup: lookupOf(connectionRecord()),
    companyId: COMPANY_ID,
    expectedPhoneNumberId: "999888777666555",
    env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(resolution.ok, false);
  if (!resolution.ok) {
    assert.equal(resolution.reason, "connection_phone_mismatch");
    assert.equal(JSON.stringify(resolution).includes(CONNECTION_TOKEN), false);
  }
});

// ── 8. Meta API failure remains sanitized ───────────────────────────────────

await test("8. Meta rejection stays sanitized and leaks no credential material", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    config: envConfig(),
    actor: actorStub(),
    fetchImpl: capturingGraphFetch(capture, "reject"),
    connectionLookup: lookupOf(connectionRecord()),
    companyId: COMPANY_ID,
  });

  assert.notEqual(result.httpStatus, 201);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(CONNECTION_TOKEN), false);
  assert.equal(serialized.includes("Bearer"), false);
});

// ── 9. Provider message ID still persists ───────────────────────────────────

await test("9. provider message id is still persisted when sending via connection", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    config: envConfig(),
    actor: actorStub(),
    fetchImpl: capturingGraphFetch(capture),
    connectionLookup: lookupOf(connectionRecord()),
    companyId: COMPANY_ID,
  });

  assert.equal(result.httpStatus, 201);
  if (result.httpStatus !== 201) return;
  assert.equal(result.providerMessageId, "wamid.FROM_CONNECTION");
  const stored = repo.messages.get(result.messageId);
  assert.ok(stored, "outbound message row must exist");
  assert.equal(stored?.waMessageId, "wamid.FROM_CONNECTION");
  assert.equal(stored?.status, "sent");
});

// ── 10. Idempotency still works ─────────────────────────────────────────────

await test("10. Meta is called at most once per send request", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const capture: GraphCapture = { count: 0, authorization: null, url: null };

  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    config: envConfig(),
    actor: actorStub(),
    fetchImpl: capturingGraphFetch(capture),
    connectionLookup: lookupOf(connectionRecord()),
    companyId: COMPANY_ID,
  });

  assert.equal(result.httpStatus, 201);
  assert.equal(capture.count, 1, "exactly one Meta call per send");
  assert.equal(repo.messages.size, 1, "exactly one outbound row per send");
});

// ── 11. AI auto-reply remains disabled ──────────────────────────────────────

await test("11. credential resolution introduces no auto-send path", () => {
  const src = fs.readFileSync(
    new URL("./whatsappOutboundCredentials.ts", import.meta.url),
    "utf8"
  );
  // The resolver must never trigger a send by itself.
  assert.equal(src.includes("sendWhatsAppTextMessage"), false);
  assert.equal(src.includes("sendOutboundPlainText"), false);
  assert.equal(/auto[_-]?(send|reply)/i.test(src), false);
});

// ── 12. Env credentials never override a valid connection ───────────────────

await test("12. env credentials do not override a valid Embedded Signup connection", async () => {
  const resolution = await resolveOutboundCredentials({
    config: envConfig(),
    connectionLookup: lookupOf(connectionRecord()),
    companyId: COMPANY_ID,
    expectedPhoneNumberId: CONNECTION_PHONE_ID,
    env: { WHATSAPP_LEGACY_ENV_CREDENTIALS_ENABLED: "true" } as NodeJS.ProcessEnv,
  });
  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.source, "embedded_signup");
    assert.equal(resolution.accessToken, CONNECTION_TOKEN);
    assert.equal(resolution.phoneNumberId, CONNECTION_PHONE_ID);
  }
});

// ── Legacy env fallback: exactly when allowed and denied ────────────────────

await test("legacy fallback ALLOWED only when no connection record exists", async () => {
  resetLegacyFallbackWarningForTests();
  const resolution = await resolveOutboundCredentials({
    config: envConfig(),
    connectionLookup: lookupOf(null),
    companyId: COMPANY_ID,
    expectedPhoneNumberId: ENV_PHONE_ID,
    env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.source, "legacy_env");
    assert.equal(resolution.phoneNumberId, ENV_PHONE_ID);
  }
});

await test("legacy fallback DENIED when explicitly disabled by flag", async () => {
  const resolution = await resolveOutboundCredentials({
    config: envConfig(),
    connectionLookup: lookupOf(null),
    companyId: COMPANY_ID,
    env: {
      WHATSAPP_LEGACY_ENV_CREDENTIALS_ENABLED: "false",
    } as NodeJS.ProcessEnv,
  });
  assert.equal(resolution.ok, false);
  if (!resolution.ok) assert.equal(resolution.reason, "no_credentials");
});

await test("legacy fallback DENIED when a connection record exists but is unusable", async () => {
  for (const record of [
    connectionRecord({ stateOverride: "DISCONNECTED" }),
    connectionRecord({ accessToken: null }),
    connectionRecord({ tokenExpiresAt: "2000-01-01T00:00:00.000Z" }),
  ]) {
    const resolution = await resolveOutboundCredentials({
      config: envConfig(),
      connectionLookup: lookupOf(record),
      companyId: COMPANY_ID,
      env: {} as NodeJS.ProcessEnv,
    });
    assert.equal(resolution.ok, false, "must not fall back to env");
  }
});

await test("connection lookup failure fails closed (never silently uses env)", async () => {
  const resolution = await resolveOutboundCredentials({
    config: envConfig(),
    connectionLookup: {
      get: async () => {
        throw new Error("supabase unavailable");
      },
    },
    companyId: COMPANY_ID,
    env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(resolution.ok, false);
  if (!resolution.ok) assert.equal(resolution.reason, "connection_lookup_failed");
});

await test("legacy env credential helpers validate both values", () => {
  assert.equal(hasLegacyEnvCredentials(envConfig()), true);
  assert.equal(
    hasLegacyEnvCredentials(envConfig({ WHATSAPP_ACCESS_TOKEN: "" })),
    false
  );
  assert.equal(
    hasLegacyEnvCredentials(envConfig({ WHATSAPP_PHONE_NUMBER_ID: "abc" })),
    false
  );
  assert.equal(isLegacyEnvFallbackEnabled({} as NodeJS.ProcessEnv), true);
  assert.equal(
    isLegacyEnvFallbackEnabled({
      WHATSAPP_LEGACY_ENV_CREDENTIALS_ENABLED: "false",
    } as NodeJS.ProcessEnv),
    false
  );
});

if (failed > 0) {
  console.error(`\n${failed} outbound credential test(s) failed`);
  process.exit(1);
}
console.log("\nAll outbound credential tests passed");
