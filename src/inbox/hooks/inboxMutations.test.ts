/**
 * React Query inbox mutation cache behavior (Step 5B).
 * Run: npm run test:whatsapp-inbox-ui
 */
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import type {
  InboxConversation,
  InboxConversationDetail,
  InboxListPage,
  InboxMessage,
  InboxMessagesPage,
} from "../types";
import { inboxKeys } from "./inboxQueryKeys";

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

function sampleConversation(
  overrides: Partial<InboxConversation> = {}
): InboxConversation {
  return {
    id: "c1",
    companyId: "sunchaser",
    channelId: "wch_1",
    contactId: "wct_1",
    status: "open",
    lastMessageAt: "2026-07-19T12:00:00.000Z",
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-19T12:00:00.000Z",
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: 1,
    hasFailedMessage: false,
    ...overrides,
  };
}

function sampleDetail(
  overrides: Partial<InboxConversationDetail> = {}
): InboxConversationDetail {
  return {
    conversation: sampleConversation(),
    crmLink: null,
    freeForm: {
      freeFormAllowed: true,
      windowExpiresAt: "2026-07-20T12:00:00.000Z",
      latestInboundAt: "2026-07-19T11:00:00.000Z",
      latestInboundMessageId: "m_in",
    },
    selfHealed: false,
    ...overrides,
  };
}

await test("query keys are stable and hierarchical", () => {
  assert.deepEqual(inboxKeys.all, ["inbox"]);
  assert.deepEqual(inboxKeys.detail("c1"), ["inbox", "detail", "c1"]);
  assert.deepEqual(inboxKeys.messages("c1"), ["inbox", "messages", "c1"]);
  assert.ok(inboxKeys.list({ status: "open" })[0] === "inbox");
});

await test("optimistic send inserts pending message; rollback restores prior cache", () => {
  const qc = new QueryClient();
  const key = inboxKeys.messages("c1");
  const prior: { pages: InboxMessagesPage[]; pageParams: (string | null)[] } = {
    pageParams: [null],
    pages: [
      {
        messages: [
          {
            id: "m1",
            companyId: "sunchaser",
            conversationId: "c1",
            direction: "inbound",
            status: "received",
            textBody: "hello",
            createdAt: "2026-07-19T11:00:00.000Z",
            occurredAt: "2026-07-19T11:00:00.000Z",
          },
        ],
        nextCursor: null,
      },
    ],
  };
  qc.setQueryData(key, prior);

  const optimistic: InboxMessage = {
    id: "optimistic_1",
    companyId: "sunchaser",
    conversationId: "c1",
    direction: "outbound",
    status: "pending",
    textBody: "reply",
    createdAt: "2026-07-19T12:00:00.000Z",
    occurredAt: "2026-07-19T12:00:00.000Z",
  };

  qc.setQueryData(key, {
    ...prior,
    pages: [
      {
        ...prior.pages[0],
        messages: [optimistic, ...prior.pages[0].messages],
      },
    ],
  });

  const afterOpt = qc.getQueryData<typeof prior>(key)!;
  assert.equal(afterOpt.pages[0].messages[0].id, "optimistic_1");
  assert.equal(afterOpt.pages[0].messages.length, 2);

  // rollback on failure
  qc.setQueryData(key, prior);
  const afterRollback = qc.getQueryData<typeof prior>(key)!;
  assert.equal(afterRollback.pages[0].messages.length, 1);
  assert.equal(afterRollback.pages[0].messages[0].id, "m1");
});

