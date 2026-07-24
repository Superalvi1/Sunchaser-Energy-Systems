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
  bridgePersistInboundMessage,
  bridgePersistInboundStatus,
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
  outboundMeta: Map<
    string,
    {
      recipientIdentityId: string | null;
      conversationId: string;
      connectionId: string;
      transportType: string;
      organizationId: string;
      normalizedText: string | null;
    }
  >;
  byExternal: Map<string, string>;
  byClientKey: Map<string, string>;
  statusEvents: Array<{ messageId: string; status: string; externalStatusId?: string }>;
  audits: Array<{ action: string; idempotencyKey?: string; id: string }>;
  attachments: Array<{
    id: string;
    messageId: string;
    objectKey: string;
    sha256: string;
  }>;
};

type FakeRepoOptions = {
  beforeOutboundClaim?: (sql: string) => Promise<void>;
  failAppendStatusOnce?: { remaining: number };
};

function deliveryRank(status: string): number {
  switch (status) {
    case "queued":
      return 0;
    case "sending":
      return 1;
    case "received":
    case "sent":
      return 2;
    case "delivered":
      return 3;
    case "read":
      return 4;
    case "failed":
      return 100;
    default:
      return -1;
  }
}

/** Barrier that releases only after N matching claim attempts have arrived. */
function createClaimBarrier(
  parties = 2
): (sql: string) => Promise<void> {
  let waiting: Array<() => void> = [];
  return async (_sql: string) => {
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length >= parties) {
        const ready = waiting;
        waiting = [];
        for (const r of ready) r();
      }
    });
  };
}

