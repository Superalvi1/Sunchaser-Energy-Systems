/**
 * WHATSAPP-LIVE-01-R3 — exact paginated Supabase unread + cache write-back.
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
import type { WhatsAppReadWatermark } from "./whatsappInboxDatabaseTypes.ts";
import type { InboxMessageRef } from "./whatsappInboxRepoSupport.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import {
  accumulateUnreadFromPagedFetch,
  SUPABASE_UNREAD_MESSAGE_PAGE_SIZE,
} from "./whatsappInboxUnreadBatch.ts";
import {
  __resetUnreadIndexCacheForTests,
  UNREAD_INDEX_CACHE_TTL_MS,
  getUnreadIndexCache,
  dirtyUnreadIndexForConversation,
  invalidateUnreadIndexCache,
  setUnreadIndexCache,
  writeBackUnreadIndexEntries,
} from "./whatsappInboxUnreadIndexCache.ts";

/** Mirrors src/inbox/hooks/useInboxConversations FILTERED_AUTHORITATIVE_REFRESH_MS. */
const FILTERED_AUTHORITATIVE_REFRESH_MS = 10_000;

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
const webhookSrc = readFileSync(join(here, "whatsappWebhookRoutes.ts"), "utf8");
const watermarkRepoSrc = readFileSync(
  join(here, "whatsappInboxReadWatermarkRepository.ts"),
  "utf8"
);
const cacheSrc = readFileSync(
  join(here, "whatsappInboxUnreadIndexCache.ts"),
  "utf8"
);

function makeRows(
  conversationId: string,
  count: number,
  startMs: number,
  opts?: { companyId?: string; idPrefix?: string; backfillEvery?: number }
) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const createdAt = new Date(startMs + i * 1000).toISOString();
    rows.push({
      id: `${opts?.idPrefix ?? "m"}_${String(i).padStart(4, "0")}`,
      conversationId,
      createdAt,
      direction: "inbound" as const,
      isBackfill: opts?.backfillEvery
        ? i % opts.backfillEvery === 0
        : false,
      companyId: opts?.companyId ?? "sunchaser",
    });
  }
  return rows;
}

/** Simulate PostgREST truncation: return at most pageSize rows per call. */
function paginatedFetcher(allRows: ReturnType<typeof makeRows>, pageSize: number) {
  let pagesFetched = 0;
  return {
    get pagesFetched() {
      return pagesFetched;
    },
    async fetchPage({
      cursor,
      limit,
    }: {
      cursor: { at: string; id: string } | null;
      limit: number;
    }) {
      pagesFetched += 1;
      let start = 0;
      if (cursor) {
        start =
          allRows.findIndex(
            (r) =>
              r.createdAt > cursor.at ||
              (r.createdAt === cursor.at && r.id > cursor.id)
          );
        if (start < 0) return [];
      }
      return allRows.slice(start, start + Math.min(limit, pageSize));
    },
  };
}

await test("SUPABASE_UNREAD_MESSAGE_PAGE_SIZE is an explicit bound (500)", () => {
  assert.equal(SUPABASE_UNREAD_MESSAGE_PAGE_SIZE, 500);
  assert.ok(watermarkRepoSrc.includes("SUPABASE_UNREAD_MESSAGE_PAGE_SIZE"));
  assert.ok(watermarkRepoSrc.includes("accumulateUnreadFromPagedFetch"));
  assert.ok(watermarkRepoSrc.includes("fetchInboundUnreadPage"));
});

await test(
  "more than one simulated Supabase result page is consumed",
  async () => {
    const pageSize = 10;
    const rows = makeRows("c1", 35, Date.parse("2026-07-28T10:00:00.000Z"));
    const fetcher = paginatedFetcher(rows, pageSize);
    const watermarks = new Map<string, WhatsAppReadWatermark | null>([
      ["c1", null],
    ]);
    const result = await accumulateUnreadFromPagedFetch({
      conversationIds: ["c1"],
      watermarksByConversationId: watermarks,
      pageSize,
      fetchPage: fetcher.fetchPage,
    });
    assert.ok(result.pagesFetched >= 4, `pages=${result.pagesFetched}`);
    assert.equal(result.rowsProcessed, 35);
    assert.equal(result.states.get("c1")?.unreadCount, 35);
    assert.equal(fetcher.pagesFetched, result.pagesFetched);
  }
);