await test("optimistic assign updates detail + list; rollback restores", () => {
  const qc = new QueryClient();
  const detailKey = inboxKeys.detail("c1");
  const listKey = inboxKeys.list({});
  const detail = sampleDetail();
  qc.setQueryData(detailKey, detail);
  qc.setQueryData(listKey, {
    pageParams: [null],
    pages: [
      {
        conversations: [detail.conversation],
        nextCursor: null,
      } satisfies InboxListPage,
    ],
  });

  const optimistic = {
    ...detail,
    conversation: {
      ...detail.conversation,
      assignedUserId: "u-staff",
      lockVersion: 2,
    },
  };
  qc.setQueryData(detailKey, optimistic);
  qc.setQueryData(listKey, {
    pageParams: [null],
    pages: [
      {
        conversations: [optimistic.conversation],
        nextCursor: null,
      },
    ],
  });

  assert.equal(
    qc.getQueryData<InboxConversationDetail>(detailKey)!.conversation
      .assignedUserId,
    "u-staff"
  );

  qc.setQueryData(detailKey, detail);
  qc.setQueryData(listKey, {
    pageParams: [null],
    pages: [{ conversations: [detail.conversation], nextCursor: null }],
  });

  assert.equal(
    qc.getQueryData<InboxConversationDetail>(detailKey)!.conversation
      .assignedUserId,
    null
  );
  assert.equal(
    qc.getQueryData<{ pages: InboxListPage[] }>(listKey)!.pages[0]
      .conversations[0].assignedUserId,
    null
  );
});

await test("invalidateQueries marks detail + lists stale", async () => {
  const qc = new QueryClient();
  qc.setQueryData(inboxKeys.detail("c1"), sampleDetail());
  qc.setQueryData(inboxKeys.list({}), {
    pageParams: [null],
    pages: [
      { conversations: [sampleConversation()], nextCursor: null },
    ],
  });

  await qc.invalidateQueries({ queryKey: inboxKeys.detail("c1") });
  await qc.invalidateQueries({ queryKey: inboxKeys.lists() });

  const detailState = qc.getQueryState(inboxKeys.detail("c1"));
  const listState = qc.getQueryState(inboxKeys.list({}));
  assert.equal(detailState?.isInvalidated, true);
  assert.equal(listState?.isInvalidated, true);
});

await test("loading and error query states", async () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const loadingPromise = qc.fetchQuery({
    queryKey: ["inbox", "loading-demo"],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true };
    },
  });
  assert.equal(qc.getQueryState(["inbox", "loading-demo"])?.status, "pending");
  await loadingPromise;
  assert.equal(qc.getQueryState(["inbox", "loading-demo"])?.status, "success");

  await assert.rejects(
    () =>
      qc.fetchQuery({
        queryKey: ["inbox", "error-demo"],
        queryFn: async () => {
          throw new Error("boom");
        },
      }),
    /boom/
  );
  assert.equal(qc.getQueryState(["inbox", "error-demo"])?.status, "error");
  assert.match(
    String(qc.getQueryState(["inbox", "error-demo"])?.error),
    /boom/
  );
});

await test("UI audio vs voice distinction helper model test", () => {
  const audioMsg: InboxMessage = {
    id: "m_aud",
    companyId: "sunchaser",
    conversationId: "c1",
    direction: "inbound",
    status: "received",
    textBody: null,
    createdAt: "2026-07-22T10:00:00.000Z",
    occurredAt: "2026-07-22T10:00:00.000Z",
    messageType: "audio",
    voice: false,
  };

  const voiceMsg: InboxMessage = {
    id: "m_voice",
    companyId: "sunchaser",
    conversationId: "c1",
    direction: "inbound",
    status: "received",
    textBody: null,
    createdAt: "2026-07-22T10:00:00.000Z",
    occurredAt: "2026-07-22T10:00:00.000Z",
    messageType: "audio",
    voice: true,
  };

  function renderLabel(msg: InboxMessage): string {
    const type = (msg.messageType || "").toLowerCase();
    if (type === "voice" || (type === "audio" && msg.voice)) {
      return "Voice note received";
    }
    if (type === "audio") {
      return "Audio received";
    }
    return "Message received";
  }

  assert.equal(renderLabel(audioMsg), "Audio received");
  assert.equal(renderLabel(voiceMsg), "Voice note received");
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll inbox UI React Query tests passed.");
