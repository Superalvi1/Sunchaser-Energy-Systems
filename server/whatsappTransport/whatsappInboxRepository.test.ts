/**
 * PR 2 inbox repository regression tests (Step 2A).
 * Run: npm run test:whatsapp-inbox
 */
import assert from "node:assert/strict";
import {
  createDefaultWhatsAppInboxRepositories,
  createInMemoryWhatsAppInboxRepositories,
} from "./whatsappInboxRepository.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import type { KeysetCursor } from "./whatsappInboxRepoSupport.ts";

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

function seedConversation(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<WhatsAppConversationInbox, "id" | "updatedAt"> &
    Partial<WhatsAppConversationInbox>
): void {
  const now = partial.updatedAt;
  store.conversations.set(partial.id, {
    id: partial.id,
    companyId: "sunchaser",
    channelId: "wch_1",
    contactId: `wct_${partial.id}`,
    status: "open",
    lastMessageAt: now,
    createdAt: now,
    updatedAt: partial.updatedAt,
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: 1,
    hasFailedMessage: false,
    ...partial,
  });
}

await test(
  "delta pagination: page1 → cursor → page2 complete traversal, no duplicates",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    // Same updated_at on two rows exercises id tie-break; others are strictly increasing.
    seedConversation(repos.store, {
      id: "wcv_01",
      updatedAt: "2026-07-19T10:00:00.000Z",
    });
    seedConversation(repos.store, {
      id: "wcv_02",
      updatedAt: "2026-07-19T10:00:00.000Z",
    });
    seedConversation(repos.store, {
      id: "wcv_03",
      updatedAt: "2026-07-19T10:01:00.000Z",
    });
    seedConversation(repos.store, {
      id: "wcv_04",
      updatedAt: "2026-07-19T10:02:00.000Z",
    });
    seedConversation(repos.store, {
      id: "wcv_05",
      updatedAt: "2026-07-19T10:03:00.000Z",
    });

    const since: KeysetCursor = {
      at: "1970-01-01T00:00:00.000Z",
      id: "",
    };

    const page1 = await repos.conversations.listDelta({}, { since, limit: 2 });
    assert.deepEqual(
      page1.rows.map((r) => r.id),
      ["wcv_01", "wcv_02"]
    );
    assert.ok(page1.nextCursor, "page1 must produce a cursor");
    assert.equal(page1.nextCursor!.at, "2026-07-19T10:00:00.000Z");
    assert.equal(page1.nextCursor!.id, "wcv_02");

    const page2 = await repos.conversations.listDelta(
      {},
      { since: page1.nextCursor!, limit: 2 }
    );
    assert.deepEqual(
      page2.rows.map((r) => r.id),
      ["wcv_03", "wcv_04"]
    );
    assert.ok(page2.nextCursor, "page2 must produce a cursor");

    const page3 = await repos.conversations.listDelta(
      {},
      { since: page2.nextCursor!, limit: 2 }
    );
    assert.deepEqual(
      page3.rows.map((r) => r.id),
      ["wcv_05"]
    );
    assert.equal(page3.nextCursor, null, "final page has no next cursor");

    const allIds = [
      ...page1.rows.map((r) => r.id),
      ...page2.rows.map((r) => r.id),
      ...page3.rows.map((r) => r.id),
    ];
    assert.deepEqual(allIds, [
      "wcv_01",
      "wcv_02",
      "wcv_03",
      "wcv_04",
      "wcv_05",
    ]);
    assert.equal(new Set(allIds).size, allIds.length, "no duplicate ids");

    // Re-querying page1 cursor must not re-include page1 rows (no loop).
    const afterPage1Again = await repos.conversations.listDelta(
      {},
      { since: page1.nextCursor!, limit: 10 }
    );
    const overlap = afterPage1Again.rows.filter((r) =>
      page1.rows.some((p) => p.id === r.id)
    );
    assert.equal(overlap.length, 0, "cursor must not loop back into prior page");
  }
);

await test(
  "delta pagination: equal updated_at ties advance by id only",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    const ts = "2026-07-19T12:00:00.000Z";
    seedConversation(repos.store, { id: "wcv_a", updatedAt: ts });
    seedConversation(repos.store, { id: "wcv_b", updatedAt: ts });
    seedConversation(repos.store, { id: "wcv_c", updatedAt: ts });

    const page1 = await repos.conversations.listDelta(
      {},
      { since: { at: "1970-01-01T00:00:00.000Z", id: "" }, limit: 2 }
    );
    assert.deepEqual(
      page1.rows.map((r) => r.id),
      ["wcv_a", "wcv_b"]
    );

    const page2 = await repos.conversations.listDelta(
      {},
      { since: page1.nextCursor!, limit: 2 }
    );
    assert.deepEqual(
      page2.rows.map((r) => r.id),
      ["wcv_c"]
    );
    assert.equal(page2.nextCursor, null);
  }
);

await test(
  "createDefaultWhatsAppInboxRepositories throws when Supabase inactive",
  () => {
    assert.throws(
      () => createDefaultWhatsAppInboxRepositories(() => null),
      (err: unknown) =>
        err instanceof Error &&
        /require active Supabase/i.test(err.message) &&
        /createInMemoryWhatsAppInboxRepositories/i.test(err.message)
    );
  }
);

await test(
  "createInMemoryWhatsAppInboxRepositories remains available for tests",
  async () => {
    const repos = createInMemoryWhatsAppInboxRepositories();
    assert.equal(repos.conversations.isActive(), true);
    const page = await repos.conversations.listDelta(
      {},
      { since: { at: "1970-01-01T00:00:00.000Z", id: "" }, limit: 10 }
    );
    assert.deepEqual(page.rows, []);
  }
);

if (failed > 0) {
  console.error(`\n${failed} inbox repository test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp inbox repository tests passed.");