function createFakeMessagingRepository(options: FakeRepoOptions = {}): {
  repo: MessagingRepository;
  store: FakeStore;
} {
  const store: FakeStore = {
    identities: new Map(),
    contacts: new Map(),
    conversations: new Map(),
    messages: new Map(),
    outboundMeta: new Map(),
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
        const existing = store.messages.get(existingId)!;
        const meta = store.outboundMeta.get(existingId)!;
        if (
          meta.organizationId !== input.organizationId ||
          meta.conversationId !== input.conversationId ||
          meta.connectionId !== input.connectionId ||
          meta.transportType !== input.transportType ||
          (meta.normalizedText ?? null) !== (input.normalizedText ?? null) ||
          (meta.recipientIdentityId ?? null) !==
            (input.recipientIdentityId ?? null)
        ) {
          const { MessagingRepositoryError } = await import(
            "./messagingRepositoryErrors.ts"
          );
          throw new MessagingRepositoryError({
            code: "invalid_input",
            message:
              "Idempotency key reused with different outbound request content",
            detail: "idempotency_conflict",
          });
        }
        return { kind: "existing", row: existing };
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
      store.outboundMeta.set(messageId, {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        connectionId: input.connectionId,
        transportType: input.transportType,
        normalizedText: input.normalizedText ?? null,
        recipientIdentityId: input.recipientIdentityId ?? null,
      });
      return { kind: "created", row };
    },

    async claimOutboundMessageForSend(input) {
      if (options.beforeOutboundClaim) {
        await options.beforeOutboundClaim("UPDATE messaging_messages claim");
      }
      // CAS is synchronous after the barrier so only one concurrent waiter wins.
      const current = store.messages.get(input.messageId);
      if (!current || current.direction !== "outbound") {
        const { MessagingRepositoryError } = await import(
          "./messagingRepositoryErrors.ts"
        );
        throw new MessagingRepositoryError({
          code: "not_found",
          message: "Outbound message not found for send claim",
        });
      }
      if (
        current.processingStatus === "pending" &&
        current.deliveryStatus === "queued"
      ) {
        const claimed: NormalizedMessage = {
          ...current,
          processingStatus: "processing",
          deliveryStatus: "sending",
        };
        store.messages.set(input.messageId, claimed);
        return { kind: "claimed", row: claimed };
      }
      if (
        current.deliveryStatus === "sent" ||
        current.deliveryStatus === "delivered" ||
        current.deliveryStatus === "read"
      ) {
        return { kind: "completed", row: current };
      }
      if (
        current.deliveryStatus === "sending" ||
        current.processingStatus === "processing"
      ) {
        return { kind: "in_flight", row: current };
      }
      return { kind: "terminal", row: current };
    },

    async bindOutboundLegacyMessageId(input) {
      const msg = store.messages.get(input.messageId);
      if (!msg || msg.organizationId !== input.organizationId) {
        const { MessagingRepositoryError } = await import(
          "./messagingRepositoryErrors.ts"
        );
        throw new MessagingRepositoryError({
          code: "not_found",
          message: "Outbound message not found for legacy binding",
        });
      }
      const updated: NormalizedMessage = {
        ...msg,
        providerMetadata: {
          ...msg.providerMetadata,
          whatsappMessageId: input.whatsappMessageId,
        },
      };
      store.messages.set(input.messageId, updated);
      return updated;
    },

    async findMessageByExternalId(input) {
      const id = store.byExternal.get(input.externalMessageId);
      if (!id) return null;
      const msg = store.messages.get(id);
      if (
        !msg ||
        msg.organizationId !== input.organizationId ||
        msg.connectionId !== input.connectionId ||
        msg.transport !== input.transportType
      ) {
        return null;
      }
      return msg;
    },

    async appendStatusEvent(input) {
      if (options.failAppendStatusOnce && options.failAppendStatusOnce.remaining > 0) {
        options.failAppendStatusOnce.remaining -= 1;
        throw new Error("injected status persist failure");
      }
      const externalStatusId = input.externalStatusId ?? undefined;
      if (
        externalStatusId &&
        store.statusEvents.some(
          (e) =>
            e.messageId === input.messageId &&
            e.externalStatusId === externalStatusId
        )
      ) {
        return {
          kind: "existing",
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
      }
      store.statusEvents.push({
        messageId: input.messageId,
        status: input.status,
        externalStatusId,
      });
      const msg = store.messages.get(input.messageId);
      if (msg) {
        const providerMessageId =
          typeof input.diagnostics?.providerMessageId === "string"
            ? input.diagnostics.providerMessageId
            : null;
        const incoming = deliveryRank(input.status);
        const current = deliveryRank(msg.deliveryStatus);
        let nextDelivery = msg.deliveryStatus;
        if (msg.deliveryStatus !== "failed" && incoming >= 0 && incoming > current) {
          nextDelivery = input.status as NormalizedMessage["deliveryStatus"];
        }
        const updated: NormalizedMessage = {
          ...msg,
          deliveryStatus: nextDelivery,
          processingStatus:
            input.status === "sent" ||
            input.status === "delivered" ||
            input.status === "read" ||
            input.status === "failed"
              ? "processed"
              : msg.processingStatus,
          externalMessageId: msg.externalMessageId ?? providerMessageId,
          providerMetadata: {
            ...msg.providerMetadata,
            ...(input.diagnostics ?? {}),
          },
        };
        store.messages.set(input.messageId, updated);
        if (updated.externalMessageId) {
          store.byExternal.set(updated.externalMessageId, input.messageId);
        }
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
      const existing = store.attachments.find(
        (a) =>
          a.messageId === input.messageId &&
          a.sha256 === input.sha256 &&
          a.objectKey === input.objectKey
      );
      if (existing) {
        return {
          id: existing.id,
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
      }
      const id = randomUUID();
      store.attachments.push({
        id,
        messageId: input.messageId,
        objectKey: input.objectKey,
        sha256: input.sha256,
      });
      return {
        id,
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
      const idempotencyKey =
        typeof input.metadata?.idempotencyKey === "string"
          ? input.metadata.idempotencyKey.trim()
          : "";
      if (idempotencyKey) {
        const existing = store.audits.find(
          (a) =>
            a.action === input.action && a.idempotencyKey === idempotencyKey
        );
        if (existing) {
          return {
            id: existing.id,
            organizationId: input.organizationId,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId ?? null,
            metadata: input.metadata ?? {},
            occurredAt: input.occurredAt ?? new Date().toISOString(),
          };
        }
      }
      const id = randomUUID();
      store.audits.push({
        id,
        action: input.action,
        idempotencyKey: idempotencyKey || undefined,
      });
      return {
        id,
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

async function seedOutboundConversation(whatsappRepo: InMemoryWhatsAppRepository) {
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
  return { channel, contact, conversation };
}

const adminActor: RequestActor = {
  id: "user-1",
  username: "staff",
  role: "Admin",
  accountStatus: "Approved",
} as RequestActor;

const baseConfig = {
  enabled: true,
  webhookVerifyToken: VERIFY_TOKEN,
  appSecret: APP_SECRET,
  accessToken: "token",
  phoneNumberId: PHONE_NUMBER_ID,
  graphApiVersion: "v21.0",
};

function sampleStatusEnvelope(
  waMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  timestamp: string
): Buffer {
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
                statuses: [
                  {
                    id: waMessageId,
                    status,
                    timestamp,
                    recipient_id: "923001112233",
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

await test("1. concurrent same key: exactly one Meta call (claim barrier)", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  const barrier = createClaimBarrier(2);
  const { repo: messagingRepo, store } = createFakeMessagingRepository({
    beforeOutboundClaim: barrier,
  });
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    return new Response(
      JSON.stringify({ messages: [{ id: "wamid.concurrent.1" }] }),
      { status: 200 }
    );
  };
  const key = `concurrent-key-${randomUUID().slice(0, 8)}`;
  const [a, b] = await Promise.all([
    sendOutboundPlainText(conversation.id, "hello concurrent", {
      repo: whatsappRepo,
      config: baseConfig,
      actor: adminActor,
      fetchImpl,
      messagingRepository: messagingRepo,
      clientIdempotencyKey: key,
    }),
    sendOutboundPlainText(conversation.id, "hello concurrent", {
      repo: whatsappRepo,
      config: baseConfig,
      actor: adminActor,
      fetchImpl,
      messagingRepository: messagingRepo,
      clientIdempotencyKey: key,
    }),
  ]);
  assert.equal(metaCalls, 1, "exactly one Meta call");
  assert.equal(whatsappRepo.messages.size, 1, "exactly one legacy outbound row");
  assert.equal(store.byClientKey.size, 1);
  const statuses = [a.httpStatus, b.httpStatus].sort();
  assert.deepEqual(statuses, [201, 202]);
});

await test("2. same key while first is sending: zero second Meta call", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  const { repo: messagingRepo } = createFakeMessagingRepository();
  let metaCalls = 0;
  let releaseMeta!: () => void;
  const metaGate = new Promise<void>((resolve) => {
    releaseMeta = resolve;
  });
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    await metaGate;
    return new Response(
      JSON.stringify({ messages: [{ id: "wamid.inflight.1" }] }),
      { status: 200 }
    );
  };
  const key = `inflight-key-${randomUUID().slice(0, 8)}`;
  const firstPromise = sendOutboundPlainText(conversation.id, "hello inflight", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  for (let i = 0; i < 50 && metaCalls === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(metaCalls, 1);
  const second = await sendOutboundPlainText(conversation.id, "hello inflight", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(second.httpStatus, 202);
  assert.equal(metaCalls, 1, "second request must not call Meta");
  releaseMeta();
  const first = await firstPromise;
  assert.equal(first.httpStatus, 201);
  assert.equal(metaCalls, 1);
});

await test("3. accepted-status persistence failure: replay does not resend", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  const { repo: messagingRepo } = createFakeMessagingRepository({
    failAppendStatusOnce: { remaining: 1 },
  });
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    return new Response(
      JSON.stringify({ messages: [{ id: "wamid.accept.fail" }] }),
      { status: 200 }
    );
  };
  const key = `accept-fail-${randomUUID().slice(0, 8)}`;
  const first = await sendOutboundPlainText(conversation.id, "hello accept", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(first.httpStatus, 201);
  assert.equal(metaCalls, 1);
  const second = await sendOutboundPlainText(conversation.id, "hello accept", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(second.httpStatus, 202);
  assert.equal(metaCalls, 1, "replay must not resend after uncertain accept");
});

await test("4. timeout replay: does not resend", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  const { repo: messagingRepo } = createFakeMessagingRepository();
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    const err = new Error("AbortError");
    err.name = "AbortError";
    throw err;
  };
  const key = `timeout-key-${randomUUID().slice(0, 8)}`;
  const first = await sendOutboundPlainText(conversation.id, "hello timeout", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.ok(first.httpStatus === 504 || first.httpStatus === 502);
  assert.equal(metaCalls, 1);
  const second = await sendOutboundPlainText(conversation.id, "hello timeout", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(second.httpStatus, 409);
  assert.equal(metaCalls, 1);
});

await test("5. provider-rejected replay: does not resend", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  const { repo: messagingRepo } = createFakeMessagingRepository();
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    return new Response(JSON.stringify({ error: { message: "rejected" } }), {
      status: 400,
    });
  };
  const key = `reject-key-${randomUUID().slice(0, 8)}`;
  const first = await sendOutboundPlainText(conversation.id, "hello reject", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.ok(first.httpStatus >= 400);
  assert.equal(metaCalls, 1);
  const second = await sendOutboundPlainText(conversation.id, "hello reject", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(second.httpStatus, 409);
  assert.equal(metaCalls, 1);
});

await test("6. same key different text: 409, zero extra Meta calls", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  const { repo: messagingRepo } = createFakeMessagingRepository();
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    return new Response(
      JSON.stringify({ messages: [{ id: "wamid.text.mismatch" }] }),
      { status: 200 }
    );
  };
  const key = `text-mismatch-${randomUUID().slice(0, 8)}`;
  const first = await sendOutboundPlainText(conversation.id, "text-a", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(first.httpStatus, 201);
  assert.equal(metaCalls, 1);
  const second = await sendOutboundPlainText(conversation.id, "text-b", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(second.httpStatus, 409);
  assert.equal(metaCalls, 1);
});

await test("7. same key different recipient/conversation: 409", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation: c1 } = await seedOutboundConversation(whatsappRepo);
  const contact2 = await whatsappRepo.resolveOrCreateContact({
    phoneE164: "923009998877",
    profileName: "Other",
  });
  const channel = [...whatsappRepo.channels.values()][0]!;
  const c2 = await whatsappRepo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact2.id,
  });
  const { repo: messagingRepo } = createFakeMessagingRepository();
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    return new Response(
      JSON.stringify({ messages: [{ id: "wamid.recip.mismatch" }] }),
      { status: 200 }
    );
  };
  const key = `recip-mismatch-${randomUUID().slice(0, 8)}`;
  const first = await sendOutboundPlainText(c1.id, "shared text", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(first.httpStatus, 201);
  const second = await sendOutboundPlainText(c2.id, "shared text", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(second.httpStatus, 409);
  assert.equal(metaCalls, 1);
});

await test("8. completed replay returns Inbox-compatible whatsapp_* id", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  const { repo: messagingRepo } = createFakeMessagingRepository();
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    return new Response(
      JSON.stringify({ messages: [{ id: "wamid.inbox.compat" }] }),
      { status: 200 }
    );
  };
  const key = `inbox-id-${randomUUID().slice(0, 8)}`;
  const first = await sendOutboundPlainText(conversation.id, "hello inbox", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(first.httpStatus, 201);
  assert.ok("messageId" in first);
  const legacyId = first.messageId;
  assert.ok(whatsappRepo.messages.has(legacyId));
  const second = await sendOutboundPlainText(conversation.id, "hello inbox", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: key,
  });
  assert.equal(second.httpStatus, 201);
  assert.ok("messageId" in second);
  assert.equal(second.messageId, legacyId);
  assert.equal(metaCalls, 1);
  assert.equal(whatsappRepo.messages.size, 1);
});

await test("9. separate delivered/read webhook updates normalized message", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  const providerId = `wamid.status.${randomUUID().slice(0, 8)}`;
  const first = await sendOutboundPlainText(conversation.id, "status track", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl: async () =>
      new Response(JSON.stringify({ messages: [{ id: providerId }] }), {
        status: 200,
      }),
    messagingRepository: messagingRepo,
    clientIdempotencyKey: `status-${randomUUID().slice(0, 8)}`,
  });
  assert.equal(first.httpStatus, 201);

  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: messagingRepo,
      config: baseConfig,
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  for (const [status, ts] of [
    ["delivered", "1710000100"],
    ["read", "1710000200"],
  ] as const) {
    const raw = sampleStatusEnvelope(providerId, status, ts);
    const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(raw, APP_SECRET),
      },
      body: raw,
    });
    assert.equal(res.status, 200);
  }
  const msg = [...store.messages.values()].find(
    (m) => m.externalMessageId === providerId
  );
  assert.ok(msg);
  assert.equal(msg.deliveryStatus, "read");
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("10. delayed sent event cannot downgrade read/delivered", async () => {
  const { repo, store } = createFakeMessagingRepository();
  const bridge = createWhatsAppMessagingBridge({
    repository: repo,
    config: { phoneNumberId: PHONE_NUMBER_ID },
  })!;
  const prepared = await bridgePrepareOutboundMessage(bridge, {
    recipientWaId: "923001112233",
    text: "mono",
    clientIdempotencyKey: `mono-${randomUUID().slice(0, 8)}`,
    actorId: "u1",
  });
  await repo.appendStatusEvent({
    organizationId: MESSAGING_TRUSTED_ORGANIZATION_ID,
    messageId: prepared.message.messageId,
    status: "read",
    externalStatusId: "ext-read",
    occurredAt: new Date().toISOString(),
    diagnostics: { providerMessageId: "wamid.mono.1" },
  });
  await bridgePersistInboundStatus(
    bridge,
    {
      kind: "status",
      phoneNumberId: PHONE_NUMBER_ID,
      displayPhoneNumber: "15550001111",
      wabaEntryId: "WABA",
      waMessageId: "wamid.mono.1",
      status: "sent",
      statusTimestamp: "1710000000",
      recipientWaId: "923001112233",
      rawEvent: {},
    },
    null
  );
  const msg = store.messages.get(prepared.message.messageId)!;
  assert.equal(msg.deliveryStatus, "read");
});

await test("11. attachment failure then retry recovers exactly one attachment", async () => {
  const { repo, store } = createFakeMessagingRepository();
  const bridge = createWhatsAppMessagingBridge({
    repository: repo,
    config: { phoneNumberId: PHONE_NUMBER_ID },
  })!;
  const event = {
    kind: "inbound_message" as const,
    phoneNumberId: PHONE_NUMBER_ID,
    displayPhoneNumber: "15550001111",
    wabaEntryId: "WABA",
    fromWaId: "923001112233",
    waMessageId: `wamid.att.${randomUUID().slice(0, 8)}`,
    occurredAt: "2024-01-01T00:00:00.000Z",
    profileName: "Att",
    messageType: "image",
    metaMediaId: "media-1",
    mimeType: "image/jpeg",
    sha256: "a".repeat(64),
    filename: "x.jpg",
    textBody: null as string | null,
    caption: null as string | null,
    voice: false,
    latitude: null as number | null,
    longitude: null as number | null,
    address: null as string | null,
    placeName: null as string | null,
    rawEvent: {},
  };
  let failOnce = true;
  const original = repo.addAttachmentReference.bind(repo);
  repo.addAttachmentReference = async (input) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("injected attachment failure");
    }
    return original(input);
  };
  await assert.rejects(() => bridgePersistInboundMessage(bridge, event));
  assert.equal(store.attachments.length, 0);
  assert.equal(store.messages.size, 1);
  await bridgePersistInboundMessage(bridge, event);
  assert.equal(store.attachments.length, 1);
  await bridgePersistInboundMessage(bridge, event);
  assert.equal(store.attachments.length, 1);
});