await test(
  "no-watermark conversation with rows beyond first page has exact count",
  async () => {
    const pageSize = 8;
    const rows = makeRows("c_nowm", 25, Date.parse("2026-07-28T11:00:00.000Z"));
    const fetcher = paginatedFetcher(rows, pageSize);
    const result = await accumulateUnreadFromPagedFetch({
      conversationIds: ["c_nowm"],
      watermarksByConversationId: new Map([["c_nowm", null]]),
      pageSize,
      fetchPage: fetcher.fetchPage,
    });
    assert.ok(result.pagesFetched > 1);
    assert.equal(result.states.get("c_nowm")?.unreadCount, 25);
    assert.equal(result.states.get("c_nowm")?.isUnread, true);
  }
);

await test(
  "watermarked conversation with rows beyond first page has exact count",
  async () => {
    const pageSize = 7;
    const start = Date.parse("2026-07-28T12:00:00.000Z");
    const rows = makeRows("c_wm", 30, start);
    // Watermark after the first 10 messages (index 9).
    const wmAt = rows[9]!.createdAt;
    const wmId = rows[9]!.id;
    const watermark: WhatsAppReadWatermark = {
      companyId: "sunchaser",
      conversationId: "c_wm",
      userId: "user_sales_1",
      lastReadInboundMessageId: wmId,
      lastReadInboundMessageCreatedAt: wmAt,
      updatedAt: wmAt,
    };
    // Production path uses created_at >= oldest watermark; simulate that slice.
    const afterWm = rows.filter(
      (r) =>
        r.createdAt > wmAt || (r.createdAt === wmAt && r.id >= wmId)
    );
    const fetcher = paginatedFetcher(afterWm, pageSize);
    const result = await accumulateUnreadFromPagedFetch({
      conversationIds: ["c_wm"],
      watermarksByConversationId: new Map([["c_wm", watermark]]),
      pageSize,
      fetchPage: fetcher.fetchPage,
    });
    assert.ok(result.pagesFetched > 1);
    // Messages strictly after watermark: indices 10..29 → 20 unread.
    // Row at exact watermark id is NOT newer.
    assert.equal(result.states.get("c_wm")?.unreadCount, 20);
  }
);

await test("created_at ties are resolved using message ID", async () => {
  const at = "2026-07-28T13:00:00.000Z";
  const watermark: WhatsAppReadWatermark = {
    companyId: "sunchaser",
    conversationId: "c_tie",
    userId: "user_sales_1",
    lastReadInboundMessageId: "m_b",
    lastReadInboundMessageCreatedAt: at,
    updatedAt: at,
  };
  const rows = [
    { id: "m_a", conversationId: "c_tie", createdAt: at, direction: "inbound" as const },
    { id: "m_b", conversationId: "c_tie", createdAt: at, direction: "inbound" as const },
    { id: "m_c", conversationId: "c_tie", createdAt: at, direction: "inbound" as const },
  ];
  const result = await accumulateUnreadFromPagedFetch({
    conversationIds: ["c_tie"],
    watermarksByConversationId: new Map([["c_tie", watermark]]),
    pageSize: 2,
    fetchPage: paginatedFetcher(rows, 2).fetchPage,
  });
  // Only m_c (id > m_b) counts.
  assert.equal(result.states.get("c_tie")?.unreadCount, 1);
  assert.ok(result.pagesFetched > 1);
});

await test("is_backfill rows are excluded", async () => {
  const rows = makeRows("c_bf", 12, Date.parse("2026-07-28T14:00:00.000Z"), {
    backfillEvery: 3,
  });
  const result = await accumulateUnreadFromPagedFetch({
    conversationIds: ["c_bf"],
    watermarksByConversationId: new Map([["c_bf", null]]),
    pageSize: 5,
    fetchPage: paginatedFetcher(rows, 5).fetchPage,
  });
  // Indices 0,3,6,9 are backfill → 4 excluded → 8 unread.
  assert.equal(result.states.get("c_bf")?.unreadCount, 8);
});

await test(
  "company and requested-conversation restrictions remain enforced",
  async () => {
    const allowed = makeRows("c_ok", 6, Date.parse("2026-07-28T15:00:00.000Z"));
    const otherConv = makeRows(
      "c_other",
      6,
      Date.parse("2026-07-28T15:00:00.000Z"),
      { idPrefix: "x" }
    );
    const mixed = [...allowed, ...otherConv].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    const result = await accumulateUnreadFromPagedFetch({
      conversationIds: ["c_ok"],
      watermarksByConversationId: new Map([["c_ok", null]]),
      pageSize: 4,
      fetchPage: paginatedFetcher(mixed, 4).fetchPage,
    });
    // Rows for c_other are ignored even if the page fetcher returns them.
    assert.equal(result.states.get("c_ok")?.unreadCount, 6);
    assert.equal(result.states.has("c_other"), false);
  }
);

