/**
 * Approved WhatsApp template management + sending.
 * Run: npm run test:whatsapp-templates
 *
 * Official Meta Cloud API only. Every Meta call is a stubbed fetch — no test
 * performs a real network request or sends a real message.
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { signAccessToken } from "../auth/jwt.ts";
import type { RequestActor } from "../middleware/actor.ts";
import { createAuthorizationMiddleware } from "../middleware/authorization.ts";
import { readWhatsAppConfig } from "./whatsappConfig.ts";
import type { WhatsAppConnectionRecord } from "./whatsappConnectionRepository.ts";
import {
  fetchWhatsAppMessageTemplates,
  sendWhatsAppTemplateMessage,
  sendWhatsAppTextMessage,
} from "./whatsappGraphClient.ts";
import type {
  InboxTemplateCatalogPort,
  InboxTemplateSendPort,
} from "./whatsappInboxControllers.ts";
import { parseSendTemplateMessageBody } from "./whatsappInboxDtos.ts";
import { createInMemoryWhatsAppInboxRepositories } from "./whatsappInboxRepository.ts";
import { createWhatsAppInboxRouter } from "./whatsappInboxRoutes.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import type { OutboundConnectionLookup } from "./whatsappOutboundCredentials.ts";
import { sendOutboundTemplate } from "./whatsappOutboundService.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import {
  TEMPLATE_CACHE_TTL_MS,
  WhatsAppTemplateCatalog,
} from "./whatsappTemplateCatalog.ts";
import {
  buildTemplateSendComponents,
  extractVariableIndices,
  normalizeMetaTemplate,
  normalizeTemplateStatus,
  renderTemplatePreview,
  toTemplateSummary,
  validateTemplateParamValue,
  type WhatsAppTemplate,
} from "./whatsappTemplates.ts";

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
  process.env.JWT_SECRET || "whatsapp-templates-test-secret-min-32-chars!!";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;

const PHONE_ID = "109876543210987";
const WABA_ID = "204060801012141";
const TOKEN = "connection-token-from-embedded-signup";
const ENV_TOKEN = "legacy-env-access-token";

// ── Meta-shaped fixtures ────────────────────────────────────────────────────

const metaOrderUpdate = {
  id: "t1",
  name: "order_update",
  language: "en_US",
  status: "APPROVED",
  category: "UTILITY",
  parameter_format: "POSITIONAL",
  components: [
    { type: "HEADER", format: "TEXT", text: "Order {{1}}" },
    { type: "BODY", text: "Hi {{1}}, your solar quote {{2}} is ready." },
    { type: "FOOTER", text: "Sunchaser Energy" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "URL", text: "View quote", url: "https://example.test/q/{{1}}" },
        { type: "QUICK_REPLY", text: "Call me" },
      ],
    },
  ],
};

const metaStatic = {
  id: "t2",
  name: "hello_static",
  language: "en",
  status: "APPROVED",
  category: "MARKETING",
  components: [{ type: "BODY", text: "Thanks for contacting Sunchaser." }],
};

function tpl(raw: unknown): WhatsAppTemplate {
  const t = normalizeMetaTemplate(raw);
  assert.ok(t, "fixture must normalize");
  return t!;
}

function envConfig(overrides: Record<string, string> = {}) {
  return readWhatsAppConfig({
    WHATSAPP_CONVERSATIONS_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: ENV_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: "555000111222333",
    WHATSAPP_GRAPH_API_VERSION: "v21.0",
    ...overrides,
  });
}

function connection(overrides: Partial<WhatsAppConnectionRecord> = {}): WhatsAppConnectionRecord {
  return {
    companyId: "sunchaser",
    wabaId: WABA_ID,
    phoneNumberId: PHONE_ID,
    phoneNumber: "15551234567",
    accessToken: TOKEN,
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

const lookupOf = (record: WhatsAppConnectionRecord | null): OutboundConnectionLookup => ({
  get: async () => record,
});

type Capture = { calls: Array<{ url: string; auth: string | null; body: any }> };

function graphStub(capture: Capture, responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async (input: any, init: any) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    capture.calls.push({
      url: String(input),
      auth: headers.Authorization ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

// ═══ A. Template normalization and send policy ══════════════════════════════

await test("A1. Meta template normalizes header, body, footer, buttons and var counts", () => {
  const t = tpl(metaOrderUpdate);
  assert.equal(t.sendable, true);
  assert.equal(t.unsupportedReason, null);
  assert.deepEqual(t.header, { format: "TEXT", text: "Order {{1}}", varCount: 1 });
  assert.equal(t.bodyVarCount, 2);
  assert.equal(t.footerText, "Sunchaser Energy");
  assert.equal(t.buttons.length, 2);
  assert.equal(t.buttons[0]!.urlVarCount, 1);
});

await test("A2. only APPROVED is sendable; unknown status is never sendable", () => {
  for (const status of ["PENDING", "REJECTED", "PAUSED", "DISABLED", "whatever"]) {
    const t = tpl({ ...metaStatic, status });
    assert.equal(t.sendable, false, status);
    assert.match(t.unsupportedReason!, /only APPROVED/);
  }
  assert.equal(normalizeTemplateStatus("PENDING_REVIEW"), "PENDING");
  assert.equal(normalizeTemplateStatus("nonsense"), "UNKNOWN");
});

await test("A3. unsupported features are listed with an explicit reason, not attempted", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...metaStatic, category: "AUTHENTICATION" }, /Authentication/],
    [{ ...metaStatic, parameter_format: "NAMED" }, /Named-parameter/],
    [{ ...metaStatic, components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "x" }] }, /Media/],
    [{ ...metaStatic, components: [{ type: "BODY", text: "x" }, { type: "BUTTONS", buttons: [{ type: "COPY_CODE", text: "c" }] }] }, /Copy-code/],
    [{ ...metaStatic, components: [{ type: "BODY", text: "x" }, { type: "BUTTONS", buttons: [{ type: "FLOW", text: "f" }] }] }, /button type/],
    [{ ...metaStatic, components: [{ type: "BODY", text: "Hi {{1}} and {{3}}" }] }, /not contiguous/],
    [{ ...metaStatic, name: "Bad Name!" }, /name/],
  ];
  for (const [raw, reason] of cases) {
    const t = tpl(raw);
    assert.equal(t.sendable, false);
    assert.match(t.unsupportedReason!, reason);
  }
  assert.equal(normalizeMetaTemplate({ status: "APPROVED" }), null, "unidentifiable record is dropped");
  assert.equal(normalizeMetaTemplate("nope"), null);
});

await test("A4. variable extraction is deduped and ordered", () => {
  assert.deepEqual(extractVariableIndices("{{2}} {{1}} {{2}}"), [1, 2]);
  assert.deepEqual(extractVariableIndices("no vars"), []);
});

// ═══ B. Component building and parameter validation ═════════════════════════

await test("B1. builds header, body and URL-button components in Meta's send shape", () => {
  const built = buildTemplateSendComponents(tpl(metaOrderUpdate), {
    headerText: "SQ-1042",
    body: ["Ali", "SQ-1042"],
    buttonUrlParams: { 0: "SQ-1042" },
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.components, [
    { type: "header", parameters: [{ type: "text", text: "SQ-1042" }] },
    {
      type: "body",
      parameters: [
        { type: "text", text: "Ali" },
        { type: "text", text: "SQ-1042" },
      ],
    },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "SQ-1042" }] },
  ]);
});

await test("B2. a fully static template sends with no components", () => {
  const built = buildTemplateSendComponents(tpl(metaStatic), {});
  assert.deepEqual(built, { ok: true, components: [] });
});

await test("B3. parameter count mismatch fails closed in BOTH directions", () => {
  const t = tpl(metaOrderUpdate);
  const base = { headerText: "h", buttonUrlParams: { 0: "x" } };
  const tooFew = buildTemplateSendComponents(t, { ...base, body: ["Ali"] });
  assert.equal(tooFew.ok, false);
  const tooMany = buildTemplateSendComponents(t, { ...base, body: ["a", "b", "c"] });
  assert.equal(tooMany.ok, false, "extras are rejected, not silently dropped");
});

await test("B4. values Meta would reject (132018) are caught before calling Meta", () => {
  assert.equal(validateTemplateParamValue("ok value", "v").ok, true);
  for (const bad of ["", "   ", "line\nbreak", "tab\there", "five     spaces", "x".repeat(1025)]) {
    assert.equal(validateTemplateParamValue(bad, "v").ok, false, JSON.stringify(bad));
  }
  assert.equal(validateTemplateParamValue(42, "v").ok, false);
});

await test("B5. stray header or button values are rejected", () => {
  const stat = tpl(metaStatic);
  assert.equal(buildTemplateSendComponents(stat, { headerText: "x" }).ok, false);
  assert.equal(buildTemplateSendComponents(stat, { buttonUrlParams: { 0: "x" } }).ok, false);
  const t = tpl(metaOrderUpdate);
  const quickReplyValue = buildTemplateSendComponents(t, {
    headerText: "h",
    body: ["a", "b"],
    buttonUrlParams: { 0: "x", 1: "not allowed" },
  });
  assert.equal(quickReplyValue.ok, false);
});

await test("B6. unsendable template cannot be built even with valid params", () => {
  const built = buildTemplateSendComponents(tpl({ ...metaStatic, status: "PAUSED" }), {});
  assert.equal(built.ok, false);
});

await test("B7. preview renders exactly what the customer sees", () => {
  const preview = renderTemplatePreview(tpl(metaOrderUpdate), {
    headerText: "SQ-1042",
    body: ["Ali", "SQ-1042"],
  });
  assert.equal(
    preview,
    "Order SQ-1042\n\nHi Ali, your solar quote SQ-1042 is ready.\n\nSunchaser Energy\n\n[View quote] [Call me]"
  );
});

await test("B8. browser summary carries no Meta template id", () => {
  const summary = toTemplateSummary(tpl(metaOrderUpdate)) as Record<string, unknown>;
  assert.equal("id" in summary, false);
});

// ═══ C. Graph client ════════════════════════════════════════════════════════

await test("C1. template send posts Meta's template payload with the given credentials", async () => {
  const capture: Capture = { calls: [] };
  const result = await sendWhatsAppTemplateMessage({
    toWaId: "923001234567",
    phoneNumberId: PHONE_ID,
    accessToken: TOKEN,
    graphApiVersion: "v21.0",
    templateName: "hello_static",
    languageCode: "en",
    components: [],
    fetchImpl: graphStub(capture, [{ status: 200, body: { messages: [{ id: "wamid.T1" }] } }]),
  });
  assert.deepEqual(result, { ok: true, providerMessageId: "wamid.T1", httpStatus: 200 });
  const call = capture.calls[0]!;
  assert.equal(call.url, `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`);
  assert.equal(call.auth, `Bearer ${TOKEN}`);
  assert.deepEqual(call.body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "923001234567",
    type: "template",
    template: { name: "hello_static", language: { code: "en" } },
  });
});

await test("C2. text send payload is unchanged by the shared POST refactor", async () => {
  const capture: Capture = { calls: [] };
  await sendWhatsAppTextMessage({
    toWaId: "923001234567",
    text: "hello",
    phoneNumberId: PHONE_ID,
    accessToken: TOKEN,
    graphApiVersion: "v21.0",
    fetchImpl: graphStub(capture, [{ status: 200, body: { messages: [{ id: "wamid.X" }] } }]),
  });
  assert.deepEqual(capture.calls[0]!.body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "923001234567",
    type: "text",
    text: { preview_url: false, body: "hello" },
  });
});

await test("C3. template listing follows Meta pagination and moves the token to the header", async () => {
  const capture: Capture = { calls: [] };
  const result = await fetchWhatsAppMessageTemplates({
    wabaId: WABA_ID,
    accessToken: TOKEN,
    graphApiVersion: "v21.0",
    fetchImpl: graphStub(capture, [
      {
        status: 200,
        body: {
          data: [metaOrderUpdate],
          paging: { next: `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates?after=abc&access_token=${TOKEN}` },
        },
      },
      { status: 200, body: { data: [metaStatic] } },
    ]),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.records.length, 2);
  assert.equal(result.truncated, false);
  assert.equal(capture.calls.length, 2);
  assert.ok(capture.calls[0]!.url.startsWith(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates?`));
  assert.equal(capture.calls[1]!.url.includes("access_token"), false, "token stripped from paging URL");
  assert.equal(capture.calls[1]!.auth, `Bearer ${TOKEN}`);
});

await test("C4. paging.next pointing off Meta's host is never followed", async () => {
  const capture: Capture = { calls: [] };
  for (const next of ["https://attacker.example/steal", "http://graph.facebook.com/x", "not a url"]) {
    capture.calls.length = 0;
    const result = await fetchWhatsAppMessageTemplates({
      wabaId: WABA_ID,
      accessToken: TOKEN,
      graphApiVersion: "v21.0",
      fetchImpl: graphStub(capture, [{ status: 200, body: { data: [], paging: { next } } }]),
    });
    assert.equal(result.ok, true);
    assert.equal(capture.calls.length, 1, `must not follow ${next}`);
  }
});

await test("C5. pagination is bounded and reports truncation", async () => {
  const capture: Capture = { calls: [] };
  const loop = { status: 200, body: { data: [metaStatic], paging: { next: `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates?after=z` } } };
  const result = await fetchWhatsAppMessageTemplates({
    wabaId: WABA_ID,
    accessToken: TOKEN,
    graphApiVersion: "v21.0",
    maxPages: 3,
    fetchImpl: graphStub(capture, [loop]),
  });
  assert.equal(capture.calls.length, 3);
  assert.equal(result.ok && result.truncated, true);
});

await test("C6. invalid WABA id or version makes no request; provider errors are sanitized", async () => {
  const capture: Capture = { calls: [] };
  const bad = await fetchWhatsAppMessageTemplates({
    wabaId: "../etc",
    accessToken: TOKEN,
    graphApiVersion: "v21.0",
    fetchImpl: graphStub(capture, [{ status: 200, body: { data: [] } }]),
  });
  assert.equal(bad.ok, false);
  assert.equal(capture.calls.length, 0);

  const denied = await fetchWhatsAppMessageTemplates({
    wabaId: WABA_ID,
    accessToken: TOKEN,
    graphApiVersion: "v21.0",
    fetchImpl: graphStub(capture, [
      { status: 403, body: { error: { code: 200, message: `bad Bearer ${TOKEN}` } } },
    ]),
  });
  assert.equal(denied.ok, false);
  assert.equal(JSON.stringify(denied).includes(TOKEN), false);
});

// ═══ D. Catalog: connection-first, fail closed, cache ═══════════════════════

function catalogWith(
  record: WhatsAppConnectionRecord | null,
  capture: Capture,
  opts: { env?: NodeJS.ProcessEnv; now?: () => number; lookupThrows?: boolean } = {}
) {
  return new WhatsAppTemplateCatalog({
    config: envConfig(),
    connectionLookup: opts.lookupThrows
      ? { get: async () => { throw new Error("db down"); } }
      : lookupOf(record),
    companyId: "sunchaser",
    env: opts.env ?? ({} as NodeJS.ProcessEnv),
    now: opts.now,
    fetchImpl: graphStub(capture, [{ status: 200, body: { data: [metaOrderUpdate, metaStatic] } }]),
  });
}

await test("D1. catalog reads the Embedded Signup connection's WABA with its token", async () => {
  const capture: Capture = { calls: [] };
  const listed = await catalogWith(connection(), capture).list();
  assert.equal(listed.ok, true);
  assert.ok(capture.calls[0]!.url.includes(`/${WABA_ID}/message_templates`));
  assert.equal(capture.calls[0]!.auth, `Bearer ${TOKEN}`);
  assert.equal(listed.ok && listed.templates.length, 2);
});

await test("D2. defective connection or lookup failure fails closed, never falls back to env", async () => {
  const env = {
    WHATSAPP_BUSINESS_ACCOUNT_ID: "999888777666555",
  } as NodeJS.ProcessEnv;
  for (const record of [
    connection({ stateOverride: "DISCONNECTED" }),
    connection({ accessToken: null }),
    connection({ wabaId: null }),
    connection({ tokenExpiresAt: "2000-01-01T00:00:00.000Z" }),
  ]) {
    const capture: Capture = { calls: [] };
    const listed = await catalogWith(record, capture, { env }).list();
    assert.equal(listed.ok, false);
    assert.equal(capture.calls.length, 0, "no Meta call");
  }
  const capture: Capture = { calls: [] };
  const failed = await catalogWith(null, capture, { env, lookupThrows: true }).list();
  assert.equal(failed.ok, false);
  assert.equal(capture.calls.length, 0);
});

await test("D3. legacy env WABA is used only when no connection record exists", async () => {
  const capture: Capture = { calls: [] };
  const listed = await catalogWith(null, capture, {
    env: { WHATSAPP_BUSINESS_ACCOUNT_ID: "999888777666555" } as NodeJS.ProcessEnv,
  }).list();
  assert.equal(listed.ok, true);
  assert.ok(capture.calls[0]!.url.includes("/999888777666555/"));
  assert.equal(capture.calls[0]!.auth, `Bearer ${ENV_TOKEN}`);

  const off: Capture = { calls: [] };
  const denied = await catalogWith(null, off, {
    env: {
      WHATSAPP_BUSINESS_ACCOUNT_ID: "999888777666555",
      WHATSAPP_LEGACY_ENV_CREDENTIALS_ENABLED: "false",
    } as NodeJS.ProcessEnv,
  }).list();
  assert.equal(denied.ok, false);
  assert.equal(off.calls.length, 0);
});

await test("D4. cache serves within TTL, refetches after it, and refresh bypasses it", async () => {
  let clock = 1_000_000;
  const capture: Capture = { calls: [] };
  const catalog = catalogWith(connection(), capture, { now: () => clock });
  await catalog.list();
  await catalog.list();
  assert.equal(capture.calls.length, 1, "second call served from cache");
  await catalog.list({ refresh: true });
  assert.equal(capture.calls.length, 2, "refresh bypasses cache");
  clock += TEMPLATE_CACHE_TTL_MS + 1;
  await catalog.list();
  assert.equal(capture.calls.length, 3, "expired entry refetched");
});

await test("D5. find locates by exact name+language and reports not_found", async () => {
  const catalog = catalogWith(connection(), { calls: [] });
  const found = await catalog.find("order_update", "en_US");
  assert.equal(found.ok, true);
  const wrongLang = await catalog.find("order_update", "en");
  assert.equal(wrongLang.ok === false && wrongLang.reason, "not_found");
});

// ═══ E. Outbound service: template through the official pipeline ═══════════

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

async function seedLegacyConversation(repo: InMemoryWhatsAppRepository, phoneNumberId = PHONE_ID) {
  const channel = await repo.resolveOrCreateChannel({ phoneNumberId, displayPhoneNumber: "15551234567" });
  const contact = await repo.resolveOrCreateContact({ phoneE164: "923001234567", profileName: "Ali" });
  return repo.resolveOrCreateOpenConversation({ channelId: channel.id, contactId: contact.id });
}

function staticTemplatePayload() {
  const t = tpl(metaStatic);
  const built = buildTemplateSendComponents(t, {});
  assert.ok(built.ok);
  return {
    templateName: t.name,
    languageCode: t.language,
    components: built.ok ? built.components : [],
    previewText: renderTemplatePreview(t, {}),
  };
}

await test("E1. template send uses resolved Embedded Signup credentials and stores the preview", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const conversation = await seedLegacyConversation(repo);
  const capture: Capture = { calls: [] };
  const result = await sendOutboundTemplate(conversation.id, staticTemplatePayload(), {
    repo,
    config: envConfig(),
    actor: actorStub(),
    connectionLookup: lookupOf(connection()),
    fetchImpl: graphStub(capture, [{ status: 200, body: { messages: [{ id: "wamid.TPL1" }] } }]),
  });
  assert.equal(result.httpStatus, 201);
  assert.equal(capture.calls.length, 1);
  assert.equal(capture.calls[0]!.auth, `Bearer ${TOKEN}`);
  assert.ok(capture.calls[0]!.url.includes(`/${PHONE_ID}/messages`));
  assert.equal(capture.calls[0]!.body.type, "template");
  if (result.httpStatus !== 201) return;
  const stored = repo.messages.get(result.messageId)!;
  assert.equal(stored.waMessageId, "wamid.TPL1");
  assert.equal(stored.textBody, "Thanks for contacting Sunchaser.");
  assert.equal(stored.status, "sent");
});

await test("E2. delivery and read statuses reconcile onto the template message", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const conversation = await seedLegacyConversation(repo);
  const result = await sendOutboundTemplate(conversation.id, staticTemplatePayload(), {
    repo,
    config: envConfig(),
    actor: actorStub(),
    connectionLookup: lookupOf(connection()),
    fetchImpl: graphStub({ calls: [] }, [{ status: 200, body: { messages: [{ id: "wamid.TPL2" }] } }]),
  });
  assert.equal(result.httpStatus, 201);
  if (result.httpStatus !== 201) return;
  for (const status of ["delivered", "read"] as const) {
    const applied = await repo.insertStatusEvent({
      kind: "status",
      phoneNumberId: PHONE_ID,
      displayPhoneNumber: null,
      wabaEntryId: WABA_ID,
      waMessageId: "wamid.TPL2",
      status,
      statusTimestamp: status === "delivered" ? "2026-09-28T10:00:00.000Z" : "2026-09-28T10:01:00.000Z",
      recipientWaId: "923001234567",
      rawEvent: {},
    });
    assert.equal(applied.ok && applied.row.messageUpdated, true, status);
    assert.equal(repo.messages.get(result.messageId)!.status, status);
  }
});

await test("E3. phone-identity mismatch sends nothing to Meta", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const conversation = await seedLegacyConversation(repo, "999888777666555");
  const capture: Capture = { calls: [] };
  const result = await sendOutboundTemplate(conversation.id, staticTemplatePayload(), {
    repo,
    config: envConfig(),
    actor: actorStub(),
    connectionLookup: lookupOf(connection()),
    fetchImpl: graphStub(capture, [{ status: 200, body: { messages: [{ id: "x" }] } }]),
  });
  assert.equal(result.httpStatus, 503);
  assert.equal(capture.calls.length, 0);
});

await test("E4. unauthorized actors are refused before Meta", async () => {
  for (const actor of [actorStub({ role: "Customer" }), actorStub({ accountStatus: "Pending" }), null]) {
    const repo = new InMemoryWhatsAppRepository();
    const conversation = await seedLegacyConversation(repo);
    const capture: Capture = { calls: [] };
    const result = await sendOutboundTemplate(conversation.id, staticTemplatePayload(), {
      repo,
      config: envConfig(),
      actor,
      connectionLookup: lookupOf(connection()),
      fetchImpl: graphStub(capture, [{ status: 200, body: { messages: [{ id: "x" }] } }]),
    });
    assert.ok(result.httpStatus === 401 || result.httpStatus === 403);
    assert.equal(capture.calls.length, 0);
  }
});

await test("E5. Meta template rejection is recorded as failed and stays sanitized", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const conversation = await seedLegacyConversation(repo);
  const result = await sendOutboundTemplate(conversation.id, staticTemplatePayload(), {
    repo,
    config: envConfig(),
    actor: actorStub(),
    connectionLookup: lookupOf(connection()),
    fetchImpl: graphStub({ calls: [] }, [
      { status: 400, body: { error: { code: 132001, message: `Template does not exist Bearer ${TOKEN}` } } },
    ]),
  });
  assert.notEqual(result.httpStatus, 201);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  const rows = [...repo.messages.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "failed");
});

// ═══ F. HTTP: window rules, RBAC, idempotency ═══════════════════════════════

const users = [
  { id: "u-staff", username: "staff", name: "S", email: "s@t.com", role: "Sales Executive", account_status: "Approved" },
  { id: "u-admin", username: "admin", name: "A", email: "a@t.com", role: "Admin", account_status: "Approved" },
  { id: "u-tech", username: "tech", name: "T", email: "t@t.com", role: "Technician", account_status: "Approved" },
];

type Harness = {
  base: string;
  tokens: Record<string, string>;
  repos: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>;
  templateCalls: Parameters<InboxTemplateSendPort>[0][];
  textCalls: number;
  catalogRefreshes: number;
};

async function withHarness(
  opts: { catalog?: InboxTemplateCatalogPort; templateResult?: Awaited<ReturnType<InboxTemplateSendPort>> },
  fn: (h: Harness) => Promise<void>
) {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const services = createWhatsAppInboxServices(repos, {
    now: () => Date.parse("2026-07-19T12:00:00.000Z"),
  });
  const h: Harness = {
    base: "",
    tokens: {},
    repos,
    templateCalls: [],
    textCalls: 0,
    catalogRefreshes: 0,
  };
  const templates = [tpl(metaOrderUpdate), tpl(metaStatic), tpl({ ...metaStatic, name: "paused_one", status: "PAUSED" })];
  const catalog: InboxTemplateCatalogPort = opts.catalog ?? {
    async list(o) {
      if (o?.refresh) h.catalogRefreshes += 1;
      return { ok: true, templates, fetchedAt: "2026-07-19T12:00:00.000Z", truncated: false };
    },
    async find(name, language) {
      const t = templates.find((x) => x.name === name && x.language === language);
      return t ? { ok: true, template: t } : { ok: false, reason: "not_found", message: "Template not found" };
    },
  };
  let seq = 0;
  const app = express();
  app.use(express.json());
  app.use(createAuthorizationMiddleware({ resolveLocalDb: () => ({ users }) as any }));
  app.use(
    "/api/inbox",
    createWhatsAppInboxRouter({
      services,
      sendPort: async () => {
        h.textCalls += 1;
        return { ok: true, messageId: `text-${++seq}` };
      },
      templateSendPort: async (input) => {
        h.templateCalls.push(input);
        return opts.templateResult ?? { ok: true, messageId: `tpl-${++seq}` };
      },
      templateCatalog: catalog,
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  h.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/inbox`;
  for (const u of users) {
    h.tokens[u.username] = signAccessToken({ userId: u.id, username: u.username, role: u.role });
  }
  try {
    await fn(h);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function seed(h: Harness, id: string, lastInboundAt: string | null) {
  const now = "2026-07-19T10:00:00.000Z";
  h.repos.store.conversations.set(id, {
    id,
    companyId: "sunchaser",
    channelId: "wch_1",
    contactId: `wct_${id}`,
    status: "open",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: 1,
    hasFailedMessage: false,
  } as any);
  if (lastInboundAt) {
    h.repos.store.messages.set(`in_${id}`, {
      id: `in_${id}`,
      conversationId: id,
      companyId: "sunchaser",
      direction: "inbound",
      status: "received",
      createdAt: lastInboundAt,
      occurredAt: lastInboundAt,
    } as any);
  }
}

async function call(h: Harness, method: string, path: string, user: string, body?: unknown) {
  const res = await fetch(`${h.base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${h.tokens[user]}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const sendBody = (conversationId: string, key: string, extra: Record<string, unknown> = {}) => ({
  conversationId,
  idempotencyKey: key,
  templateName: "hello_static",
  languageCode: "en",
  ...extra,
});

await test("F1. template sends OUTSIDE the 24h window, where free-form text is blocked", async () => {
  await withHarness({}, async (h) => {
    seed(h, "c_closed", "2026-07-17T09:00:00.000Z"); // > 24h before 'now'
    const text = await call(h, "POST", "/messages/send", "staff", {
      conversationId: "c_closed",
      text: "hi",
      idempotencyKey: "k-text",
    });
    assert.notEqual(text.status, 201, "free-form must stay blocked");
    assert.equal(h.textCalls, 0);

    const templ = await call(h, "POST", "/messages/send-template", "staff", sendBody("c_closed", "k-tpl"));
    assert.equal(templ.status, 201, JSON.stringify(templ.body));
    assert.equal(h.templateCalls.length, 1);
    assert.equal(h.templateCalls[0]!.previewText, "Thanks for contacting Sunchaser.");
  });
});

await test("F2. template to a customer who never messaged is refused (interim consent guard)", async () => {
  await withHarness({}, async (h) => {
    seed(h, "c_cold", null);
    const res = await call(h, "POST", "/messages/send-template", "staff", sendBody("c_cold", "k1"));
    assert.equal(res.status, 409);
    assert.equal(h.templateCalls.length, 0);
  });
});

await test("F3. RBAC: roles without send permission are refused before any lookup", async () => {
  await withHarness({}, async (h) => {
    seed(h, "c1", "2026-07-19T11:00:00.000Z");
    const res = await call(h, "POST", "/messages/send-template", "tech", sendBody("c1", "k1"));
    assert.equal(res.status, 403);
    assert.equal(h.templateCalls.length, 0);
  });
});

await test("F4. invalid parameters and unapproved templates are rejected without consuming the key", async () => {
  await withHarness({}, async (h) => {
    seed(h, "c1", "2026-07-19T11:00:00.000Z");
    const badParams = await call(h, "POST", "/messages/send-template", "staff", {
      ...sendBody("c1", "k-reuse"),
      templateName: "order_update",
      languageCode: "en_US",
      bodyParameters: ["only one"],
    });
    assert.equal(badParams.status, 400);
    const paused = await call(h, "POST", "/messages/send-template", "staff", {
      ...sendBody("c1", "k-reuse"),
      templateName: "paused_one",
    });
    assert.equal(paused.status, 400);
    const missing = await call(h, "POST", "/messages/send-template", "staff", {
      ...sendBody("c1", "k-reuse"),
      templateName: "no_such",
    });
    assert.equal(missing.status, 404);
    assert.equal(h.templateCalls.length, 0);
    // Same key is still usable for a valid request.
    const ok = await call(h, "POST", "/messages/send-template", "staff", sendBody("c1", "k-reuse"));
    assert.equal(ok.status, 201);
  });
});

await test("F5. idempotency: a replayed key never sends twice", async () => {
  await withHarness({}, async (h) => {
    seed(h, "c1", "2026-07-19T11:00:00.000Z");
    const first = await call(h, "POST", "/messages/send-template", "staff", sendBody("c1", "k-once"));
    const second = await call(h, "POST", "/messages/send-template", "staff", sendBody("c1", "k-once"));
    assert.equal(first.status, 201);
    assert.equal(second.body.data?.replay ?? second.body.replay, true);
    assert.equal(h.templateCalls.length, 1);
  });
});

await test("F6. provider failure finalizes the key as failed; replay returns the failure", async () => {
  await withHarness(
    { templateResult: { ok: false, error: "[132001] Template does not exist", permanent: true } },
    async (h) => {
      seed(h, "c1", "2026-07-19T11:00:00.000Z");
      const first = await call(h, "POST", "/messages/send-template", "staff", sendBody("c1", "k-fail"));
      assert.equal(first.status, 400);
      const replay = await call(h, "POST", "/messages/send-template", "staff", sendBody("c1", "k-fail"));
      assert.equal(replay.status, 200);
      assert.equal(h.templateCalls.length, 1);
    }
  );
});

await test("F7. template list is browser-safe; refresh is admin-only", async () => {
  await withHarness({}, async (h) => {
    const listed = await call(h, "GET", "/templates", "staff");
    assert.equal(listed.status, 200);
    const payload = listed.body.data ?? listed.body;
    assert.equal(payload.templates.length, 3);
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes(WABA_ID), false);
    assert.equal("id" in payload.templates[0], false);

    const staffRefresh = await call(h, "GET", "/templates?refresh=true", "staff");
    assert.equal(staffRefresh.status, 403);
    assert.equal(h.catalogRefreshes, 0);
    const adminRefresh = await call(h, "GET", "/templates?refresh=true", "admin");
    assert.equal(adminRefresh.status, 200);
    assert.equal(h.catalogRefreshes, 1);
  });
});

await test("F8. catalog outage is a 503 and sends nothing", async () => {
  const down: InboxTemplateCatalogPort = {
    list: async () => ({ ok: false, reason: "connection_unavailable", message: "WhatsApp connection lookup failed" }),
    find: async () => ({ ok: false, reason: "connection_unavailable", message: "WhatsApp connection lookup failed" }),
  };
  await withHarness({ catalog: down }, async (h) => {
    seed(h, "c1", "2026-07-19T11:00:00.000Z");
    assert.equal((await call(h, "GET", "/templates", "staff")).status, 503);
    assert.equal((await call(h, "POST", "/messages/send-template", "staff", sendBody("c1", "k1"))).status, 503);
    assert.equal(h.templateCalls.length, 0);
  });
});

await test("F9. request DTO rejects unknown keys and malformed parameters", () => {
  const base = { conversationId: "c", idempotencyKey: "k", templateName: "t", languageCode: "en" };
  assert.equal(parseSendTemplateMessageBody(base).ok, true);
  assert.equal(parseSendTemplateMessageBody({ ...base, to: "+923001234567" }).ok, false, "recipient never from browser");
  assert.equal(parseSendTemplateMessageBody({ ...base, bodyParameters: "x" }).ok, false);
  assert.equal(parseSendTemplateMessageBody({ ...base, bodyParameters: [1] }).ok, false);
  assert.equal(parseSendTemplateMessageBody({ ...base, bodyParameters: Array(21).fill("x") }).ok, false);
  assert.equal(parseSendTemplateMessageBody({ ...base, buttonUrlParameters: { a: "x" } }).ok, false);
});

if (failed > 0) {
  console.error(`\n${failed} WhatsApp template test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp template tests passed");