await test("12. duplicate inbound delivery does not duplicate audit action", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: messagingRepo,
      config: baseConfig,
    })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const waMessageId = `wamid.audit.${randomUUID().slice(0, 8)}`;
  const raw = sampleInboundEnvelope(waMessageId);
  const headers = {
    "content-type": "application/json",
    "x-hub-signature-256": sign(raw, APP_SECRET),
  };
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${port}/api/whatsapp/webhook`, {
        method: "POST",
        headers,
        body: raw,
      })
    ).status,
    200
  );
  const bridge = createWhatsAppMessagingBridge({
    repository: messagingRepo,
    config: { phoneNumberId: PHONE_NUMBER_ID },
  })!;
  await bridgePersistInboundMessage(bridge, {
    kind: "inbound_text",
    phoneNumberId: PHONE_NUMBER_ID,
    displayPhoneNumber: "15550001111",
    wabaEntryId: "WABA",
    fromWaId: "923001112233",
    waMessageId,
    text: "hello runtime",
    occurredAt: "2024-01-01T00:00:00.000Z",
    profileName: "Runtime",
    rawEvent: {},
  });
  const inboundAudits = store.audits.filter(
    (a) => a.action === "inbound.message.persisted"
  );
  assert.equal(inboundAudits.length, 1);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("13. feature disabled preserves existing behavior", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedOutboundConversation(whatsappRepo);
  let metaCalls = 0;
  const first = await sendOutboundPlainText(conversation.id, "legacy only", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: adminActor,
    fetchImpl: async () => {
      metaCalls += 1;
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.legacy.1" }] }),
        { status: 200 }
      );
    },
    messagingRepository: null,
    clientIdempotencyKey: "ignored-when-disabled",
  });
  assert.equal(first.httpStatus, 201);
  assert.equal(metaCalls, 1);
  assert.equal(whatsappRepo.messages.size, 1);

  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(
    "/api/whatsapp",
    createWhatsAppWebhookRouter({
      repo: whatsappRepo,
      messagingRepository: null,
      config: baseConfig,
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
  assert.equal(whatsappRepo.messages.size, 2);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

await test("14. unauthorized/cross-tenant requests: zero writes and Meta calls", async () => {
  const whatsappRepo = new InMemoryWhatsAppRepository();
  const { repo: messagingRepo, store } = createFakeMessagingRepository();
  let metaCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    metaCalls += 1;
    return new Response("{}", { status: 200 });
  };
  const unauth = await sendOutboundPlainText("missing", "hi", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: null,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: "k-unauth",
  });
  assert.equal(unauth.httpStatus, 401);
  assert.equal(metaCalls, 0);
  assert.equal(store.messages.size, 0);

  const forbidden = await sendOutboundPlainText("missing", "hi", {
    repo: whatsappRepo,
    config: baseConfig,
    actor: {
      id: "viewer",
      username: "v",
      role: "Customer",
      accountStatus: "Approved",
    } as RequestActor,
    fetchImpl,
    messagingRepository: messagingRepo,
    clientIdempotencyKey: "k-forbidden",
  });
  assert.equal(forbidden.httpStatus, 403);
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
      config: baseConfig,
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
  const prepared = await bridgePrepareOutboundMessage(bridge!, {
    recipientWaId: "923009998877",
    text: "x",
    clientIdempotencyKey: "att-key",
    actorId: "u1",
  });
  assert.equal(prepared.kind, "created");
  assert.equal(store.attachments.length, 0);
});

if (failed > 0) {
  console.error(`\n${failed} unified-messaging runtime test(s) failed`);
  process.exit(1);
}
console.log("\nAll unified-messaging runtime tests passed.");
