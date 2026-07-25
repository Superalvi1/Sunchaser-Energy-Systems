/**
 * Task 1 — Official Meta WhatsApp characterization / regression baseline.
 *
 * Proves existing public/module behaviour before any transport-adapter work.
 * Intentionally does not introduce adapters, schema changes, or production edits.
 *
 * Run: npm run test:unified-messaging-baseline
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { AddressInfo } from "net";
import type { RequestActor } from "../middleware/actor.ts";
import { readWhatsAppConfig } from "./whatsappConfig.ts";
import { MESSAGE_STATUSES, WHATSAPP_WEBHOOK_PATH } from "./whatsappConstants.ts";
import { parseWebhookRawBody } from "./whatsappEnvelope.ts";
import { installWhatsAppRawBodyMiddleware } from "./index.ts";
import {
  getWhatsAppConnectionStatus,
  resetConnectionStoreForTests,
} from "./whatsappConnectionService.ts";
import { CRMLinkService } from "./whatsappCrmLinkService.ts";
import { WHATSAPP_AI_OWNERSHIP_STATES } from "./whatsappInboxDatabaseTypes.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import {
  CREATE_LEAD_PENDING_ENTITY_ID,
  PENDING_LEAD_PREFIX,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";
import { createInMemoryWhatsAppInboxRepositories } from "./whatsappInboxRepository.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import { InMemoryWhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import {
  canSendOutboundWhatsApp,
  authorizeOutboundWhatsAppActor,
} from "./whatsappPermissions.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import { verifyWhatsAppSignature } from "./whatsappSignature.ts";
import { createWhatsAppWebhookRouter } from "./whatsappWebhookRoutes.ts";
import {
  sendOutboundPlainText,
  validateOutboundText,
} from "./whatsappOutboundService.ts";
import { AiShadowEngine, MockAiProvider } from "./aiEngine/index.ts";

let failed = 0;

async function test(
  name: string,
  fn: () => void | Promise<void>
): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const APP_SECRET = "baseline-meta-app-secret";
const VERIFY_TOKEN = "baseline-verify-token";
const PHONE_NUMBER_ID = "109876543210987";

function sign(raw: Buffer, secret = APP_SECRET): string {
  const hex = createHmac("sha256", secret).update(raw).digest("hex");
  return `sha256=${hex}`;
}

function enabledConfig(overrides: Record<string, string> = {}) {
  return readWhatsAppConfig({
    WHATSAPP_CONVERSATIONS_ENABLED: "true",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_ACCESS_TOKEN: "baseline-access-token",
    WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    WHATSAPP_GRAPH_API_VERSION: "v21.0",
    ...overrides,
  });
}

function staffActor(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    id: "u-staff-baseline",
    username: "staff",
    name: "Staff",
    email: "staff@example.com",
    role: "Sales Executive",
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

function inboundTextEnvelope(opts: {
  waMessageId?: string;
  text?: string;
  from?: string;
  phoneNumberId?: string;
} = {}) {
  const waMessageId = opts.waMessageId ?? "wamid.BASELINE.TEXT1";
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_BASELINE",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: opts.phoneNumberId ?? PHONE_NUMBER_ID,
              },
              contacts: [
                {
                  profile: { name: "Baseline Contact" },
                  wa_id: opts.from ?? "923001234567",
                },
              ],
              messages: [
                {
                  from: opts.from ?? "923001234567",
                  id: waMessageId,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: opts.text ?? "Baseline hello from Meta" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function statusEnvelope(opts: {
  waMessageId?: string;
  status?: string;
  timestamp?: string;
} = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_BASELINE",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: PHONE_NUMBER_ID,
              },
              statuses: [
                {
                  id: opts.waMessageId ?? "wamid.BASELINE.OUT1",
                  status: opts.status ?? "delivered",
                  timestamp: opts.timestamp ?? "1700000100",
                  recipient_id: "923001234567",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

type HttpResult = { status: number; body: any; text: string };

async function withWebhookServer(
  repo: InMemoryWhatsAppRepository,
  config: ReturnType<typeof enabledConfig>,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/whatsapp", createWhatsAppWebhookRouter({ repo, config }));

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function postWebhook(
  baseUrl: string,
  payload: unknown,
  opts: { signature?: string | null; raw?: Buffer } = {}
): Promise<HttpResult> {
  const raw =
    opts.raw ??
    Buffer.from(
      typeof payload === "string" ? payload : JSON.stringify(payload),
      "utf8"
    );
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.signature === null) {
    // omit
  } else if (opts.signature) {
    headers["x-hub-signature-256"] = opts.signature;
  } else {
    headers["x-hub-signature-256"] = sign(raw);
  }
  const res = await fetch(`${baseUrl}${WHATSAPP_WEBHOOK_PATH}`, {
    method: "POST",
    headers,
    body: new Uint8Array(raw),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

async function seedOutboundConversation(repo: InMemoryWhatsAppRepository) {
  const channel = await repo.resolveOrCreateChannel({
    phoneNumberId: PHONE_NUMBER_ID,
    displayPhoneNumber: "15551234567",
  });
  const contact = await repo.resolveOrCreateContact({
    phoneE164: "923001234567",
    profileName: "Baseline Contact",
  });
  const conversation = await repo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  return { channel, contact, conversation };
}

function seedInboxConversation(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  id = "c_baseline_1"
) {
  const now = "2026-07-19T10:00:00.000Z";
  const row = {
    id,
    companyId: "sunchaser",
    channelId: "wch_baseline",
    contactId: `wct_${id}`,
    status: "open" as const,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    aiOwnershipState: "AI_SHADOW" as const,
    lockVersion: 1,
    hasFailedMessage: false,
  };
  store.conversations.set(row.id, row);
  return row;
}

// ---------------------------------------------------------------------------
// 1. Inbound Meta text normalized and persisted once
// ---------------------------------------------------------------------------

await test(
  "baseline: inbound Meta text is normalized and persisted once",
  async () => {
    const repo = new InMemoryWhatsAppRepository();
    const payload = inboundTextEnvelope({
      waMessageId: "wamid.BASELINE.ONCE",
      text: "Once-only inbound",
    });

    const parsed = parseWebhookRawBody(Buffer.from(JSON.stringify(payload)));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.events.length, 1);
    const event = parsed.events[0]!;
    assert.equal(event.kind, "inbound_text");
    if (event.kind === "inbound_text") {
      assert.equal(event.waMessageId, "wamid.BASELINE.ONCE");
      assert.equal(event.text, "Once-only inbound");
      assert.equal(event.fromWaId, "923001234567");
      assert.equal(event.phoneNumberId, PHONE_NUMBER_ID);
    }

    await withWebhookServer(repo, enabledConfig(), async (base) => {
      const res = await postWebhook(base, payload);
      assert.equal(res.status, 200);
      assert.equal(repo.messages.size, 1);
      const msg = [...repo.messages.values()][0]!;
      assert.equal(msg.waMessageId, "wamid.BASELINE.ONCE");
      assert.equal(msg.direction, "inbound");
      assert.equal(msg.textBody, "Once-only inbound");
      assert.equal(msg.status, MESSAGE_STATUSES.RECEIVED);
    });
  }
);

// ---------------------------------------------------------------------------
// 2. Duplicate webhook / message events do not create duplicates
// ---------------------------------------------------------------------------

await test(
  "baseline: duplicate webhook envelope does not create duplicate messages",
  async () => {
    const repo = new InMemoryWhatsAppRepository();
    const payload = inboundTextEnvelope({
      waMessageId: "wamid.BASELINE.DUP",
      text: "Duplicate envelope",
    });

    await withWebhookServer(repo, enabledConfig(), async (base) => {
      const first = await postWebhook(base, payload);
      assert.equal(first.status, 200);
      assert.notEqual(first.body?.duplicate, true);
      assert.equal(repo.messages.size, 1);

      const second = await postWebhook(base, payload);
      assert.equal(second.status, 200);
      assert.equal(second.body?.duplicate, true);
      assert.equal(repo.messages.size, 1);
    });
  }
);

await test(
  "baseline: same wa_message_id insert is idempotent at repository layer",
  async () => {
    const repo = new InMemoryWhatsAppRepository();
    const channel = await repo.resolveOrCreateChannel({
      phoneNumberId: PHONE_NUMBER_ID,
    });
    const contact = await repo.resolveOrCreateContact({
      phoneE164: "923009998887",
    });
    const conversation = await repo.resolveOrCreateOpenConversation({
      channelId: channel.id,
      contactId: contact.id,
    });

    const inbound = {
      conversationId: conversation.id,
      waMessageId: "wamid.BASELINE.REPO.DUP",
      textBody: "repo dup",
      occurredAt: "2026-07-19T10:00:00.000Z",
      rawPayload: {},
    };

    const a = await repo.insertInboundMessage(inbound);
    const b = await repo.insertInboundMessage(inbound);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) {
      assert.equal(a.row.id, b.row.id);
      assert.equal(a.created, true);
      assert.equal(b.created, false);
    }
    assert.equal(repo.messages.size, 1);
  }
);

// ---------------------------------------------------------------------------
// 3. Outbound authorization + inbox idempotency
// ---------------------------------------------------------------------------

await test(
  "baseline: outbound retains authorization and at-most-once Graph send",
  async () => {
    assert.equal(canSendOutboundWhatsApp(staffActor()), true);
    assert.equal(
      canSendOutboundWhatsApp(staffActor({ role: "Customer" })),
      false
    );
    assert.equal(
      canSendOutboundWhatsApp(staffActor({ accountStatus: "Pending" })),
      false
    );
    assert.equal(
      authorizeOutboundWhatsAppActor(staffActor(), null).ok,
      false
    );

    const invalid = validateOutboundText("");
    assert.equal(invalid.ok, false);

    const repo = new InMemoryWhatsAppRepository();
    const { conversation } = await seedOutboundConversation(repo);
    const calls = { count: 0 };
    const fetchImpl: typeof fetch = async () => {
      calls.count += 1;
      return new Response(
        JSON.stringify({
          messaging_product: "whatsapp",
          messages: [{ id: "wamid.BASELINE.OUT.OK" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const denied = await sendOutboundPlainText(conversation.id, "hello", {
      repo,
      config: enabledConfig(),
      actor: staffActor({ role: "Customer" }),
      fetchImpl,
    });
    assert.equal(denied.httpStatus, 403);
    assert.equal(calls.count, 0);
    assert.equal(repo.messages.size, 0);

    const ok = await sendOutboundPlainText(conversation.id, "Outbound baseline", {
      repo,
      config: enabledConfig(),
      actor: staffActor(),
      fetchImpl,
    });
    assert.equal(ok.httpStatus, 201);
    if (ok.httpStatus === 201) {
      assert.equal(ok.status, "sent");
      assert.equal(ok.providerMessageId, "wamid.BASELINE.OUT.OK");
    }
    assert.equal(calls.count, 1);
    assert.equal(repo.messages.size, 1);
  }
);

await test(
  "baseline: inbox outbound idempotency claim/replay remains stable",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    seedInboxConversation(repos.store, "c_idem");
    // Keep free-form window open (inbound within 24h of service "now").
    repos.store.messages.set("m_in_baseline", {
      id: "m_in_baseline",
      companyId: "sunchaser",
      conversationId: "c_idem",
      direction: "inbound",
      status: "received",
      textBody: "inbound for window",
      createdAt: "2026-07-19T10:00:00.000Z",
      occurredAt: "2026-07-19T10:00:00.000Z",
    });
    const now = Date.parse("2026-07-19T10:30:00.000Z");
    const services = createWhatsAppInboxServices(repos, { now: () => now });

    const claimed = await services.messages.beginOutboundIdempotency({
      conversationId: "c_idem",
      idempotencyKey: "baseline-key-1",
      actor: staffActor(),
    });
    assert.equal(claimed.kind, "claimed");

    const processing = await services.messages.beginOutboundIdempotency({
      conversationId: "c_idem",
      idempotencyKey: "baseline-key-1",
      actor: staffActor(),
    });
    assert.equal(processing.kind, "processing");

    await services.messages.completeOutboundIdempotency({
      conversationId: "c_idem",
      idempotencyKey: "baseline-key-1",
      messageId: "msg_baseline_1",
    });

    const replay = await services.messages.beginOutboundIdempotency({
      conversationId: "c_idem",
      idempotencyKey: "baseline-key-1",
      actor: staffActor(),
    });
    assert.equal(replay.kind, "replay_completed");
    if (replay.kind === "replay_completed") {
      assert.equal(replay.row.messageId, "msg_baseline_1");
    }
  }
);

// ---------------------------------------------------------------------------
// 4. Provider delivery statuses normalized correctly
// ---------------------------------------------------------------------------

await test(
  "baseline: provider delivery statuses remain normalized correctly",
  async () => {
    for (const status of ["sent", "delivered", "read", "failed"] as const) {
      const parsed = parseWebhookRawBody(
        Buffer.from(
          JSON.stringify(
            statusEnvelope({
              waMessageId: `wamid.BASELINE.STATUS.${status}`,
              status,
            })
          )
        )
      );
      assert.equal(parsed.ok, true);
      if (!parsed.ok) continue;
      assert.equal(parsed.events.length, 1);
      const event = parsed.events[0]!;
      assert.equal(event.kind, "status");
      if (event.kind === "status") {
        assert.equal(event.status, status);
        assert.equal(event.waMessageId, `wamid.BASELINE.STATUS.${status}`);
        assert.equal(event.recipientWaId, "923001234567");
      }
    }

    const unknown = parseWebhookRawBody(
      Buffer.from(JSON.stringify(statusEnvelope({ status: "deleted" })))
    );
    assert.equal(unknown.ok, true);
    if (unknown.ok) {
      // Unsupported provider statuses are dropped (not normalized as status events).
      assert.equal(unknown.events.length, 0);
    }

    const repo = new InMemoryWhatsAppRepository();
    const { conversation } = await seedOutboundConversation(repo);
    const outbound = await repo.insertOutboundMessage({
      conversationId: conversation.id,
      textBody: "status target",
    });
    await repo.updateMessageStatus({
      messageId: outbound.id,
      status: MESSAGE_STATUSES.SENT,
      waMessageId: "wamid.BASELINE.OUT.STATUS",
    });

    await withWebhookServer(repo, enabledConfig(), async (base) => {
      const res = await postWebhook(
        base,
        statusEnvelope({
          waMessageId: "wamid.BASELINE.OUT.STATUS",
          status: "delivered",
        })
      );
      assert.equal(res.status, 200);
      const msg = repo.messages.get(outbound.id)!;
      assert.equal(msg.status, MESSAGE_STATUSES.DELIVERED);
    });
  }
);

// ---------------------------------------------------------------------------
// 5. Disconnected connection behaviour unchanged
// ---------------------------------------------------------------------------

await test(
  "baseline: disconnected connection behaviour remains unchanged",
  async () => {
    await resetConnectionStoreForTests({
      wabaId: null,
      phoneNumberId: null,
      phoneNumber: null,
      accessToken: null,
      stateOverride: null,
    });

    const status = await getWhatsAppConnectionStatus();
    assert.equal(status.status, "DISCONNECTED");
    assert.equal(status.connectionMode, "COEXISTENCE");
    assert.equal(status.wabaIdMasked, null);
    assert.equal(status.phoneNumberIdMasked, null);
    assert.equal(status.phoneNumberMasked, null);
    assert.equal(status.canReconnect, true);

    const origToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_env_only_baseline";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "999000111222333";
    try {
      await resetConnectionStoreForTests();
      const envOnly = await getWhatsAppConnectionStatus();
      assert.equal(envOnly.status, "DISCONNECTED");
      assert.equal(envOnly.connectionMode, "COEXISTENCE");
      assert.equal(envOnly.wabaIdMasked, null);
    } finally {
      if (origToken !== undefined) process.env.WHATSAPP_ACCESS_TOKEN = origToken;
      else delete process.env.WHATSAPP_ACCESS_TOKEN;
      if (origPhoneId !== undefined)
        process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
      else delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    }
  }
);

// ---------------------------------------------------------------------------
// 6. CRM linking requires confirmed entity ID
// ---------------------------------------------------------------------------

await test(
  "baseline: conversation CRM linking requires a confirmed entity ID",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    seedInboxConversation(repos.store, "c_crm");
    const crm = new CRMLinkService(repos.conversations, repos.crmLinks);

    await assert.rejects(
      () =>
        crm.link("c_crm", {
          actor: staffActor(),
          linkedEntityType: "lead",
          linkedEntityId: "",
        }),
      (err: unknown) =>
        err instanceof InboxServiceError && err.code === "invalid_argument"
    );

    await assert.rejects(
      () =>
        crm.link("c_crm", {
          actor: staffActor(),
          linkedEntityType: "lead",
          linkedEntityId: CREATE_LEAD_PENDING_ENTITY_ID,
        }),
      (err: unknown) =>
        err instanceof InboxServiceError && err.code === "invalid_argument"
    );

    await assert.rejects(
      () =>
        crm.link("c_crm", {
          actor: staffActor(),
          linkedEntityType: "lead",
          linkedEntityId: `${PENDING_LEAD_PREFIX}lead_temp`,
        }),
      (err: unknown) =>
        err instanceof InboxServiceError && err.code === "invalid_argument"
    );

    const linked = await crm.link("c_crm", {
      actor: staffActor(),
      linkedEntityType: "lead",
      linkedEntityId: "lead_confirmed_baseline_1",
    });
    assert.equal(linked.linkedEntityId, "lead_confirmed_baseline_1");

    const createCrm = new CRMLinkService(repos.conversations, repos.crmLinks, {
      createLead: async () => ({ leadId: "" }),
    });
    seedInboxConversation(repos.store, "c_crm_create");
    await assert.rejects(
      () =>
        createCrm.createLeadFromConversation("c_crm_create", {
          actor: staffActor({ role: "Admin" }),
        }),
      (err: unknown) =>
        err instanceof InboxServiceError &&
        err.code === "invalid_argument" &&
        /invalid leadId/i.test(err.message)
    );
  }
);

// ---------------------------------------------------------------------------
// 7. Human-handling prevents inappropriate AI ownership
// ---------------------------------------------------------------------------

await test(
  "baseline: human handling state prevents inappropriate AI ownership",
  async () => {
    assert.deepEqual(WHATSAPP_AI_OWNERSHIP_STATES, [
      "AI_SHADOW",
      "AI_ACTIVE",
      "HUMAN_HANDLING",
      "AI_PAUSED",
    ]);

    const store = new WhatsAppInboxMemoryStore();
    const repo = new InMemoryWhatsAppInboxConversationRepository(store);
    const companyId = "sunchaser";

    store.conversations.set("c_human", {
      id: "c_human",
      companyId,
      contactId: "wct_human",
      channelId: "wch_human",
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
      conversationId: "c_human",
      expectedLockVersion: 1,
      assignedUserId: "u-sales-baseline",
      assignedAt: new Date().toISOString(),
      assignedBy: "u-admin-baseline",
      companyId,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.row.aiOwnershipState, "HUMAN_HANDLING");
      assert.notEqual(res.row.aiOwnershipState, "AI_ACTIVE");
      assert.notEqual(res.row.aiOwnershipState, "AI_SHADOW");
    }

    // Shadow engine remains non-sending even when enabled.
    const provider = new MockAiProvider();
    const engine = new AiShadowEngine({ enabled: true, provider });
    const shadow = await engine.evaluateShadow({
      conversationId: "c_human",
      messageText: "Need a quote",
    });
    assert.ok(shadow);
    assert.equal(typeof (engine as any).sendWhatsApp, "undefined");
    assert.equal(typeof (engine as any).sendOutbound, "undefined");
  }
);

// ---------------------------------------------------------------------------
// 8. Official Meta connection mode remains COEXISTENCE (incl. 8b1f827)
// ---------------------------------------------------------------------------

await test(
  "baseline: official Meta connection mode remains COEXISTENCE",
  async () => {
    await resetConnectionStoreForTests({
      wabaId: null,
      phoneNumberId: null,
      phoneNumber: null,
      accessToken: null,
      stateOverride: null,
    });
    const status = await getWhatsAppConnectionStatus();
    assert.equal(status.connectionMode, "COEXISTENCE");

    const here = path.dirname(fileURLToPath(import.meta.url));
    const embeddedSignupPath = path.join(
      here,
      "../../src/inbox/lib/metaEmbeddedSignup.ts"
    );
    const source = fs.readFileSync(embeddedSignupPath, "utf8");
    assert.match(
      source,
      /featureType:\s*"whatsapp_business_app_onboarding"/
    );
    assert.match(source, /sessionInfoVersion:\s*"3"/);
    // Deprecated Meta featureType string must not be used as the launch value.
    assert.doesNotMatch(
      source,
      /featureType:\s*"coexistence"/
    );

    const typesPath = path.join(here, "../../src/inbox/types.ts");
    const typesSrc = fs.readFileSync(typesPath, "utf8");
    assert.match(typesSrc, /connectionMode:\s*"COEXISTENCE"/);

    const servicePath = path.join(here, "whatsappConnectionService.ts");
    const serviceSrc = fs.readFileSync(servicePath, "utf8");
    assert.match(serviceSrc, /connectionMode:\s*"COEXISTENCE"/);
  }
);

// ---------------------------------------------------------------------------
// 9. Webhook signature validation remains enforced
// ---------------------------------------------------------------------------

await test(
  "baseline: webhook signature validation remains enforced",
  async () => {
    const raw = Buffer.from('{"object":"whatsapp_business_account"}', "utf8");
    assert.equal(verifyWhatsAppSignature(raw, sign(raw), APP_SECRET).ok, true);
    assert.equal(
      verifyWhatsAppSignature(raw, "sha256=" + "00".repeat(32), APP_SECRET).ok,
      false
    );
    assert.equal(verifyWhatsAppSignature(raw, undefined, APP_SECRET).ok, false);
    assert.equal(verifyWhatsAppSignature(raw, sign(raw), "").ok, false);

    const repo = new InMemoryWhatsAppRepository();
    const payload = inboundTextEnvelope({
      waMessageId: "wamid.BASELINE.SIG",
    });

    await withWebhookServer(repo, enabledConfig(), async (base) => {
      const missing = await postWebhook(base, payload, { signature: null });
      assert.equal(missing.status, 401);
      assert.equal(repo.messages.size, 0);

      const bad = await postWebhook(base, payload, {
        signature: "sha256=" + "ab".repeat(32),
      });
      assert.equal(bad.status, 401);
      assert.equal(repo.messages.size, 0);

      const good = await postWebhook(base, payload);
      assert.equal(good.status, 200);
      assert.equal(repo.messages.size, 1);
    });
  }
);

if (failed > 0) {
  console.error(`\n${failed} unified-messaging baseline test(s) failed`);
  process.exit(1);
}
console.log("\nAll unified-messaging baseline characterization tests passed.");
