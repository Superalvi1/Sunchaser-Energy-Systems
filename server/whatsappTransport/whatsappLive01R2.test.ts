/**
 * WHATSAPP-LIVE-01-R2 — bounded unread live query cost + cache invalidation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestActor } from "../middleware/actor.ts";
import {
  getSharedWhatsAppLidPhoneMap,
  __resetSharedWhatsAppLidPhoneMap,
} from "../whatsappWeb/index.ts";
import { createInMemoryWhatsAppInboxRepositories } from "./whatsappInboxRepository.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import type { InboxMessageRef } from "./whatsappInboxRepoSupport.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import {
  __resetUnreadIndexCacheForTests,
  UNREAD_INDEX_CACHE_TTL_MS,
} from "./whatsappInboxUnreadIndexCache.ts";

function seedConversation(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<WhatsAppConversationInbox, "id"> &
    Partial<WhatsAppConversationInbox>
): void {
  const now =
    partial.updatedAt ?? partial.lastMessageAt ?? "2026-07-19T10:00:00.000Z";
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
  __resetUnreadIndexCacheForTests();
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
const inboundSrc = readFileSync(
  join(here, "../whatsappWeb/whatsappWebInbound.ts"),
  "utf8"
);
const watermarkRepoSrc = readFileSync(
  join(here, "whatsappInboxReadWatermarkRepository.ts"),
  "utf8"
);
const cacheSrc = readFileSync(
  join(here, "whatsappInboxUnreadIndexCache.ts"),
  "utf8"
);

await test(
  "filtered polling does not rebuild unread index / rescan messages every tick",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();

    // Seed enough history that a naive full rescan would be expensive.
    for (let i = 0; i < 30; i++) {
      const ts = new Date(
        Date.parse("2026-07-27T08:00:00.000Z") + i * 60_000
      ).toISOString();
      seedConversation(repos.store, {
        id: `c_${i}`,
        lastMessageAt: ts,
        updatedAt: ts,
      });
      for (let m = 0; m < 5; m++) {
        seedMessage(repos.store, {
          id: `m_${i}_${m}`,
          conversationId: `c_${i}`,
          direction: "inbound",
          createdAt: new Date(Date.parse(ts) - m * 1000).toISOString(),
        });
      }
    }

    let batchCalls = 0;
    const originalBatch = repos.readWatermarks.batchUnreadState.bind(
      repos.readWatermarks
    );
    repos.readWatermarks.batchUnreadState = async (...args) => {
      batchCalls += 1;
      return originalBatch(...args);
    };

    const services = createWhatsAppInboxServices(repos);

    // Cold list builds the index once (chunked batch calls).
    await services.conversations.listByActivity(
      a,
      { quickFilter: "unread" },
      { limit: 40 }
    );
    const coldBatches = batchCalls;
    assert.ok(coldBatches >= 1, "cold path builds unread index via batch");

    // Warm filtered polls within TTL must not call batchUnreadState again.
    batchCalls = 0;
    for (let tick = 0; tick < 5; tick++) {
      await services.conversations.listByActivity(
        a,
        { quickFilter: "unread" },
        { limit: 40 }
      );
    }
    assert.equal(
      batchCalls,
      0,
      "warm filtered polls must not rescan message history every 2s tick"
    );
    assert.ok(UNREAD_INDEX_CACHE_TTL_MS >= 60_000);
    assert.ok(cacheSrc.includes("UNREAD_INDEX_CACHE_TTL_MS"));
  }
);

await test(
  "Supabase batchUnreadState remains batch-based (no per-conversation count)",
  () => {
    assert.ok(watermarkRepoSrc.includes("async batchUnreadState"));
    assert.ok(watermarkRepoSrc.includes("Does NOT call countUnreadInbound"));
    assert.ok(watermarkRepoSrc.includes("oldestWatermarkAt"));
    // Production path must not loop countUnreadInbound inside batchUnreadState.
    const batchFn = watermarkRepoSrc.slice(
      watermarkRepoSrc.indexOf("async batchUnreadState")
    );
    const supabaseBatch = batchFn.slice(
      batchFn.indexOf("class SupabaseWhatsAppInboxReadWatermarkRepository")
    );
    // Within Supabase class batch method body before closing of class-ish — check method doesn't call countUnreadInbound
    const methodStart = watermarkRepoSrc.indexOf(
      "Batch unread for many conversations"
    );
    const methodEnd = watermarkRepoSrc.indexOf(
      "return batchUnreadStateFromSnapshots",
      methodStart
    );
    const methodBody = watermarkRepoSrc.slice(methodStart, methodEnd);
    assert.equal(methodBody.includes("countUnreadInbound("), false);
    assert.equal(methodBody.includes("hasUnreadInbound("), false);
    void supabaseBatch;
  }
);

await test("totalUnreadCount remains complete and correct with cache", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const a = actor();
  for (let i = 0; i < 12; i++) {
    const ts = new Date(
      Date.parse("2026-07-27T09:00:00.000Z") + i * 60_000
    ).toISOString();
    seedConversation(repos.store, {
      id: `c_${i}`,
      lastMessageAt: ts,
      updatedAt: ts,
    });
    seedMessage(repos.store, {
      id: `m_${i}`,
      conversationId: `c_${i}`,
      direction: "inbound",
      createdAt: ts,
    });
    if (i < 4) {
      await repos.readWatermarks.upsert({
        conversationId: `c_${i}`,
        userId: a.id,
        lastReadInboundMessageId: `m_${i}`,
        lastReadInboundMessageCreatedAt: ts,
      });
    }
  }
  const services = createWhatsAppInboxServices(repos);
  const page = await services.conversations.listByActivity(
    a,
    { quickFilter: "all" },
    { limit: 5 }
  );
  assert.equal(page.totalUnreadCount, 8);
  // Warm repeat
  const again = await services.conversations.listByActivity(
    a,
    { quickFilter: "unread" },
    { limit: 40 }
  );
  assert.equal(again.totalUnreadCount, 8);
  assert.equal(again.rows.length, 8);
});

await test("mark-read invalidates cache so Unread/Read flip immediately", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const a = actor();
  const ts = "2026-07-27T10:00:00.000Z";
  seedConversation(repos.store, { id: "c1", lastMessageAt: ts, updatedAt: ts });
  seedMessage(repos.store, {
    id: "m1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: ts,
  });
  const services = createWhatsAppInboxServices(repos);
  assert.equal(
    (
      await services.conversations.listByActivity(a, { quickFilter: "unread" })
    ).rows.some((r) => r.id === "c1"),
    true
  );
  await services.readState.resolveAndAdvance("c1", {
    actor: a,
    lastSeenMessageId: "m1",
    lastSeenMessageCreatedAt: ts,
  });
  assert.equal(
    (
      await services.conversations.listByActivity(a, { quickFilter: "unread" })
    ).rows.some((r) => r.id === "c1"),
    false
  );
  assert.equal(
    (
      await services.conversations.listByActivity(a, { quickFilter: "read" })
    ).rows.some((r) => r.id === "c1"),
    true
  );
});

await test("no WhatsApp send / auto AI / Gemini in inbound path", () => {
  assert.equal(inboundSrc.includes("sendWhatsAppWebPlainText"), false);
  assert.equal(inboundSrc.includes("insertOutboundMessage"), false);
  assert.equal(inboundSrc.includes("generateContent"), false);
  assert.equal(inboundSrc.includes("@google/generative-ai"), false);
});

await test("@lid identity protection remains intact", () => {
  __resetSharedWhatsAppLidPhoneMap();
  const map = getSharedWhatsAppLidPhoneMap();
  const lid = "123456789012345@lid";
  assert.equal(map.resolvePhoneJid(lid), null);
  map.remember(lid, "923009998877@s.whatsapp.net");
  assert.equal(map.resolvePhoneJid(lid), "923009998877@s.whatsapp.net");
  assert.equal(map.resolvePhoneJid("15551234567@lid"), null);
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01-R2 server test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01-R2 server tests passed");
