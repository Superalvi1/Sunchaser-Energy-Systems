/**
 * WHATSAPP-LIVE-01 server proofs:
 * - unread/read watermark on conversation DTOs
 * - inbound persists while CRM UI closed
 * - no auto-reply / no outbound / no LID-as-phone
 * - AI draft config booleans only
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestActor } from "../middleware/actor.ts";
import {
  persistWhatsAppWebInbound,
  WhatsAppLidPhoneMap,
  getWhatsAppWebInboundDiagnostics,
  __resetWhatsAppWebInboundDiagnostics,
  getSharedWhatsAppLidPhoneMap,
  __resetSharedWhatsAppLidPhoneMap,
} from "../whatsappWeb/index.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import { createInMemoryWhatsAppInboxRepositories } from "./whatsappInboxRepository.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import type { InboxMessageRef } from "./whatsappInboxRepoSupport.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import { readAiDraftConfig } from "./aiDraft/aiDraftConfig.ts";
import { readQueryAgentConfig } from "./aiQueryAgent/queryAgentConfig.ts";

function seedConversation(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<WhatsAppConversationInbox, "id"> &
    Partial<WhatsAppConversationInbox>
): void {
  const now = partial.updatedAt ?? "2026-07-19T10:00:00.000Z";
  store.conversations.set(partial.id, {
    id: partial.id,
    companyId: "sunchaser",
    channelId: "wch_1",
    contactId: `wct_${partial.id}`,
    status: "open",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: 1,
    hasFailedMessage: false,
    ...partial,
  });
}

function seedMessage(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<InboxMessageRef, "id" | "conversationId" | "direction"> &
    Partial<InboxMessageRef>
): void {
  store.messages.set(partial.id, {
    id: partial.id,
    companyId: "sunchaser",
    conversationId: partial.conversationId,
    direction: partial.direction,
    status: partial.status ?? "received",
    textBody: partial.textBody ?? "hi",
    createdAt: partial.createdAt ?? "2026-07-19T10:00:00.000Z",
    occurredAt:
      partial.occurredAt ?? partial.createdAt ?? "2026-07-19T10:00:00.000Z",
    ...partial,
  });
}

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

function actor(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    id: "user_sales_1",
    username: "sales1",
    name: "Sales One",
    email: "sales1@example.com",
    role: "Sales Executive",
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const controllersSrc = readFileSync(
  join(here, "whatsappInboxControllers.ts"),
  "utf8"
);
const routesSrc = readFileSync(join(here, "whatsappInboxRoutes.ts"), "utf8");
const inboundSrc = readFileSync(
  join(here, "../whatsappWeb/whatsappWebInbound.ts"),
  "utf8"
);

await test("incoming message while CRM is closed persists and is listable", async () => {
  __resetWhatsAppWebInboundDiagnostics();
  const repo = new InMemoryWhatsAppRepository();
  // Simulate CRM closed: no browser hooks — only backend persist.
  const stored = await persistWhatsAppWebInbound(
    {
      providerMessageId: "LIVE01_CLOSED_1",
      remoteJid: "923001112233@s.whatsapp.net",
      fromMe: false,
      text: "Quote while CRM closed",
      pushName: "Customer",
      occurredAt: "2026-07-26T15:00:00.000Z",
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "conversation",
    },
    { repo }
  );
  assert.equal(stored.kind, "stored");
  if (stored.kind !== "stored") return;
  const bundle = await repo.getConversationBundle(stored.conversationId);
  assert.ok(bundle, "conversation exists after CRM-closed persist");
  assert.ok(await repo.findMessageIdByWaMessageId("LIVE01_CLOSED_1"));
  const diag = getWhatsAppWebInboundDiagnostics();
  assert.ok(diag.lastInboundStoredAt);
  assert.equal(diag.lastPersistFailureCode, null);
});

await test("server-backed unread flips after mark-read and later inbound", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const services = createWhatsAppInboxServices(repos);
  const a = actor();
  const conversationId = "c_live01_unread";
  const now = "2026-07-26T15:00:00.000Z";
  seedConversation(repos.store, { id: conversationId, lastMessageAt: now });
  seedMessage(repos.store, {
    id: "m_in_1",
    conversationId,
    direction: "inbound",
    createdAt: now,
  });

  assert.equal(await services.readState.hasUnread(conversationId, a), true);
  assert.ok((await services.readState.getUnreadCount(conversationId, a)) >= 1);

  await services.readState.resolveAndAdvance(conversationId, {
    actor: a,
    lastSeenMessageId: "m_in_1",
    lastSeenMessageCreatedAt: now,
  });
  assert.equal(await services.readState.hasUnread(conversationId, a), false);

  const later = "2026-07-26T15:05:00.000Z";
  seedMessage(repos.store, {
    id: "m_in_2",
    conversationId,
    direction: "inbound",
    createdAt: later,
  });
  assert.equal(await services.readState.hasUnread(conversationId, a), true);
});

await test("list/delta controllers enrich unread fields", () => {
  assert.ok(controllersSrc.includes("enrichConversationsWithUnread"));
  assert.ok(controllersSrc.includes("isUnread"));
  assert.ok(controllersSrc.includes("unreadCount"));
  assert.ok(controllersSrc.includes("getAiDraftConfigStatus"));
  assert.ok(routesSrc.includes('/ai-draft/config'));
});

await test("AI draft config reports auto-reply false by default", () => {
  const draft = readAiDraftConfig({
    WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
    WHATSAPP_AI_AUTO_REPLY_ENABLED: "false",
  });
  assert.equal(draft.autoReplyEnabled, false);
  const query = readQueryAgentConfig({
    WHATSAPP_AI_AUTO_REPLY_ENABLED: "false",
  });
  assert.equal(query.autoReplyEnabled, false);
});

await test("no outbound send in inbound persist path", () => {
  assert.equal(inboundSrc.includes("sendWhatsAppWebPlainText"), false);
  assert.equal(inboundSrc.includes("insertOutboundMessage"), false);
  assert.ok(inboundSrc.includes("evaluateShadow"));
});

await test("shared LID map still required; unresolved @lid never becomes phone", async () => {
  __resetSharedWhatsAppLidPhoneMap();
  const lidDigits = "123456789012345";
  const repo = new InMemoryWhatsAppRepository();
  const ignored = await persistWhatsAppWebInbound(
    {
      providerMessageId: "LIVE01_LID_BAD",
      remoteJid: `${lidDigits}@lid`,
      fromMe: false,
      text: "orphan",
      pushName: null,
      occurredAt: new Date().toISOString(),
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "conversation",
    },
    { repo, lidMap: new WhatsAppLidPhoneMap() }
  );
  assert.equal(ignored.kind, "ignored");
  if (ignored.kind === "ignored") assert.equal(ignored.reason, "bad_jid");
  assert.equal(await repo.findMessageIdByWaMessageId("LIVE01_LID_BAD"), null);

  const shared = getSharedWhatsAppLidPhoneMap();
  shared.remember(`${lidDigits}@lid`, "923009998877@s.whatsapp.net");
  const stored = await persistWhatsAppWebInbound(
    {
      providerMessageId: "LIVE01_LID_OK",
      remoteJid: `${lidDigits}@lid`,
      fromMe: false,
      text: "mapped",
      pushName: null,
      occurredAt: new Date().toISOString(),
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "conversation",
    },
    { repo, lidMap: shared }
  );
  assert.equal(stored.kind, "stored");
  if (stored.kind === "stored") {
    const bundle = await repo.getConversationBundle(stored.conversationId);
    assert.equal(bundle?.contact.phoneE164, "923009998877");
    assert.notEqual(bundle?.contact.phoneE164, lidDigits);
  }
});

await test("duplicate provider ids remain idempotent", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const msg = {
    providerMessageId: "LIVE01_DUP",
    remoteJid: "923007776655@s.whatsapp.net",
    fromMe: false,
    text: "dup",
    pushName: null,
    occurredAt: new Date().toISOString(),
    isGroup: false,
    isStatusOrNewsletter: false,
    rawType: "conversation",
  };
  const first = await persistWhatsAppWebInbound(msg, { repo });
  const second = await persistWhatsAppWebInbound(msg, { repo });
  assert.equal(first.kind, "stored");
  assert.equal(second.kind, "stored");
  if (first.kind === "stored" && second.kind === "stored") {
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.messageId, second.messageId);
  }
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01 server test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01 server tests passed");