await test("no unread rows are duplicated between result pages", async () => {
  const rows = makeRows("c_dup", 18, Date.parse("2026-07-28T16:00:00.000Z"));
  // Broken fetcher that overlaps pages by 2 rows — accumulator must dedupe.
  let call = 0;
  const result = await accumulateUnreadFromPagedFetch({
    conversationIds: ["c_dup"],
    watermarksByConversationId: new Map([["c_dup", null]]),
    pageSize: 5,
    fetchPage: async ({ cursor, limit }) => {
      call += 1;
      let start = 0;
      if (cursor) {
        start = rows.findIndex(
          (r) =>
            r.createdAt > cursor.at ||
            (r.createdAt === cursor.at && r.id > cursor.id)
        );
        // Overlap backwards to simulate a bad page boundary.
        start = Math.max(0, start - 2);
      }
      return rows.slice(start, start + limit);
    },
  });
  assert.equal(result.seenMessageIds.size, result.rowsProcessed);
  assert.equal(result.states.get("c_dup")?.unreadCount, 18);
  assert.ok(call > 1);
});

await test("no countUnreadInbound N+1 in Supabase batch path", () => {
  const batchRegion = watermarkRepoSrc.slice(
    watermarkRepoSrc.indexOf("Batch unread for many conversations")
  );
  const methodEnd = batchRegion.indexOf("private async fetchInboundUnreadPage");
  const body = batchRegion.slice(0, methodEnd);
  assert.equal(body.includes("countUnreadInbound("), false);
  assert.equal(body.includes("hasUnreadInbound("), false);
  assert.ok(body.includes("accumulateUnreadFromPagedFetch"));
});

await test(
  "unchanged filtered polling does not cold-rebuild every 10 seconds",
  async () => {
    assert.ok(UNREAD_INDEX_CACHE_TTL_MS > FILTERED_AUTHORITATIVE_REFRESH_MS);
    assert.equal(UNREAD_INDEX_CACHE_TTL_MS, 60_000);
    assert.ok(cacheSrc.includes("longer than filtered authoritative"));

    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    for (let i = 0; i < 10; i++) {
      const ts = new Date(
        Date.parse("2026-07-28T17:00:00.000Z") + i * 60_000
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

    let batchCalls = 0;
    const original = repos.readWatermarks.batchUnreadState.bind(
      repos.readWatermarks
    );
    repos.readWatermarks.batchUnreadState = async (...args) => {
      batchCalls += 1;
      return original(...args);
    };
    const services = createWhatsAppInboxServices(repos);
    await services.conversations.listByActivity(a, { quickFilter: "unread" });
    const cold = batchCalls;
    assert.ok(cold >= 1);
    batchCalls = 0;
    // Simulate several 10s authoritative cycles inside the 60s TTL window.
    for (let i = 0; i < 6; i++) {
      await services.conversations.listByActivity(a, { quickFilter: "unread" });
    }
    assert.equal(
      batchCalls,
      0,
      "warm polls within 60s TTL must not cold-rebuild unread batches"
    );
  }
);

await test("inbound invalidation refreshes the affected unread result", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const a = actor();
  const ts = "2026-07-28T18:00:00.000Z";
  seedConversation(repos.store, { id: "c1", lastMessageAt: ts, updatedAt: ts });
  seedMessage(repos.store, {
    id: "m1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: ts,
  });
  const services = createWhatsAppInboxServices(repos);
  await services.readState.resolveAndAdvance("c1", {
    actor: a,
    lastSeenMessageId: "m1",
    lastSeenMessageCreatedAt: ts,
  });
  // Rebuild index as read.
  let page = await services.conversations.listByActivity(a, {
    quickFilter: "unread",
  });
  assert.equal(page.rows.some((r) => r.id === "c1"), false);

  const later = "2026-07-28T18:05:00.000Z";
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
  // Targeted inbound dirty (Meta/Web paths call this).
  dirtyUnreadIndexForConversation("sunchaser", "c1");
  page = await services.conversations.listByActivity(a, {
    quickFilter: "unread",
  });
  assert.ok(page.rows.some((r) => r.id === "c1"));
  assert.ok(inboundSrc.includes("dirtyUnreadIndexForConversation"));
  assert.ok(webhookSrc.includes("dirtyUnreadIndexForConversation"));
});

await test("mark-read invalidation refreshes only the actor’s index", async () => {
  const a1 = actor({ id: "user_a" });
  const a2 = actor({ id: "user_b" });
  setUnreadIndexCache("sunchaser", a1.id, {
    byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
    totalUnreadCount: 1,
    highWaterUpdatedAt: "2026-07-28T19:00:00.000Z",
    highWaterId: "c1",
  });
  setUnreadIndexCache("sunchaser", a2.id, {
    byId: new Map([["c1", { isUnread: true, unreadCount: 1 }]]),
    totalUnreadCount: 1,
    highWaterUpdatedAt: "2026-07-28T19:00:00.000Z",
    highWaterId: "c1",
  });
  invalidateUnreadIndexCache("sunchaser", a1.id);
  assert.equal(getUnreadIndexCache("sunchaser", a1.id), null);
  assert.ok(getUnreadIndexCache("sunchaser", a2.id));
});

await test(
  "partial cache misses are stored and not re-fetched repeatedly",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    const ts = "2026-07-28T20:00:00.000Z";
    seedConversation(repos.store, { id: "c1", lastMessageAt: ts, updatedAt: ts });
    seedMessage(repos.store, {
      id: "m1",
      conversationId: "c1",
      direction: "inbound",
      createdAt: ts,
    });
    const services = createWhatsAppInboxServices(repos);
    // Build index with only c1.
    await services.conversations.listByActivity(a, { quickFilter: "all" });

    const later = "2026-07-28T20:01:00.000Z";
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

    // First miss for c_new should fetch + write back.
    const first = await services.readState.batchUnreadState(["c_new"], a);
    assert.equal(first.get("c_new")?.isUnread, true);
    assert.equal(batchCalls, 1);
    const cached = getUnreadIndexCache("sunchaser", a.id);
    assert.ok(cached?.byId.has("c_new"));

    batchCalls = 0;
    const second = await services.readState.batchUnreadState(["c_new"], a);
    assert.equal(second.get("c_new")?.isUnread, true);
    assert.equal(batchCalls, 0, "write-back must prevent repeated fetch");
  }
);

