/**
 * WHATSAPP-LIVE-01-R1 — behavioral proofs for server-side quick filters,
 * unread pagination, batch unread enrichment, and prohibited non-actions.
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
import { encodeInboxCursor } from "./whatsappInboxDtos.ts";
import { createInboxControllers } from "./whatsappInboxControllers.ts";
import { __resetUnreadIndexCacheForTests } from "./whatsappInboxUnreadIndexCache.ts";
import type { Request, Response } from "express";

function seedConversation(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<WhatsAppConversationInbox, "id"> &
    Partial<WhatsAppConversationInbox>
): void {
  const now = partial.updatedAt ?? partial.lastMessageAt ?? "2026-07-19T10:00:00.000Z";
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

function mockRes() {
  const state: {
    statusCode: number;
    body: any;
  } = { statusCode: 0, body: null };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

function mockReq(query: Record<string, unknown> = {}): Request {
  return {
    query,
    params: {},
    body: {},
    actor: actor(),
  } as unknown as Request;
}

const here = dirname(fileURLToPath(import.meta.url));
const inboundSrc = readFileSync(
  join(here, "../whatsappWeb/whatsappWebInbound.ts"),
  "utf8"
);
const controllersSrc = readFileSync(
  join(here, "whatsappInboxControllers.ts"),
  "utf8"
);

await test(
  "unread conversation beyond first 40 appears under Unread filter",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    // 40 newer read conversations + 1 older unread beyond page 1.
    for (let i = 0; i < 40; i++) {
      const id = `c_read_${String(i).padStart(3, "0")}`;
      const at = `2026-07-20T12:${String(i).padStart(2, "0")}:00.000Z`;
      seedConversation(repos.store, {
        id,
        lastMessageAt: at,
        updatedAt: at,
      });
      seedMessage(repos.store, {
        id: `m_${id}`,
        conversationId: id,
        direction: "inbound",
        createdAt: at,
      });
      await repos.readWatermarks.upsert({
        conversationId: id,
        userId: a.id,
        lastReadInboundMessageId: `m_${id}`,
        lastReadInboundMessageCreatedAt: at,
      });
    }
    seedConversation(repos.store, {
      id: "c_unread_old",
      lastMessageAt: "2026-07-19T08:00:00.000Z",
      updatedAt: "2026-07-19T08:00:00.000Z",
    });
    seedMessage(repos.store, {
      id: "m_unread_old",
      conversationId: "c_unread_old",
      direction: "inbound",
      createdAt: "2026-07-19T08:00:00.000Z",
    });

    const services = createWhatsAppInboxServices(repos);
    const allFirst = await services.conversations.listByActivity(
      a,
      { quickFilter: "all" },
      { limit: 40 }
    );
    assert.equal(allFirst.rows.length, 40);
    assert.equal(
      allFirst.rows.some((r) => r.id === "c_unread_old"),
      false,
      "old unread must be beyond unfiltered first page"
    );

    const unreadPage = await services.conversations.listByActivity(
      a,
      { quickFilter: "unread" },
      { limit: 40 }
    );
    assert.ok(
      unreadPage.rows.some((r) => r.id === "c_unread_old"),
      "Unread filter must include conversation beyond first 40"
    );
    assert.equal(unreadPage.totalUnreadCount, 1);
  }
);

await test("Read pagination returns all and only read conversations", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  const a = actor();
  for (let i = 0; i < 45; i++) {
    const id = `c_${String(i).padStart(3, "0")}`;
    const ts = new Date(
      Date.parse("2026-07-21T10:00:00.000Z") + i * 60_000
    ).toISOString();
    seedConversation(repos.store, {
      id,
      lastMessageAt: ts,
      updatedAt: ts,
    });
    seedMessage(repos.store, {
      id: `m_${id}`,
      conversationId: id,
      direction: "inbound",
      createdAt: ts,
    });
    if (i % 2 === 0) {
      await repos.readWatermarks.upsert({
        conversationId: id,
        userId: a.id,
        lastReadInboundMessageId: `m_${id}`,
        lastReadInboundMessageCreatedAt: ts,
      });
    }
  }

  const services = createWhatsAppInboxServices(repos);
  const collected: string[] = [];
  let cursor = null as null | { at: string; id: string };
  for (;;) {
    const page = await services.conversations.listByActivity(
      a,
      { quickFilter: "read" },
      { cursor, limit: 10 }
    );
    for (const row of page.rows) {
      collected.push(row.id);
      assert.equal(row.isUnread, false);
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  assert.equal(collected.length, 23); // i even: 0,2,...,44 → 23
  assert.equal(new Set(collected).size, collected.length);
  for (const id of collected) {
    const n = Number(id.replace("c_", ""));
    assert.equal(n % 2, 0);
  }
});

await test("Resolved and Archived tabs query correct server status", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c_open",
    status: "open",
    lastMessageAt: "2026-07-22T10:00:00.000Z",
  });
  seedConversation(repos.store, {
    id: "c_pending",
    status: "pending",
    lastMessageAt: "2026-07-22T09:00:00.000Z",
  });
  seedConversation(repos.store, {
    id: "c_resolved",
    status: "resolved",
    lastMessageAt: "2026-07-22T08:00:00.000Z",
  });
  seedConversation(repos.store, {
    id: "c_archived",
    status: "archived",
    lastMessageAt: "2026-07-22T07:00:00.000Z",
  });
  const services = createWhatsAppInboxServices(repos);
  const a = actor();

  const open = await services.conversations.listByActivity(a, {
    quickFilter: "open",
  });
  assert.deepEqual(
    open.rows.map((r) => r.id).sort(),
    ["c_open", "c_pending"].sort()
  );

  const resolved = await services.conversations.listByActivity(a, {
    quickFilter: "resolved",
  });
  assert.deepEqual(
    resolved.rows.map((r) => r.id),
    ["c_resolved"]
  );

  const archived = await services.conversations.listByActivity(a, {
    quickFilter: "archived",
  });
  assert.deepEqual(
    archived.rows.map((r) => r.id),
    ["c_archived"]
  );
});

await test(
  "switching quick filters uses independent cursors (no incompatible reuse)",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    for (let i = 0; i < 5; i++) {
      const ts = new Date(
        Date.parse("2026-07-22T12:00:00.000Z") + i * 60_000
      ).toISOString();
      seedConversation(repos.store, {
        id: `c_${i}`,
        status: i < 3 ? "resolved" : "open",
        lastMessageAt: ts,
        updatedAt: ts,
      });
    }
    const services = createWhatsAppInboxServices(repos);
    const resolvedPage = await services.conversations.listByActivity(
      a,
      { quickFilter: "resolved" },
      { limit: 2 }
    );
    assert.ok(resolvedPage.nextCursor);
    // Cursor from resolved must not be applied blindly to open — open has different set.
    const openWithForeignCursor = await services.conversations.listByActivity(
      a,
      { quickFilter: "open" },
      { cursor: resolvedPage.nextCursor, limit: 10 }
    );
    // Open conversations are only c_3,c_4 — foreign resolved cursor may yield empty or subset,
    // but must never return resolved rows.
    assert.equal(
      openWithForeignCursor.rows.every((r) => r.status === "open"),
      true
    );
    assert.equal(
      openWithForeignCursor.rows.some((r) => r.status === "resolved"),
      false
    );
  }
);

await test(
  "total unread count includes conversations beyond the first page",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    for (let i = 0; i < 42; i++) {
      const ts = new Date(
        Date.parse("2026-07-23T08:00:00.000Z") + i * 60_000
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
      { limit: 40 }
    );
    assert.equal(page.rows.length, 40);
    assert.equal(page.totalUnreadCount, 42);
  }
);

await test(
  "filtered polling discovers new matching conversations",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    seedConversation(repos.store, {
      id: "c_existing",
      status: "resolved",
      lastMessageAt: "2026-07-24T10:00:00.000Z",
      updatedAt: "2026-07-24T10:00:00.000Z",
    });
    const services = createWhatsAppInboxServices(repos);
    const before = await services.conversations.listByActivity(a, {
      quickFilter: "resolved",
    });
    assert.equal(before.rows.length, 1);

    seedConversation(repos.store, {
      id: "c_new_resolved",
      status: "resolved",
      lastMessageAt: "2026-07-24T11:00:00.000Z",
      updatedAt: "2026-07-24T11:00:00.000Z",
    });

    const delta = await services.conversations.listDelta(
      a,
      { quickFilter: "resolved" },
      {
        since: { at: "2026-07-24T10:00:00.000Z", id: "c_existing" },
        limit: 40,
      }
    );
    assert.ok(delta.rows.some((r) => r.id === "c_new_resolved"));
  }
);

await test(
  "marking read removes from Unread and appears in Read; later inbound reverses",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    const ts = "2026-07-25T10:00:00.000Z";
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

    let unread = await services.conversations.listByActivity(a, {
      quickFilter: "unread",
    });
    assert.ok(unread.rows.some((r) => r.id === "c1"));

    await services.readState.resolveAndAdvance("c1", {
      actor: a,
      lastSeenMessageId: "m1",
      lastSeenMessageCreatedAt: ts,
    });

    unread = await services.conversations.listByActivity(a, {
      quickFilter: "unread",
    });
    assert.equal(
      unread.rows.some((r) => r.id === "c1"),
      false
    );
    const read = await services.conversations.listByActivity(a, {
      quickFilter: "read",
    });
    assert.ok(read.rows.some((r) => r.id === "c1"));

    const later = "2026-07-25T10:05:00.000Z";
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

    unread = await services.conversations.listByActivity(a, {
      quickFilter: "unread",
    });
    assert.ok(unread.rows.some((r) => r.id === "c1"));
  }
);

await test(
  "unread enrichment uses batchUnreadState (not N+1 getUnreadCount)",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const a = actor();
    for (let i = 0; i < 8; i++) {
      const ts = new Date(
        Date.parse("2026-07-26T09:00:00.000Z") + i * 60_000
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
    let singleCountCalls = 0;
    const originalBatch = repos.readWatermarks.batchUnreadState.bind(
      repos.readWatermarks
    );
    const originalCount = repos.readWatermarks.countUnreadInbound.bind(
      repos.readWatermarks
    );
    repos.readWatermarks.batchUnreadState = async (...args) => {
      batchCalls += 1;
      return originalBatch(...args);
    };
    repos.readWatermarks.countUnreadInbound = async (...args) => {
      singleCountCalls += 1;
      return originalCount(...args);
    };

    const services = createWhatsAppInboxServices(repos);
    await services.conversations.listByActivity(a, { quickFilter: "all" }, {
      limit: 8,
    });

    assert.ok(batchCalls >= 1, "expected batchUnreadState usage");
    assert.equal(
      singleCountCalls,
      0,
      "list enrichment must not N+1 countUnreadInbound"
    );
    assert.ok(
      controllersSrc.includes("batchUnreadState"),
      "controllers keep batch path for detail enrich"
    );
    assert.equal(
      /getUnreadCount\(\s*row\.id/.test(controllersSrc),
      false,
      "controllers must not N+1 getUnreadCount per row"
    );
  }
);

await test("list controller returns totalUnreadCount meta + quickFilter", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c1",
    lastMessageAt: "2026-07-26T12:00:00.000Z",
  });
  seedMessage(repos.store, {
    id: "m1",
    conversationId: "c1",
    direction: "inbound",
    createdAt: "2026-07-26T12:00:00.000Z",
  });
  const services = createWhatsAppInboxServices(repos);
  const controllers = createInboxControllers(services, {
    resolveListAvailability: async () => ({
      allTransportsDisconnected: false,
    }),
  });
  const { res, state } = mockRes();
  await controllers.listConversations(
    mockReq({ quickFilter: "unread", limit: "40" }),
    res
  );
  assert.equal(state.statusCode, 200);
  assert.equal(state.body.success, true);
  assert.equal(state.body.meta.totalUnreadCount, 1);
  assert.equal(state.body.data.conversations[0].id, "c1");
  assert.equal(state.body.data.conversations[0].isUnread, true);
});

await test("assignee and hasFailedMessage filters still work with quickFilter", async () => {
  const repos = createInMemoryWhatsAppInboxRepositories();
  seedConversation(repos.store, {
    id: "c_mine",
    assignedUserId: "user_sales_1",
    status: "open",
    lastMessageAt: "2026-07-26T13:00:00.000Z",
  });
  seedConversation(repos.store, {
    id: "c_other",
    assignedUserId: "user_other",
    status: "open",
    lastMessageAt: "2026-07-26T13:01:00.000Z",
  });
  seedConversation(repos.store, {
    id: "c_fail",
    status: "open",
    hasFailedMessage: true,
    lastMessageAt: "2026-07-26T13:02:00.000Z",
  });
  const services = createWhatsAppInboxServices(repos);
  const a = actor();
  const mine = await services.conversations.listByActivity(a, {
    quickFilter: "open",
    assignedTo: "user_sales_1",
  });
  assert.deepEqual(
    mine.rows.map((r) => r.id),
    ["c_mine"]
  );
  const failed = await services.conversations.listByActivity(a, {
    quickFilter: "open",
    hasFailedMessage: true,
  });
  assert.deepEqual(
    failed.rows.map((r) => r.id),
    ["c_fail"]
  );
});

await test("no outbound WhatsApp send / no Gemini / no auto AI in inbound path", () => {
  assert.equal(inboundSrc.includes("sendWhatsAppWebPlainText"), false);
  assert.equal(inboundSrc.includes("insertOutboundMessage"), false);
  assert.equal(inboundSrc.includes("generateContent"), false);
  assert.equal(inboundSrc.includes("@google/generative-ai"), false);
  assert.equal(inboundSrc.includes("GOOGLE_API_KEY"), false);
});

await test("@lid protection remains intact", async () => {
  __resetSharedWhatsAppLidPhoneMap();
  const map = getSharedWhatsAppLidPhoneMap();
  const lid = "123456789012345@lid";
  assert.equal(map.resolvePhoneJid(lid), null);
  map.remember(lid, "923009998877@s.whatsapp.net");
  assert.equal(map.resolvePhoneJid(lid), "923009998877@s.whatsapp.net");
  // Unmapped @lid must not resolve to a phone JID.
  assert.equal(map.resolvePhoneJid("15551234567@lid"), null);
});

await test("encodeInboxCursor still opaque for pagination", () => {
  const encoded = encodeInboxCursor({
    at: "2026-07-26T10:00:00.000Z",
    id: "c1",
  });
  assert.ok(typeof encoded === "string" && encoded.length > 0);
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01-R1 server test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01-R1 server tests passed");
