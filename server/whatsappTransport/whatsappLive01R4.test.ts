/**
 * WHATSAPP-LIVE-01-R4 — race-safe unread cache publish + targeted inbound dirty.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestActor } from "../middleware/actor.ts";
import { createInMemoryWhatsAppInboxRepositories } from "./whatsappInboxRepository.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import type { InboxMessageRef } from "./whatsappInboxRepoSupport.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import {
  __getInflightUnreadBuildCountForTests,
  __getUnreadIndexDirtyIdsForTests,
  __peekUnreadIndexPublishSeqForTests,
  __resetUnreadIndexCacheForTests,
  beginUnreadIndexBuild,
  dirtyUnreadIndexForConversation,
  endUnreadIndexBuild,
  getUnreadIndexCache,
  invalidateUnreadIndexCache,
  invalidateUnreadIndexCacheForCompany,
  MAX_UNREAD_INDEX_BUILD_ATTEMPTS,
  setUnreadIndexCache,
  tryPublishUnreadIndex,
  writeBackUnreadIndexEntries,
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
const webhookSrc = readFileSync(join(here, "whatsappWebhookRoutes.ts"), "utf8");
const cacheSrc = readFileSync(
  join(here, "whatsappInboxUnreadIndexCache.ts"),
  "utf8"
);

await test(
  "inbound dirty during in-progress cold build prevents stale publish",
  async () => {
    const handle = beginUnreadIndexBuild("sunchaser", "user_a");
    assert.equal(__getInflightUnreadBuildCountForTests(), 1);

    // Inbound arrives while build is in flight.
    dirtyUnreadIndexForConversation("sunchaser", "c_new");
    assert.equal(handle.cancelled, true);

    const published = tryPublishUnreadIndex("sunchaser", "user_a", handle, {
      byId: new Map([["c_stale", { isUnread: false, unreadCount: 0 }]]),
      totalUnreadCount: 0,
      highWaterUpdatedAt: "2026-07-29T10:00:00.000Z",
      highWaterId: "c_stale",
    });
    assert.equal(published, null);
    assert.equal(getUnreadIndexCache("sunchaser", "user_a"), null);
    endUnreadIndexBuild(handle);
  }
);

await test(
  "mark-read invalidation during build cannot restore unread state",
  async () => {
    const a = actor();
    const handle = beginUnreadIndexBuild("sunchaser", a.id);

    // Stale build still thinks c1 is unread.
    invalidateUnreadIndexCache("sunchaser", a.id);
    assert.equal(handle.cancelled, true);

    const published = tryPublishUnreadIndex("sunchaser", a.id, handle, {
      byId: new Map([["c1", { isUnread: true, unreadCount: 3 }]]),
      totalUnreadCount: 1,
      highWaterUpdatedAt: "2026-07-29T11:00:00.000Z",
      highWaterId: "c1",
    });
    assert.equal(published, null);
    assert.equal(getUnreadIndexCache("sunchaser", a.id), null);
    endUnreadIndexBuild(handle);
  }
);

await test(
  "company dirty during build affects all cached actors / in-flight builds",
  async () => {
    const h1 = beginUnreadIndexBuild("sunchaser", "u1");
    const h2 = beginUnreadIndexBuild("sunchaser", "u2");
    const other = beginUnreadIndexBuild("other_co", "u1");

    dirtyUnreadIndexForConversation("sunchaser", "c9");
    assert.equal(h1.cancelled, true);
    assert.equal(h2.cancelled, true);
    assert.equal(other.cancelled, false);

    endUnreadIndexBuild(h1);
    endUnreadIndexBuild(h2);
    endUnreadIndexBuild(other);
  }
);

await test("actor invalidation does not invalidate unrelated actors", () => {
  setUnreadIndexCache("sunchaser", "u1", {
    byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
    totalUnreadCount: 1,
    highWaterUpdatedAt: "2026-07-29T12:00:00.000Z",
    highWaterId: "c1",
  });
  setUnreadIndexCache("sunchaser", "u2", {
    byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
    totalUnreadCount: 1,
    highWaterUpdatedAt: "2026-07-29T12:00:00.000Z",
    highWaterId: "c1",
  });
  invalidateUnreadIndexCache("sunchaser", "u1");
  assert.equal(getUnreadIndexCache("sunchaser", "u1"), null);
  assert.ok(getUnreadIndexCache("sunchaser", "u2"));
});

await test(
  "an older concurrent build cannot overwrite a newer build",
  async () => {
    const older = beginUnreadIndexBuild("sunchaser", "u1");
    const newer = beginUnreadIndexBuild("sunchaser", "u1");
    assert.ok(newer.publishSeq > older.publishSeq);

    const newerSnap = tryPublishUnreadIndex("sunchaser", "u1", newer, {
      byId: new Map([["c_new", { isUnread: true, unreadCount: 1 }]]),
      totalUnreadCount: 1,
      highWaterUpdatedAt: "2026-07-29T13:01:00.000Z",
      highWaterId: "c_new",
    });
    assert.ok(newerSnap);
    endUnreadIndexBuild(newer);

    const olderPublish = tryPublishUnreadIndex("sunchaser", "u1", older, {
      byId: new Map([["c_old", { isUnread: false, unreadCount: 0 }]]),
      totalUnreadCount: 0,
      highWaterUpdatedAt: "2026-07-29T13:00:00.000Z",
      highWaterId: "c_old",
    });
    assert.equal(olderPublish, null);
    const cached = getUnreadIndexCache("sunchaser", "u1");
    assert.ok(cached?.byId.has("c_new"));
    assert.equal(cached?.byId.has("c_old"), false);
    endUnreadIndexBuild(older);
  }
);

await test(
  "retries/coalescing remain bounded under repeated invalidations",
  async () => {
    assert.equal(MAX_UNREAD_INDEX_BUILD_ATTEMPTS, 3);
    assert.ok(cacheSrc.includes("MAX_UNREAD_INDEX_BUILD_ATTEMPTS"));

    // Unit: a cancelled build never publishes; a later uncancelled attempt can.
    const cancelled = beginUnreadIndexBuild("sunchaser", "u_retry");
    dirtyUnreadIndexForConversation("sunchaser", "c1");
    assert.equal(
      tryPublishUnreadIndex("sunchaser", "u_retry", cancelled, {
        byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
        totalUnreadCount: 1,
        highWaterUpdatedAt: "2026-07-29T14:00:00.000Z",
        highWaterId: "c1",
      }),
      null
    );
    endUnreadIndexBuild(cancelled);

    const ok = beginUnreadIndexBuild("sunchaser", "u_retry");
    const published = tryPublishUnreadIndex("sunchaser", "u_retry", ok, {
      byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
      totalUnreadCount: 1,
      highWaterUpdatedAt: "2026-07-29T14:00:00.000Z",
      highWaterId: "c1",
    });
    assert.ok(published);
    endUnreadIndexBuild(ok);

    // Integration: continuous dirty during cold path still terminates with exact result.
    __resetUnreadIndexCacheForTests();
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    seedConversation(repos.store, {
      id: "c1",
      lastMessageAt: "2026-07-29T14:00:00.000Z",
      updatedAt: "2026-07-29T14:00:00.000Z",
    });
    seedMessage(repos.store, {
      id: "m1",
      conversationId: "c1",
      direction: "inbound",
      createdAt: "2026-07-29T14:00:00.000Z",
    });

    const services = createWhatsAppInboxServices(repos);
    let builds = 0;
    const originalBatch = repos.readWatermarks.batchUnreadState.bind(
      repos.readWatermarks
    );
    repos.readWatermarks.batchUnreadState = async (...args) => {
      builds += 1;
      // Cancel in-flight builds for the first several calls only.
      if (builds <= MAX_UNREAD_INDEX_BUILD_ATTEMPTS) {
        dirtyUnreadIndexForConversation("sunchaser", "c1");
      }
      return originalBatch(...args);
    };

    const page = await services.conversations.listByActivity(a, {
      quickFilter: "unread",
    });
    assert.equal(page.totalUnreadCount, 1);
    assert.ok(page.rows.some((r) => r.id === "c1"));
    // list + count + enrich share the watermark repo; keep a hard upper bound.
    assert.ok(builds <= 20, `unbounded rebuild loop? builds=${builds}`);
  }
);

await test(
  "totalUnreadCount remains exact after dirty + warm flush races",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    for (let i = 0; i < 4; i++) {
      const ts = new Date(
        Date.parse("2026-07-29T15:00:00.000Z") + i * 60_000
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
    }
    const services = createWhatsAppInboxServices(repos);
    const first = await services.conversations.listByActivity(a, {
      quickFilter: "all",
    });
    assert.equal(first.totalUnreadCount, 4);

    await services.readState.resolveAndAdvance("c_0", {
      actor: a,
      lastSeenMessageId: "m_0",
      lastSeenMessageCreatedAt: "2026-07-29T15:00:00.000Z",
    });
    const afterRead = await services.conversations.listByActivity(a, {
      quickFilter: "all",
    });
    assert.equal(afterRead.totalUnreadCount, 3);

    const later = "2026-07-29T16:00:00.000Z";
    seedMessage(repos.store, {
      id: "m_0b",
      conversationId: "c_0",
      direction: "inbound",
      createdAt: later,
    });
    seedConversation(repos.store, {
      id: "c_0",
      lastMessageAt: later,
      updatedAt: later,
    });
    dirtyUnreadIndexForConversation("sunchaser", "c_0");
    assert.ok(
      __getUnreadIndexDirtyIdsForTests("sunchaser", a.id).includes("c_0") ||
        getUnreadIndexCache("sunchaser", a.id) == null
    );

    const afterDirty = await services.conversations.listByActivity(a, {
      quickFilter: "unread",
    });
    assert.equal(afterDirty.totalUnreadCount, 4);
    assert.ok(afterDirty.rows.some((r) => r.id === "c_0"));
  }
);

await test("partial cache misses still write back correctly", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const a = actor();
  const ts = "2026-07-29T19:00:00.000Z";
  seedConversation(repos.store, { id: "c1", lastMessageAt: ts, updatedAt: ts });
  seedMessage(repos.store, {
    id: "m1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: ts,
  });
  const services = createWhatsAppInboxServices(repos);
  await services.conversations.listByActivity(a, { quickFilter: "all" });

  const later = "2026-07-29T19:01:00.000Z";
  seedConversation(repos.store, {
    id: "c_new",
    lastMessageAt: later,
    updatedAt: later,
  });
  seedMessage(repos.store, {
    id: "m_new",
    conversationId: "c_new",
    direction: "inbound",
    createdAt: later,
  });

  let batchCalls = 0;
  const original = repos.readWatermarks.batchUnreadState.bind(
    repos.readWatermarks
  );
  repos.readWatermarks.batchUnreadState = async (...args) => {
    batchCalls += 1;
    return original(...args);
  };

  await services.readState.batchUnreadState(["c_new"], a);
  assert.equal(batchCalls, 1);
  assert.ok(getUnreadIndexCache("sunchaser", a.id)?.byId.has("c_new"));
  batchCalls = 0;
  await services.readState.batchUnreadState(["c_new"], a);
  assert.equal(batchCalls, 0);
});

await test("nuclear company invalidate still cancels in-flight builds", () => {
  const h = beginUnreadIndexBuild("sunchaser", "u1");
  invalidateUnreadIndexCacheForCompany("sunchaser");
  assert.equal(h.cancelled, true);
  endUnreadIndexBuild(h);
});

await test("writeBack helper still updates totals", () => {
  setUnreadIndexCache("sunchaser", "u1", {
    byId: new Map([["c1", { isUnread: true, unreadCount: 2 }]]),
    totalUnreadCount: 1,
    highWaterUpdatedAt: "2026-07-29T20:00:00.000Z",
    highWaterId: "c1",
  });
  writeBackUnreadIndexEntries(
    "sunchaser",
    "u1",
    new Map([["c1", { isUnread: false, unreadCount: 0 }]])
  );
  assert.equal(getUnreadIndexCache("sunchaser", "u1")?.totalUnreadCount, 0);
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01-R4 server test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01-R4 server tests passed");
