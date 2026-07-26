/**
 * WHATSAPP-LIVE-01-R2 — filtered cache repartition + bounded All delta.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAllDeltaToConversationPages,
  applyFilteredMembershipUpdate,
  conversationIdSet,
  flattenConversationIds,
  INBOX_CONVERSATION_PAGE_SIZE,
  resetToAuthoritativeFirstPage,
  type InfiniteConversationsData,
} from "./inboxConversationCache.ts";
import type { InboxConversation, InboxListPage } from "../types";

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

const here = dirname(fileURLToPath(import.meta.url));
const conversationsHook = readFileSync(
  join(here, "useInboxConversations.ts"),
  "utf8"
);

function conv(
  id: string,
  at: string,
  extras: Partial<InboxConversation> = {}
): InboxConversation {
  return {
    id,
    companyId: "sunchaser",
    channelId: "wch_1",
    contactId: `wct_${id}`,
    status: "open",
    lastMessageAt: at,
    createdAt: at,
    updatedAt: at,
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: 1,
    hasFailedMessage: false,
    isUnread: true,
    unreadCount: 1,
    ...extras,
  } as InboxConversation;
}

function page(
  rows: InboxConversation[],
  nextCursor: string | null = null,
  totalUnreadCount?: number
): InboxListPage {
  return { conversations: rows, nextCursor, totalUnreadCount };
}

await test(
  "authoritative refresh drops stale older pages (page-2 mark-read gone)",
  () => {
    const p1 = Array.from({ length: 40 }, (_, i) =>
      conv(`p1_${i}`, `2026-07-20T12:${String(i).padStart(2, "0")}:00.000Z`)
    );
    const p2Row = conv("c_page2_unread", "2026-07-19T08:00:00.000Z");
    const cached: InfiniteConversationsData = {
      pages: [page(p1, "cursor_p1", 41), page([p2Row], null, 41)],
      pageParams: [null, "cursor_p1"],
    };

    // Authoritative first page after mark-read: page2 row no longer unread.
    const fresh = page(p1, "cursor_fresh", 40);
    const next = resetToAuthoritativeFirstPage(fresh);

    assert.equal(next.pages.length, 1);
    assert.deepEqual(next.pageParams, [null]);
    assert.equal(conversationIdSet(next).has("c_page2_unread"), false);
    assert.equal(next.pages[0]!.nextCursor, "cursor_fresh");
    assert.equal(next.pages[0]!.totalUnreadCount, 40);
    // Previously cached older page is not combined with the new page 1.
    assert.notEqual(cached.pages.length, next.pages.length);
  }
);

await test(
  "page-2 inbound moves to page 1 exactly once after membership update",
  () => {
    const p1 = Array.from({ length: 40 }, (_, i) =>
      conv(`a_${i}`, `2026-07-21T10:${String(i).padStart(2, "0")}:00.000Z`)
    );
    const rising = conv("c_rising", "2026-07-21T09:00:00.000Z");
    const cached: InfiniteConversationsData = {
      pages: [page(p1, "cur1"), page([rising], "cur2")],
      pageParams: [null, "cur1"],
    };

    const promoted = conv("c_rising", "2026-07-21T11:00:00.000Z");
    const next = applyFilteredMembershipUpdate(cached, {
      upsert: [promoted],
      removeIds: [],
      pageSize: 40,
      totalUnreadCount: 41,
    });

    const ids = flattenConversationIds(next);
    assert.equal(ids.filter((id) => id === "c_rising").length, 1);
    assert.equal(next.pages[0]!.conversations[0]!.id, "c_rising");
    assert.equal(conversationIdSet(next).size, ids.length);
  }
);

await test(
  "insertion at page-1 boundary produces neither loss nor duplication",
  () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      conv(`b_${i}`, `2026-07-22T08:${String(i).padStart(2, "0")}:00.000Z`)
    );
    const boundary = rows[rows.length - 1]!;
    const cached: InfiniteConversationsData = {
      pages: [page(rows, "term")],
      pageParams: [null],
    };

    const newer = conv("c_new_top", "2026-07-22T09:00:00.000Z");
    const next = applyAllDeltaToConversationPages([newer], cached, {
      pageSize: 40,
      totalUnreadCount: 41,
    });

    assert.equal(next.pages[0]!.conversations.length, 40);
    assert.equal(next.pages[0]!.conversations[0]!.id, "c_new_top");
    const all = flattenConversationIds(next);
    assert.ok(all.includes(boundary.id), "displaced boundary retained");
    assert.equal(all.length, new Set(all).size);
    assert.equal(all.length, 41);
  }
);

await test(
  "pageParams and nextCursor stay consistent after authoritative refresh",
  () => {
    const fresh = page(
      [conv("c1", "2026-07-23T10:00:00.000Z")],
      "server_next",
      1
    );
    const next = resetToAuthoritativeFirstPage(fresh);
    assert.deepEqual(next.pageParams, [null]);
    assert.equal(next.pages.length, 1);
    assert.equal(next.pages[0]!.nextCursor, "server_next");
    // fetchNextPage would use last page nextCursor === server_next
    assert.equal(next.pages[next.pages.length - 1]!.nextCursor, "server_next");
  }
);

await test(
  "filter refresh then fetchNextPage uses authoritative nextCursor",
  () => {
    const stale: InfiniteConversationsData = {
      pages: [
        page(
          Array.from({ length: 40 }, (_, i) =>
            conv(`old_${i}`, `2026-07-24T01:${String(i).padStart(2, "0")}:00.000Z`)
          ),
          "stale_cursor"
        ),
        page([conv("stale_p2", "2026-07-24T00:00:00.000Z")], "stale_more"),
      ],
      pageParams: [null, "stale_cursor"],
    };
    void stale;
    const authoritative = resetToAuthoritativeFirstPage(
      page(
        Array.from({ length: 40 }, (_, i) =>
          conv(`n_${i}`, `2026-07-24T02:${String(i).padStart(2, "0")}:00.000Z`)
        ),
        "auth_next",
        50
      )
    );
    assert.equal(authoritative.pages.length, 1);
    assert.equal(authoritative.pageParams.length, 1);
    assert.equal(authoritative.pages[0]!.nextCursor, "auth_next");
    // No stale page-2 members remain for a subsequent fetchNextPage to resurrect.
    assert.equal(conversationIdSet(authoritative).has("stale_p2"), false);
  }
);

await test("repeated All delta refresh keeps page 1 bounded", () => {
  let data: InfiniteConversationsData | undefined = {
    pages: [
      page(
        Array.from({ length: 40 }, (_, i) =>
          conv(`s_${i}`, `2026-07-25T00:${String(i).padStart(2, "0")}:00.000Z`)
        ),
        "term"
      ),
    ],
    pageParams: [null],
  };

  for (let cycle = 0; cycle < 20; cycle++) {
    const incoming = [
      conv(
        `delta_${cycle}`,
        `2026-07-25T01:${String(cycle).padStart(2, "0")}:00.000Z`
      ),
    ];
    data = applyAllDeltaToConversationPages(incoming, data, { pageSize: 40 });
    assert.ok(
      (data.pages[0]?.conversations.length ?? 0) <= INBOX_CONVERSATION_PAGE_SIZE
    );
  }
  const ids = flattenConversationIds(data);
  assert.equal(ids.length, new Set(ids).size);
});

await test("IDs remain duplicate-free across all conversation pages", () => {
  const overlapping = conv("shared", "2026-07-26T10:00:00.000Z");
  const data = applyAllDeltaToConversationPages(
    [overlapping, conv("newer", "2026-07-26T11:00:00.000Z")],
    {
      pages: [
        page(
          [
            overlapping,
            ...Array.from({ length: 39 }, (_, i) =>
              conv(`x_${i}`, `2026-07-26T09:${String(i).padStart(2, "0")}:00.000Z`)
            ),
          ],
          "c"
        ),
      ],
      pageParams: [null],
    }
  );
  const ids = flattenConversationIds(data);
  assert.equal(ids.filter((id) => id === "shared").length, 1);
  assert.equal(ids.length, new Set(ids).size);
});

await test("hook uses resetToAuthoritativeFirstPage (no stale older pages)", () => {
  assert.ok(conversationsHook.includes("resetToAuthoritativeFirstPage"));
  assert.ok(conversationsHook.includes("applyAllDeltaToConversationPages"));
  assert.ok(conversationsHook.includes("FILTERED_AUTHORITATIVE_REFRESH_MS"));
  assert.equal(
    conversationsHook.includes("pages: [nextFirst, ...rest]"),
    false
  );
  assert.equal(
    conversationsHook.includes("Preserve older pages when present"),
    false
  );
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01-R2 UI test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01-R2 UI tests passed");