await test("totalUnreadCount stays exact across warm cache", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const a = actor();
  for (let i = 0; i < 6; i++) {
    const ts = new Date(
      Date.parse("2026-07-28T21:00:00.000Z") + i * 60_000
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
  const page = await services.conversations.listByActivity(
    a,
    { quickFilter: "all" },
    { limit: 2 }
  );
  assert.equal(page.totalUnreadCount, 6);
  const again = await services.conversations.listByActivity(a, {
    quickFilter: "unread",
  });
  assert.equal(again.totalUnreadCount, 6);
  assert.equal(again.rows.length, 6);
});

await test("writeBackUnreadIndexEntries helper updates totals", () => {
  setUnreadIndexCache("sunchaser", "u1", {
    byId: new Map([["c1", { isUnread: true, unreadCount: 2 }]]),
    totalUnreadCount: 1,
    highWaterUpdatedAt: "2026-07-28T22:00:00.000Z",
    highWaterId: "c1",
  });
  writeBackUnreadIndexEntries(
    "sunchaser",
    "u1",
    new Map([["c1", { isUnread: false, unreadCount: 0 }]])
  );
  const hit = getUnreadIndexCache("sunchaser", "u1");
  assert.equal(hit?.totalUnreadCount, 0);
  assert.equal(hit?.byId.get("c1")?.isUnread, false);
});

await test("no WhatsApp send / Gemini / auto AI in inbound path", () => {
  assert.equal(inboundSrc.includes("sendWhatsAppWebPlainText"), false);
  assert.equal(inboundSrc.includes("generateContent"), false);
  assert.equal(inboundSrc.includes("@google/generative-ai"), false);
});

await test("@lid protection remains intact", () => {
  __resetSharedWhatsAppLidPhoneMap();
  const map = getSharedWhatsAppLidPhoneMap();
  assert.equal(map.resolvePhoneJid("123456789012345@lid"), null);
  map.remember("123456789012345@lid", "923001112233@s.whatsapp.net");
  assert.equal(
    map.resolvePhoneJid("123456789012345@lid"),
    "923001112233@s.whatsapp.net"
  );
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01-R3 server test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01-R3 server tests passed");
