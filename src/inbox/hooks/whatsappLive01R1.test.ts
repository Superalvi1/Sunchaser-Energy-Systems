/**
 * WHATSAPP-LIVE-01-R1 — behavioral proofs for bounded message cache
 * and server-driven quick-filter query keys (no Gemini / no WhatsApp send).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INBOX_MESSAGE_PAGE_SIZE,
  newestPageSize,
  repartitionLiveMessagePages,
  type InfiniteMessagesData,
} from "./inboxMessageCache.ts";
import type { InboxMessage, InboxMessagesPage } from "../types";
import { buildListQuery } from "../api/inboxApi.ts";

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
const messagesHook = readFileSync(join(here, "useInboxMessages.ts"), "utf8");
const apiSrc = readFileSync(join(here, "../api/inboxApi.ts"), "utf8");

function msg(id: string, createdAt: string): InboxMessage {
  return {
    id,
    conversationId: "c1",
    companyId: "sunchaser",
    direction: "inbound",
    status: "received",
    textBody: id,
    createdAt,
    occurredAt: createdAt,
  } as InboxMessage;
}

function page(
  messages: InboxMessage[],
  nextCursor: string | null = null
): InboxMessagesPage {
  return { messages, nextCursor };
}

await test("buildListQuery includes quickFilter for server tabs", () => {
  assert.ok(buildListQuery({ quickFilter: "unread" }).includes("quickFilter=unread"));
  assert.ok(buildListQuery({ quickFilter: "read" }).includes("quickFilter=read"));
  assert.ok(buildListQuery({ quickFilter: "open" }).includes("quickFilter=open"));
  assert.ok(
    buildListQuery({ quickFilter: "resolved" }).includes("quickFilter=resolved")
  );
  assert.ok(
    buildListQuery({ quickFilter: "archived" }).includes("quickFilter=archived")
  );
  assert.equal(buildListQuery({ quickFilter: "all" }).includes("quickFilter"), false);
  assert.ok(apiSrc.includes("quickFilter"));
});

await test("conversation hook keys list by quickFilter (no client-page filter)", () => {
  assert.ok(conversationsHook.includes("quickFilter"));
  assert.ok(conversationsHook.includes("normalizeServerFilters"));
  assert.ok(conversationsHook.includes("totalUnreadCount"));
  assert.ok(conversationsHook.includes("usesServerExclusiveFilter"));
  // Must not client-filter Unread/Read/Open against the loaded page only.
  assert.equal(conversationsHook.includes("matchesQuickFilter"), false);
  assert.ok(conversationsHook.includes("filterKey"));
});

await test(
  "after many live refresh cycles, newest page remains bounded",
  () => {
    let data: InfiniteMessagesData | undefined = {
      pages: [
        page(
          Array.from({ length: 50 }, (_, i) =>
            msg(`m_${i}`, `2026-07-01T00:${String(i).padStart(2, "0")}:00.000Z`)
          ),
          "cursor_old"
        ),
      ],
      pageParams: [null],
    };

    for (let cycle = 0; cycle < 25; cycle++) {
      const newest = Array.from({ length: 50 }, (_, i) =>
        msg(
          `m_c${cycle}_${i}`,
          `2026-07-02T${String(cycle).padStart(2, "0")}:${String(i).padStart(2, "0")}:00.000Z`
        )
      );
      data = repartitionLiveMessagePages(page(newest, "cursor_server"), data);
      assert.ok(
        newestPageSize(data) <= INBOX_MESSAGE_PAGE_SIZE,
        `cycle ${cycle} grew newest page to ${newestPageSize(data)}`
      );
      assert.equal(data.pages[0]!.messages.length, INBOX_MESSAGE_PAGE_SIZE);
    }
  }
);

await test("no messages lost at page boundary during live refresh", () => {
  const olderBoundary = msg("m_boundary", "2026-07-10T00:00:00.000Z");
  const firstBatch = [
    ...Array.from({ length: 49 }, (_, i) =>
      msg(`m_new_${i}`, `2026-07-10T01:${String(i).padStart(2, "0")}:00.000Z`)
    ),
    olderBoundary,
  ];
  let data = repartitionLiveMessagePages(page(firstBatch, "cursor_a"), undefined);

  // Fresh page drops the boundary message (simulates it aging out of newest 50).
  const freshWithoutBoundary = Array.from({ length: 50 }, (_, i) =>
    msg(`m_fresh_${i}`, `2026-07-10T02:${String(i).padStart(2, "0")}:00.000Z`)
  );
  data = repartitionLiveMessagePages(
    page(freshWithoutBoundary, "cursor_b"),
    data
  );

  const allIds = data.pages.flatMap((p) => p.messages.map((m) => m.id));
  assert.ok(
    allIds.includes("m_boundary"),
    "displaced boundary message must remain in cache"
  );
  assert.equal(data.pages[0]!.messages.length, 50);
  assert.equal(
    data.pages[0]!.messages.some((m) => m.id === "m_boundary"),
    false,
    "boundary must not remain on newest page after displacement"
  );
});

await test("older-message pagination remains correct and duplicate-free", () => {
  const page1 = page(
    Array.from({ length: 50 }, (_, i) =>
      msg(`p1_${i}`, `2026-07-11T01:${String(i).padStart(2, "0")}:00.000Z`)
    ),
    "cursor_p1"
  );
  const page2 = page(
    Array.from({ length: 50 }, (_, i) =>
      msg(`p2_${i}`, `2026-07-11T00:${String(i).padStart(2, "0")}:00.000Z`)
    ),
    "cursor_p2"
  );
  let data: InfiniteMessagesData = {
    pages: [page1, page2],
    pageParams: [null, "cursor_p1"],
  };

  const fresh = page(
    Array.from({ length: 50 }, (_, i) =>
      msg(`fresh_${i}`, `2026-07-11T02:${String(i).padStart(2, "0")}:00.000Z`)
    ),
    "cursor_fresh"
  );
  // Include one overlap id that also existed on page1.
  fresh.messages[49] = msg("p1_0", "2026-07-11T01:00:00.000Z");

  data = repartitionLiveMessagePages(fresh, data);
  const ids = data.pages.flatMap((p) => p.messages.map((m) => m.id));
  assert.equal(ids.length, new Set(ids).size, "duplicate message ids");
  assert.equal(
    data.pages[data.pages.length - 1]!.nextCursor,
    "cursor_p2",
    "terminal older cursor must be preserved"
  );
  assert.ok(messagesHook.includes("repartitionLiveMessagePages"));
});

await test("message hook uses repartition not unbounded merge", () => {
  assert.ok(messagesHook.includes("repartitionLiveMessagePages"));
  assert.equal(messagesHook.includes("mergeNewestFirst"), false);
  assert.ok(messagesHook.includes("INBOX_MESSAGE_PAGE_SIZE"));
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01-R1 UI test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01-R1 UI tests passed");
