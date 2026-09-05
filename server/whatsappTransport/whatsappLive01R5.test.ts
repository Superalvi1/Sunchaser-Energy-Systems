/**
 * WHATSAPP-LIVE-01-R5 — race-safe targeted dirty flush (generation CAS).
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
  __getActorDirtyGenForTests,
  __getActorLastFlushedGenForTests,
  __getCompanyDirtyGenForTests,
  __getUnreadIndexDirtyIdsForTests,
  __resetUnreadIndexCacheForTests,
  beginDirtyFlush,
  beginUnreadIndexBuild,
  completeDirtyFlush,
  dirtyUnreadIndexForConversation,
  endUnreadIndexBuild,
  getUnreadIndexCache,
  invalidateUnreadIndexCache,
  MAX_DIRTY_FLUSH_ATTEMPTS,
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
const readStateSrc = readFileSync(
  join(here, "whatsappReadStateService.ts"),
  "utf8"
);

await test(
  "inbound B during warm recompute A cannot be cleared by result A",
  async () => {
    setUnreadIndexCache("sunchaser", "u1", {
      byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
      totalUnreadCount: 1,
      highWaterUpdatedAt: "2026-07-30T10:00:00.000Z",
      highWaterId: "c1",
    });

    dirtyUnreadIndexForConversation("sunchaser", "c1");
    const genA = __getCompanyDirtyGenForTests("sunchaser", "c1");
    assert.equal(genA, 1);

    const ticketA = beginDirtyFlush("sunchaser", "u1");
    assert.ok(ticketA);
    assert.equal(ticketA!.capturedGens.get("c1"), 1);

    // Inbound B while A’s batch is in flight.
    dirtyUnreadIndexForConversation("sunchaser", "c1");
    assert.equal(__getCompanyDirtyGenForTests("sunchaser", "c1"), 2);
    assert.equal(__getActorDirtyGenForTests("sunchaser", "u1", "c1"), 2);

    const resultA = completeDirtyFlush(
      ticketA!,
      new Map([["c1", { isUnread: true, unreadCount: 1 }]])
    );
    assert.deepEqual(resultA.appliedIds, []);
    assert.ok(resultA.retainedDirtyIds.includes("c1"));
    assert.equal(__getActorDirtyGenForTests("sunchaser", "u1", "c1"), 2);
    assert.equal(__getActorLastFlushedGenForTests("sunchaser", "u1", "c1"), 0);

    // Stale unreadCount:1 must not be stored; byId was cleared on dirty.
    assert.equal(getUnreadIndexCache("sunchaser", "u1")?.byId.has("c1"), false);

    const ticketB = beginDirtyFlush("sunchaser", "u1");
    assert.ok(ticketB);
    assert.equal(ticketB!.capturedGens.get("c1"), 2);
    const resultB = completeDirtyFlush(
      ticketB!,
      new Map([["c1", { isUnread: true, unreadCount: 2 }]])
    );
    assert.deepEqual(resultB.appliedIds, ["c1"]);
    assert.equal(
      getUnreadIndexCache("sunchaser", "u1")?.byId.get("c1")?.unreadCount,
      2
    );
    assert.equal(getUnreadIndexCache("sunchaser", "u1")?.totalUnreadCount, 1);
  }
);

await test(
  "result A cannot overwrite result B; final unread includes both inbounds",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    const t0 = "2026-07-30T11:00:00.000Z";
    seedConversation(repos.store, {
      id: "c1",
      lastMessageAt: t0,
      updatedAt: t0,
    });
    seedMessage(repos.store, {
      id: "m1",
      conversationId: "c1",
      direction: "inbound",
      createdAt: t0,
    });
    const services = createWhatsAppInboxServices(repos);
    await services.conversations.listByActivity(a, { quickFilter: "all" });
    assert.equal(getUnreadIndexCache("sunchaser", a.id)?.totalUnreadCount, 1);

    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    let batchCalls = 0;
    const original = repos.readWatermarks.batchUnreadState.bind(
      repos.readWatermarks
    );
    repos.readWatermarks.batchUnreadState = async (ids, userId, companyId) => {
      batchCalls += 1;
      if (batchCalls === 1) await batchGate;
      return original(ids, userId, companyId);
    };

    const t1 = "2026-07-30T11:01:00.000Z";
    seedMessage(repos.store, {
      id: "m2",
      conversationId: "c1",
      direction: "inbound",
      createdAt: t1,
    });
    seedConversation(repos.store, {
      id: "c1",
      lastMessageAt: t1,
      updatedAt: t1,
    });
    dirtyUnreadIndexForConversation("sunchaser", "c1");

    const flushA = services.conversations.listByActivity(a, {
      quickFilter: "all",
    });

    // Second inbound before flush A’s batch completes.
    await new Promise((r) => setTimeout(r, 5));
    const t2 = "2026-07-30T11:02:00.000Z";
    seedMessage(repos.store, {
      id: "m3",
      conversationId: "c1",
      direction: "inbound",
      createdAt: t2,
    });
    seedConversation(repos.store, {
      id: "c1",
      lastMessageAt: t2,
      updatedAt: t2,
    });
    dirtyUnreadIndexForConversation("sunchaser", "c1");
    assert.ok((__getCompanyDirtyGenForTests("sunchaser", "c1") as number) >= 2);

    releaseBatch();
    const afterA = await flushA;
    // May still be mid-retry; force a follow-up refresh after gate open.
    const final = await services.conversations.listByActivity(a, {
      quickFilter: "all",
    });
    const unread =
      getUnreadIndexCache("sunchaser", a.id)?.byId.get("c1")?.unreadCount ??
      final.rows.find((r) => r.id === "c1")?.unreadCount;
    assert.equal(unread, 3);
    assert.equal(final.totalUnreadCount, 1);
    assert.equal(afterA.totalUnreadCount, 1);
  }
);

await test(
  "concurrent warm flushes resolving in reverse order cannot regress state",
  () => {
    setUnreadIndexCache("sunchaser", "u1", {
      byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
      totalUnreadCount: 1,
      highWaterUpdatedAt: "2026-07-30T12:00:00.000Z",
      highWaterId: "c1",
    });
    dirtyUnreadIndexForConversation("sunchaser", "c1");

    const older = beginDirtyFlush("sunchaser", "u1");
    const newer = beginDirtyFlush("sunchaser", "u1");
    assert.ok(older && newer);
    assert.ok(newer!.flushSeq > older!.flushSeq);

    const newerDone = completeDirtyFlush(
      newer!,
      new Map([["c1", { isUnread: true, unreadCount: 5 }]])
    );
    assert.deepEqual(newerDone.appliedIds, ["c1"]);
    assert.equal(
      getUnreadIndexCache("sunchaser", "u1")?.byId.get("c1")?.unreadCount,
      5
    );

    const olderDone = completeDirtyFlush(
      older!,
      new Map([["c1", { isUnread: true, unreadCount: 1 }]])
    );
    assert.deepEqual(olderDone.appliedIds, []);
    assert.equal(
      getUnreadIndexCache("sunchaser", "u1")?.byId.get("c1")?.unreadCount,
      5
    );
    assert.equal(getUnreadIndexCache("sunchaser", "u1")?.totalUnreadCount, 1);
  }
);

await test("separate conversations retain independent dirty generations", () => {
  setUnreadIndexCache("sunchaser", "u1", {
    byId: new Map([
      ["c1", { isUnread: true, unreadCount: 1 }],
      ["c2", { isUnread: true, unreadCount: 1 }],
    ]),
    totalUnreadCount: 2,
    highWaterUpdatedAt: "2026-07-30T12:30:00.000Z",
    highWaterId: "c2",
  });
  dirtyUnreadIndexForConversation("sunchaser", "c1");
  dirtyUnreadIndexForConversation("sunchaser", "c1");
  dirtyUnreadIndexForConversation("sunchaser", "c2");
  assert.equal(__getCompanyDirtyGenForTests("sunchaser", "c1"), 2);
  assert.equal(__getCompanyDirtyGenForTests("sunchaser", "c2"), 1);

  const ticket = beginDirtyFlush("sunchaser", "u1");
  assert.ok(ticket);
  completeDirtyFlush(
    ticket!,
    new Map([
      ["c1", { isUnread: true, unreadCount: 3 }],
      ["c2", { isUnread: true, unreadCount: 2 }],
    ])
  );
  assert.equal(
    getUnreadIndexCache("sunchaser", "u1")?.byId.get("c1")?.unreadCount,
    3
  );
  assert.equal(
    getUnreadIndexCache("sunchaser", "u1")?.byId.get("c2")?.unreadCount,
    2
  );
});

await test(
  "separate actors retain correct actor-specific unread results",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a1 = actor({ id: "actor_1" });
    const a2 = actor({ id: "actor_2" });
    const ts = "2026-07-30T13:00:00.000Z";
    seedConversation(repos.store, {
      id: "c1",
      lastMessageAt: ts,
      updatedAt: ts,
    });
    seedMessage(repos.store, {
      id: "m1",
      conversationId: "c1",
      direction: "inbound",
      createdAt: ts,
    });
    const services = createWhatsAppInboxServices(repos);
    await services.conversations.listByActivity(a1, { quickFilter: "all" });
    await services.conversations.listByActivity(a2, { quickFilter: "all" });

    await services.readState.resolveAndAdvance("c1", {
      actor: a1,
      lastSeenMessageId: "m1",
      lastSeenMessageCreatedAt: ts,
    });

    const later = "2026-07-30T13:05:00.000Z";
    seedMessage(repos.store, {
      id: "m2",
      conversationId: "c1",
      direction: "inbound",
      createdAt: later,
    });
    seedConversation(repos.store, {
      id: "c1",
      lastMessageAt: later,
      updatedAt: later,
    });
    dirtyUnreadIndexForConversation("sunchaser", "c1");

    const list1 = await services.conversations.listByActivity(a1, {
      quickFilter: "all",
    });
    const list2 = await services.conversations.listByActivity(a2, {
      quickFilter: "all",
    });
    assert.equal(list1.totalUnreadCount, 1);
    assert.equal(list2.totalUnreadCount, 1);
    assert.equal(
      getUnreadIndexCache("sunchaser", a1.id)?.byId.get("c1")?.unreadCount,
      1
    );
    assert.equal(
      getUnreadIndexCache("sunchaser", a2.id)?.byId.get("c1")?.unreadCount,
      2
    );
  }
);

await test(
  "company-level dirty bookkeeping is not cleared prematurely by the first actor",
  () => {
    setUnreadIndexCache("sunchaser", "u1", {
      byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
      totalUnreadCount: 1,
      highWaterUpdatedAt: "2026-07-30T14:00:00.000Z",
      highWaterId: "c1",
    });
    setUnreadIndexCache("sunchaser", "u2", {
      byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
      totalUnreadCount: 1,
      highWaterUpdatedAt: "2026-07-30T14:00:00.000Z",
      highWaterId: "c1",
    });
    dirtyUnreadIndexForConversation("sunchaser", "c1");
    const gen = __getCompanyDirtyGenForTests("sunchaser", "c1");
    assert.equal(gen, 1);

    const t1 = beginDirtyFlush("sunchaser", "u1");
    completeDirtyFlush(
      t1!,
      new Map([["c1", { isUnread: true, unreadCount: 2 }]])
    );
    assert.equal(__getCompanyDirtyGenForTests("sunchaser", "c1"), gen);
    assert.equal(__getActorLastFlushedGenForTests("sunchaser", "u1", "c1"), gen);
    // Second actor still pending against company gen.
    assert.equal(__getActorLastFlushedGenForTests("sunchaser", "u2", "c1"), 0);
    assert.ok(__getUnreadIndexDirtyIdsForTests("sunchaser", "u2").includes("c1"));

    const t2 = beginDirtyFlush("sunchaser", "u2");
    assert.ok(t2);
    assert.equal(t2!.capturedGens.get("c1"), gen);
    completeDirtyFlush(
      t2!,
      new Map([["c1", { isUnread: true, unreadCount: 2 }]])
    );
    assert.equal(__getActorLastFlushedGenForTests("sunchaser", "u2", "c1"), gen);
  }
);

await test(
  "repeated inbound events terminate through bounded warm-flush work",
  async () => {
    assert.equal(MAX_DIRTY_FLUSH_ATTEMPTS, 3);
    assert.ok(readStateSrc.includes("MAX_DIRTY_FLUSH_ATTEMPTS"));
    assert.ok(cacheSrc.includes("MAX_DIRTY_FLUSH_ATTEMPTS"));

    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    const ts = "2026-07-30T15:00:00.000Z";
    seedConversation(repos.store, {
      id: "c1",
      lastMessageAt: ts,
      updatedAt: ts,
    });
    seedMessage(repos.store, {
      id: "m0",
      conversationId: "c1",
      direction: "inbound",
      createdAt: ts,
    });
    const services = createWhatsAppInboxServices(repos);
    await services.conversations.listByActivity(a, { quickFilter: "all" });

    let batchCalls = 0;
    const original = repos.readWatermarks.batchUnreadState.bind(
      repos.readWatermarks
    );
    repos.readWatermarks.batchUnreadState = async (ids, userId, companyId) => {
      batchCalls += 1;
      // Advance dirty generation on every batch to simulate continuous inbound.
      if (batchCalls <= MAX_DIRTY_FLUSH_ATTEMPTS + 2) {
        dirtyUnreadIndexForConversation("sunchaser", "c1");
        const n = batchCalls;
        const t = new Date(
          Date.parse("2026-07-30T15:00:00.000Z") + n * 60_000
        ).toISOString();
        seedMessage(repos.store, {
          id: `m_cont_${n}`,
          conversationId: "c1",
          direction: "inbound",
          createdAt: t,
        });
        seedConversation(repos.store, {
          id: "c1",
          lastMessageAt: t,
          updatedAt: t,
        });
      }
      return original(ids, userId, companyId);
    };

    await services.conversations.listByActivity(a, { quickFilter: "all" });
    assert.ok(
      batchCalls <= MAX_DIRTY_FLUSH_ATTEMPTS + 2,
      `expected bounded batches, got ${batchCalls}`
    );
  }
);

await test("warm K-touched behavior remains bounded", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const a = actor();
  for (let i = 0; i < 6; i++) {
    const ts = new Date(
      Date.parse("2026-07-30T16:00:00.000Z") + i * 60_000
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
  await services.conversations.listByActivity(a, { quickFilter: "all" });

  let touched = new Set<string>();
  const original = repos.readWatermarks.batchUnreadState.bind(
    repos.readWatermarks
  );
  repos.readWatermarks.batchUnreadState = async (ids, userId, companyId) => {
    for (const id of ids) touched.add(id);
    return original(ids, userId, companyId);
  };

  const later = "2026-07-30T17:00:00.000Z";
  seedMessage(repos.store, {
    id: "m_2b",
    conversationId: "c_2",
    direction: "inbound",
    createdAt: later,
  });
  seedConversation(repos.store, {
    id: "c_2",
    lastMessageAt: later,
    updatedAt: later,
  });
  dirtyUnreadIndexForConversation("sunchaser", "c_2");
  touched = new Set();
  await services.conversations.listByActivity(a, { quickFilter: "all" });
  assert.ok(touched.has("c_2"));
  assert.ok(touched.size <= 3, `warm-K expected, got ${[...touched]}`);
});

await test("cold-build race tests continue passing (stale publish blocked)", () => {
  const handle = beginUnreadIndexBuild("sunchaser", "user_a");
  dirtyUnreadIndexForConversation("sunchaser", "c_new");
  assert.equal(handle.cancelled, true);
  const published = tryPublishUnreadIndex("sunchaser", "user_a", handle, {
    byId: new Map([["c_old", { isUnread: true, unreadCount: 1 }]]),
    totalUnreadCount: 1,
    highWaterUpdatedAt: "2026-07-30T18:00:00.000Z",
    highWaterId: "c_old",
  });
  assert.equal(published, null);
  endUnreadIndexBuild(handle);
  assert.equal(MAX_UNREAD_INDEX_BUILD_ATTEMPTS, 3);
});

await test("partial-miss write-back remains correct", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const a = actor();
  const ts = "2026-07-30T19:00:00.000Z";
  seedConversation(repos.store, { id: "c1", lastMessageAt: ts, updatedAt: ts });
  seedMessage(repos.store, {
    id: "m1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: ts,
  });
  const services = createWhatsAppInboxServices(repos);
  await services.conversations.listByActivity(a, { quickFilter: "all" });

  const later = "2026-07-30T19:01:00.000Z";
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

  writeBackUnreadIndexEntries(
    "sunchaser",
    a.id,
    new Map([["c1", { isUnread: false, unreadCount: 0 }]])
  );
  assert.equal(
    getUnreadIndexCache("sunchaser", a.id)?.byId.get("c1")?.isUnread,
    false
  );
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01-R5 test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01-R5 server tests passed");
