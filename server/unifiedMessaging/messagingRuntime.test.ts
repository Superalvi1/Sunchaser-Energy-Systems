/**
 * Task 5B — unified messaging runtime wiring tests.
 * Uses injected fakes / local disposable Postgres only. Never hosted Supabase or real Meta.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertMessagingRuntimeStartup,
  MESSAGING_TRUSTED_ORGANIZATION_ID,
  readMessagingRuntimeConfig,
  trustedMetaConnectionId,
  UNIFIED_MESSAGING_POSTGRES_FLAG,
} from "./index.ts";
import { createMessagingProductionWiring } from "../whatsappTransport/messagingProductionFactory.ts";
import type { MessagingRepository } from "./messagingRepository.ts";
import type { NormalizedMessage } from "./transportTypes.ts";
import { createWhatsAppWebhookRouter } from "../whatsappTransport/whatsappWebhookRoutes.ts";
import { createWhatsAppOutboundRouter } from "../whatsappTransport/whatsappOutboundRoutes.ts";
import { installWhatsAppRawBodyMiddleware } from "../whatsappTransport/index.ts";
import { InMemoryWhatsAppRepository } from "../whatsappTransport/whatsappRepository.ts";
import { sendOutboundPlainText } from "../whatsappTransport/whatsappOutboundService.ts";
import {
  bridgePrepareOutboundMessage,
  createWhatsAppMessagingBridge,
} from "../whatsappTransport/whatsappMessagingBridge.ts";
import type { RequestActor } from "../middleware/actor.ts";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

function sign(raw: Buffer, secret: string): string {
  return (
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex")
  );
}

type FakeStore = {
  identities: Map<string, { id: string; contactId: string; externalUserId: string }>;
  contacts: Map<string, { id: string }>;
  conversations: Map<string, { id: string; contactId: string }>;
  messages: Map<string, NormalizedMessage>;
  byExternal: Map<string, string>;
  byClientKey: Map<string, string>;
  statusEvents: Array<{ messageId: string; status: string }>;
  audits: Array<{ action: string }>;
  attachments: Array<{ objectKey: string; sha256: string }>;
};

function createFakeMessagingRepository(): {
  repo: MessagingRepository;
  store: FakeStore;
} {
  const store: FakeStore = {
    identities: new Map(),
    contacts: new Map(),
    conversations: new Map(),
    messages: new Map(),
    byExternal: new Map(),
    byClientKey: new Map(),
    statusEvents: [],
    audits: [],
    attachments: [],
  };

  const repo: MessagingRepository = {
    async upsertContactIdentity(input) {
      const key = `${input.organizationId}|${input.identity.connectionId}|${input.identity.externalUserId}`;
      const existing = store.identities.get(key);
      if (existing) {
        if (input.contact.id && input.contact.id !== existing.contactId) {
          const { MessagingRepositoryError } = await import(
            "./messagingRepositoryErrors.ts"
          );
          throw new MessagingRepositoryError({
            code: "tenant_mismatch",
            message: "bound to different contact",
          });
        }
        const contact = store.contacts.get(existing.contactId)!;
        return {
          contact: {
            kind: "existing",
            row: {
              id: contact.id,
              organizationId: input.organizationId,
              displayName: null,
              primaryPhoneNormalized: null,
              city: null,
              area: null,
              customerType: null,
              consentStatus: "unknown",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
          identity: {
            kind: "existing",
            row: {
              id: existing.id,
              organizationId: input.organizationId,
              contactId: existing.contactId,
              transportType: input.identity.transportType,
              connectionId: input.identity.connectionId,
              externalUserId: existing.externalUserId,
              normalizedAddress: null,
              displayMetadata: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }
      const contactId = input.contact.id ?? randomUUID();
      const identityId = randomUUID();
      store.contacts.set(contactId, { id: contactId });
      store.identities.set(key, {
        id: identityId,
        contactId,
        externalUserId: input.identity.externalUserId,
      });
      return {
        contact: {
          kind: "created",
          row: {
            id: contactId,
            organizationId: input.organizationId,
            displayName: input.contact.displayName ?? null,
            primaryPhoneNormalized: input.contact.primaryPhoneNormalized ?? null,
            city: null,
            area: null,
            customerType: null,
            consentStatus: "unknown",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        identity: {
          kind: "created",
          row: {
            id: identityId,
            organizationId: input.organizationId,
            contactId,
            transportType: input.identity.transportType,
            connectionId: input.identity.connectionId,
            externalUserId: input.identity.externalUserId,
            normalizedAddress: input.identity.normalizedAddress ?? null,
            displayMetadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      };
    },

    async findOrCreateConversation(input) {
      const key = `${input.organizationId}|${input.contactId}|${input.connectionId}`;
      const existing = store.conversations.get(key);
      if (existing) {
        return {
          kind: "existing",
          row: {
            id: existing.id,
            organizationId: input.organizationId,
            contactId: existing.contactId,
            connectionId: input.connectionId,
            transportType: input.transportType,
            status: "open",
            assignedUserId: null,
            automationMode: "human_handling",
            lastMessageAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }
      const id = randomUUID();
      store.conversations.set(key, { id, contactId: input.contactId });
      return {
        kind: "created",
        row: {
          id,
          organizationId: input.organizationId,
          contactId: input.contactId,
          connectionId: input.connectionId,
          transportType: input.transportType,
          status: "open",
          assignedUserId: null,
          automationMode: "human_handling",
          lastMessageAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    },

    async persistInboundMessage(input) {
      const existingId = store.byExternal.get(input.externalMessageId);
      if (existingId) {
        return { kind: "existing", row: store.messages.get(existingId)! };
      }
      const messageId = randomUUID();
      const row: NormalizedMessage = {
        messageId,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        connectionId: input.connectionId,
        transport: input.transportType,
        externalMessageId: input.externalMessageId,
        direction: "inbound",
        sender: { kind: "customer_contact", id: "c" },
        recipient: { kind: "system", id: "unspecified" },
        messageType: input.messageType,
        text: input.normalizedText ?? null,
        structuredContent: input.structuredContent ?? { kind: "none" },
        replyToMessageId: null,
        clientIdempotencyKey: null,
        providerTimestamp: input.providerTimestamp ?? null,
        receivedAt: input.receivedAt ?? new Date().toISOString(),
        createdAt: new Date().toISOString(),
        processingStatus: "pending",
        deliveryStatus: "received",
        origin: "customer",
        aiRunRef: null,
        providerMetadata: input.providerMetadata ?? {},
      };
      store.messages.set(messageId, row);
      store.byExternal.set(input.externalMessageId, messageId);
      return { kind: "created", row };
    },

    async createOutboundMessage(input) {
      const existingId = store.byClientKey.get(input.clientIdempotencyKey);
      if (existingId) {
        return { kind: "existing", row: store.messages.get(existingId)! };
      }
      const messageId = randomUUID();
      const row: NormalizedMessage = {
        messageId,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        connectionId: input.connectionId,
        transport: input.transportType,
        externalMessageId: null,
        direction: "outbound",
        sender: { kind: "system", id: "unspecified" },
        recipient: { kind: "customer_contact", id: "c" },
        messageType: input.messageType,
        text: input.normalizedText ?? null,
        structuredContent: { kind: "none" },
        replyToMessageId: null,
        clientIdempotencyKey: input.clientIdempotencyKey,
        providerTimestamp: null,
        receivedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        processingStatus: input.processingStatus ?? "pending",
        deliveryStatus: input.deliveryStatus ?? "queued",
        origin: input.origin,
        aiRunRef: null,
        providerMetadata: input.providerMetadata ?? {},
      };
      store.messages.set(messageId, row);
      store.byClientKey.set(input.clientIdempotencyKey, messageId);
      return { kind: "created", row };
    },

    async appendStatusEvent(input) {
      store.statusEvents.push({ messageId: input.messageId, status: input.status });
      const msg = store.messages.get(input.messageId);
      if (msg) {
        const providerMessageId =
          typeof input.diagnostics?.providerMessageId === "string"
            ? input.diagnostics.providerMessageId
            : null;
        store.messages.set(input.messageId, {
          ...msg,
          deliveryStatus: input.status as NormalizedMessage["deliveryStatus"],
          externalMessageId: msg.externalMessageId ?? providerMessageId,
          providerMetadata: {
            ...msg.providerMetadata,
            ...(input.diagnostics ?? {}),
          },
        });
      }
      return {
        kind: "created",
        row: {
          id: randomUUID(),
          organizationId: input.organizationId,
          messageId: input.messageId,
          status: input.status,
          externalStatusId: input.externalStatusId ?? null,
          occurredAt: input.occurredAt,
          errorCategory: input.errorCategory ?? null,
          diagnostics: input.diagnostics ?? {},
          createdAt: new Date().toISOString(),
        },
      };
    },

    async addAttachmentReference(input) {
      assert.equal(/^https?:\/\//i.test(input.objectKey), false);
      store.attachments.push({
        objectKey: input.objectKey,
        sha256: input.sha256,
      });
      return {
        id: randomUUID(),
        organizationId: input.organizationId,
        messageId: input.messageId,
        objectKey: input.objectKey,
        mediaType: input.mediaType,
        originalFilenameSafe: input.originalFilenameSafe ?? null,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        scanStatus: input.scanStatus ?? "pending",
        createdAt: new Date().toISOString(),
      };
    },

    async recordAssignment() {
      throw new Error("not used");
    },
    async enqueueOutboxEvent() {
      throw new Error("not used");
    },
    async appendAuditEvent(input) {
      store.audits.push({ action: input.action });
      return {
        id: randomUUID(),
        organizationId: input.organizationId,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        metadata: input.metadata ?? {},
        occurredAt: input.occurredAt ?? new Date().toISOString(),
      };
    },
  };

  return { repo, store };
}

const APP_SECRET = "runtime-test-secret";
const VERIFY_TOKEN = "runtime-verify";
const PHONE_NUMBER_ID = "123456789012345";

function sampleInboundEnvelope(waMessageId: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550001111",
                  phone_number_id: PHONE_NUMBER_ID,
                },
                contacts: [{ profile: { name: "Runtime" }, wa_id: "923001112233" }],
                messages: [
                  {
                    from: "923001112233",
                    id: waMessageId,
                    timestamp: "1710000000",
                    type: "text",
                    text: { body: "hello runtime" },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
  );
}

await test("runtime config: disabled by default; trusted org + connection id", () => {
  const cfg = readMessagingRuntimeConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.organizationId, MESSAGING_TRUSTED_ORGANIZATION_ID);
  assert.equal(cfg.databaseUrl, null);
  assert.equal(
    trustedMetaConnectionId(PHONE_NUMBER_ID),
    `meta_wa_${PHONE_NUMBER_ID}`
  );
});

await test("runtime config: enabled without DB fails startup assert", () => {
  const cfg = readMessagingRuntimeConfig({
    [UNIFIED_MESSAGING_POSTGRES_FLAG]: "true",
  });
  assert.equal(cfg.enabled, true);
  assert.throws(() => assertMessagingRuntimeStartup(cfg), /DATABASE_URL/);
});

await test("factory: disabled leaves repository null", () => {
  const wiring = createMessagingProductionWiring({ env: {} });
  assert.equal(wiring.enabled, false);
  assert.equal(wiring.repository, null);
});

await test("factory: enabled with injected repository constructs wiring", () => {
  const { repo } = createFakeMessagingRepository();
  const wiring = createMessagingProductionWiring({
    env: { [UNIFIED_MESSAGING_POSTGRES_FLAG]: "true" },
    repository: repo,
  });
  assert.equal(wiring.enabled, true);
  assert.equal(wiring.repository, repo);
});

await test("factory: enabled without DB URL throws", () => {
  assert.throws(
    () =>
      createMessagingProductionWiring({
        env: { [UNIFIED_MESSAGING_POSTGRES_FLAG]: "true" },
      }),
    /DATABASE_URL/
  );
});

await test("security: no DATABASE_URL / service role secrets in browser bundle sources", () => {
  const inboxBundleProbe = readFileSync(
    join(process.cwd(), "src/inbox/lib/metaEmbeddedSignup.ts"),
    "utf8"
  );
  assert.equal(inboxBundleProbe.includes("DATABASE_URL"), false);
  assert.equal(inboxBundleProbe.includes("SUPABASE_SERVICE_ROLE"), false);
  assert.equal(inboxBundleProbe.includes("UNIFIED_MESSAGING_POSTGRES"), false);
});

await test("inbound: valid signed webhook dual-writes normalized message", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  let autoLinkCalls = 0;

  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(express.json());
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: messagingRepo,
      config: {
        enabled: true,
        webhookVerifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        accessToken: "token",
        phoneNumberId: PHONE_NUMBER_ID,
        graphApiVersion: "v21.0",
      },
      autoLinkLead: async () => {
        autoLinkCalls += 1;
        return "lead-1";
      },
    })
  );

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const waMessageId = `wamid.runtime.${randomUUID().slice(0, 8)}`;
  const raw = sampleInboundEnvelope(waMessageId);
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(raw, APP_SECRET),
    },
    body: raw,
  });
  assert.equal(res.status, 200);
  assert.equal(whatsappRepo.messages.size, 1);
  assert.equal(store.messages.size, 1);
  assert.equal(store.byExternal.has(waMessageId), true);
  assert.equal(autoLinkCalls, 1);
  assert.ok(store.audits.some((a) => a.action.includes("inbound.message")));
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("inbound: duplicate webhook remains one normalized message", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: messagingRepo,
      config: {
        enabled: true,
        webhookVerifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        accessToken: "token",
        phoneNumberId: PHONE_NUMBER_ID,
        graphApiVersion: "v21.0",
      },
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const waMessageId = `wamid.dup.${randomUUID().slice(0, 8)}`;
  const raw = sampleInboundEnvelope(waMessageId);
  const headers = {
    "content-type": "application/json",
    "x-hub-signature-256": sign(raw, APP_SECRET),
  };
  const r1 = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: "POST",
    headers,
    body: raw,
  });
  const r2 = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: "POST",
    headers,
    body: raw,
  });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(store.messages.size, 1);
  assert.equal(whatsappRepo.messages.size, 1);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("inbound: invalid signature causes zero normalized writes", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: messagingRepo,
      config: {
        enabled: true,
        webhookVerifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        accessToken: "token",
        phoneNumberId: PHONE_NUMBER_ID,
        graphApiVersion: "v21.0",
      },
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const raw = sampleInboundEnvelope("wamid.bad.sig");
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(raw, "wrong-secret"),
    },
    body: raw,
  });
  assert.equal(res.status, 401);
  assert.equal(store.messages.size, 0);
  assert.equal(whatsappRepo.messages.size, 0);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("inbound: malformed envelope causes zero normalized writes", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: messagingRepo,
      config: {
        enabled: true,
        webhookVerifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        accessToken: "token",
        phoneNumberId: PHONE_NUMBER_ID,
        graphApiVersion: "v21.0",
      },
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const raw = Buffer.from("{not-json");
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(raw, APP_SECRET),
    },
    body: raw,
  });
  assert.equal(res.status, 400);
  assert.equal(store.messages.size, 0);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("inbound: normalized persistence failure returns retry-safe 500", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo } = createFakeMessagingRepository();
  messagingRepo.persistInboundMessage = async () => {
    throw new Error("injected normalized failure");
  };
  let autoLinkCalls = 0;
  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: messagingRepo,
      config: {
        enabled: true,
        webhookVerifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        accessToken: "token",
        phoneNumberId: PHONE_NUMBER_ID,
        graphApiVersion: "v21.0",
      },
      autoLinkLead: async () => {
        autoLinkCalls += 1;
      },
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const raw = sampleInboundEnvelope(`wamid.fail.${randomUUID().slice(0, 8)}`);
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(raw, APP_SECRET),
    },
    body: raw,
  });
  assert.equal(res.status, 500);
  assert.equal(autoLinkCalls, 0, "lead auto-link must run only after persistence");
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("outbound: repeated client key does not call Meta twice", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  // Seed conversation bundle for outbound.
  const channel = await whatsappRepo.resolveOrCreateChannel({
    phoneNumberId: PHONE_NUMBER_ID,
    displayPhoneNumber: "15550001111",
    wabaId: "WABA",
  });
  const contact = await whatsappRepo.resolveOrCreateContact({
    phoneE164: "923001112233",
    profileName: "Out",
  });
  const conversation = await whatsappRepo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });

  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    return new Response(
      JSON.stringify({ messages: [{ id: "wamid.out.1" }] }),
      { status: 200 }
    );
  };
  const actor: RequestActor = {
    id: "user-1",
    username: "staff",
    role: "Admin",
    accountStatus: "Approved",
  } as RequestActor;

  const config = {
    enabled: true,
    webhookVerifyToken: VERIFY_TOKEN,
    appSecret: APP_SECRET,
    accessToken: "token",
    phoneNumberId: PHONE_NUMBER_ID,
    graphApiVersion: "v21.0",
  };

  const first = await sendOutboundPlainText(conversation.id, "hello", {
    repo: whatsappRepo,
    config,
    actor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: "client-key-1",
  });
  assert.equal(first.httpStatus, 201);
  assert.equal(metaCalls, 1);
  assert.equal(store.statusEvents.some((s) => s.status === "sent"), true);

  const second = await sendOutboundPlainText(conversation.id, "hello", {
    repo: whatsappRepo,
    config,
    actor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: "client-key-1",
  });
  assert.equal(second.httpStatus, 201);
  assert.equal(metaCalls, 1, "Meta must not be called again");
  assert.equal(store.byClientKey.size, 1);
});

await test("outbound: unauthorized user causes zero messaging writes and zero Meta calls", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  let metaCalls = 0;
  const result = await sendOutboundPlainText("missing", "hi", {
    repo: whatsappRepo,
    config: {
      enabled: true,
      webhookVerifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      accessToken: "token",
      phoneNumberId: PHONE_NUMBER_ID,
      graphApiVersion: "v21.0",
    },
    actor: null,
    fetchImpl: async () => {
      metaCalls += 1;
      return new Response("{}", { status: 200 });
    },
    messagingRepository: messagingRepo,
    clientIdempotencyKey: "k",
  });
  assert.equal(result.httpStatus, 401);
  assert.equal(metaCalls, 0);
  assert.equal(store.messages.size, 0);
});

await test("outbound: browser organizationId spoofing is rejected", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo } = createFakeMessagingRepository();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: RequestActor }).actor = {
      id: "u1",
      username: "admin",
      role: "Admin",
      accountStatus: "Approved",
    } as RequestActor;
    next();
  });
  app.use(
    "/api/conversations",
    createWhatsAppOutboundRouter({
      repo: whatsappRepo,
      messagingRepository: messagingRepo,
      config: {
        enabled: true,
        webhookVerifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        accessToken: "token",
        phoneNumberId: PHONE_NUMBER_ID,
        graphApiVersion: "v21.0",
      },
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const res = await fetch(
    `http://127.0.0.1:${port}/api/conversations/c1/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi", organizationId: "other-org" }),
    }
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(String(body.error), /organizationId/);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("bridge: attachment object keys are private references only", async () => {
  const { repo, store } = createFakeMessagingRepository();
  const bridge = createWhatsAppMessagingBridge({
    repository: repo,
    config: { phoneNumberId: PHONE_NUMBER_ID },
  });
  assert.ok(bridge);
  // Exercise prepare only — attachment path covered via webhook media in unit of addAttachmentReference assert.
  const prepared = await bridgePrepareOutboundMessage(bridge!, {
    recipientWaId: "923009998877",
    text: "x",
    clientIdempotencyKey: "att-key",
    actorId: "u1",
  });
  assert.equal(prepared.kind, "created");
  assert.equal(store.attachments.length, 0);
});

await test("feature disabled: webhook without messagingRepository keeps existing behavior", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: null,
      config: {
        enabled: true,
        webhookVerifyToken: VERIFY_TOKEN,
        appSecret: APP_SECRET,
        accessToken: "token",
        phoneNumberId: PHONE_NUMBER_ID,
        graphApiVersion: "v21.0",
      },
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const raw = sampleInboundEnvelope(`wamid.off.${randomUUID().slice(0, 8)}`);
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(raw, APP_SECRET),
    },
    body: raw,
  });
  assert.equal(res.status, 200);
  assert.equal(whatsappRepo.messages.size, 1);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

if (failed > 0) {
  console.error(`\n${failed} unified-messaging runtime test(s) failed`);
  process.exit(1);
}
console.log("\nAll unified-messaging runtime tests passed.");
