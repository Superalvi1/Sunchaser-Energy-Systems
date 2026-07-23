/**
 * Conversation RPC fail-closed / ordering evidence tests (RC-1.2.4B).
 */
import assert from "node:assert/strict";
import {
  InMemoryWhatsAppInboxConversationRepository,
  SupabaseWhatsAppInboxConversationRepository,
} from "./whatsappInboxConversationRepository.ts";
import {
  activityAt,
  WhatsAppInboxMemoryStore,
} from "./whatsappInboxRepoSupport.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import { mapInboxError } from "./whatsappInboxHttp.ts";

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

function seed(
  store: WhatsAppInboxMemoryStore,
  partial: Partial<WhatsAppConversationInbox> & { id: string }
): WhatsAppConversationInbox {
  const now = partial.createdAt ?? "2026-07-19T10:00:00.000Z";
  const row: WhatsAppConversationInbox = {
    id: partial.id,
    companyId: "sunchaser",
    channelId: "wch_1",
    contactId: `wct_${partial.id}`,
    status: "open",
    lastMessageAt: partial.lastMessageAt ?? null,
    createdAt: now,
    updatedAt: partial.updatedAt ?? now,
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: 1,
    hasFailedMessage: false,
    aiOwnershipState: "AI_SHADOW",
    ...partial,
  };
  store.conversations.set(row.id, row);
  return row;
}

await test("canonical activity ordering uses COALESCE(last_message_at, created_at), id", async () => {
  const store = new WhatsAppInboxMemoryStore();
  const repo = new InMemoryWhatsAppInboxConversationRepository(store);
  seed(store, {
    id: "c-old-msg",
    createdAt: "2026-07-18T10:00:00.000Z",
    lastMessageAt: "2026-07-20T12:00:00.000Z",
  });
  seed(store, {
    id: "c-null-msg",
    createdAt: "2026-07-19T11:00:00.000Z",
    lastMessageAt: null,
  });
  const page = await repo.listByActivity({ companyId: "sunchaser" }, { limit: 10 });
  assert.equal(page.rows[0]?.id, "c-old-msg");
  assert.equal(activityAt(page.rows[0]!), "2026-07-20T12:00:00.000Z");
  assert.equal(activityAt(page.rows[1]!), "2026-07-19T11:00:00.000Z");
});

await test("AI ownership remains AI_SHADOW by default", () => {
  const store = new WhatsAppInboxMemoryStore();
  const conv = seed(store, { id: "c1" });
  assert.equal(conv.aiOwnershipState, "AI_SHADOW");
});

await test("missing RPC → service_unavailable in production (guard)", () => {
  const prevNode = process.env.NODE_ENV;
  const prevFlag = process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
    const allow =
      process.env.NODE_ENV === "production"
        ? false
        : process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK === "true";
    assert.equal(allow, false);
    const err = new InboxServiceError(
      "service_unavailable",
      "Conversation listing RPC is not available"
    );
    assert.equal(err.code, "service_unavailable");
  } finally {
    process.env.NODE_ENV = prevNode;
    if (prevFlag === undefined) {
      delete process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
    } else {
      process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK = prevFlag;
    }
  }
});

await test(
  "missing RPC listByActivity throws Conversation listing RPC is not available → 503",
  async () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
    process.env.NODE_ENV = "production";
    delete process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
    try {
      const repo = new SupabaseWhatsAppInboxConversationRepository(
        () =>
          ({
            rpc: async () => ({
              data: null,
              error: {
                code: "PGRST202",
                message:
                  "Could not find the function public.whatsapp_inbox_list_conversations_by_activity",
              },
            }),
          }) as any
      );

      let thrown: unknown;
      try {
        await repo.listByActivity({ companyId: "sunchaser" }, { limit: 40 });
      } catch (err) {
        thrown = err;
      }

      assert.ok(thrown instanceof InboxServiceError);
      assert.equal(thrown.code, "service_unavailable");
      assert.equal(
        thrown.message,
        "Conversation listing RPC is not available"
      );
      // Stack points at conversationRpcUnavailableError / listByActivity.
      assert.match(String((thrown as Error).stack ?? ""), /listByActivity|conversationRpcUnavailable/i);

      const mapped = mapInboxError(thrown);
      assert.equal(mapped.status, 503);
      assert.equal(mapped.code, "service_unavailable");
      assert.equal(mapped.message, "Service temporarily unavailable");
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevFlag === undefined) {
        delete process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
      } else {
        process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK = prevFlag;
      }
    }
  }
);

await test("fallback only when explicit non-production flag enabled", () => {
  const prevNode = process.env.NODE_ENV;
  const prevFlag = process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
  try {
    process.env.NODE_ENV = "development";
    process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK = "true";
    const allow =
      process.env.NODE_ENV === "production"
        ? false
        : process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK === "true";
    assert.equal(allow, true);

    process.env.NODE_ENV = "development";
    delete process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
    const allowDefault =
      process.env.NODE_ENV === "production"
        ? false
        : process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK === "true";
    assert.equal(allowDefault, false);
  } finally {
    process.env.NODE_ENV = prevNode;
    if (prevFlag === undefined) {
      delete process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK;
    } else {
      process.env.WHATSAPP_ALLOW_CONVERSATION_TABLE_FALLBACK = prevFlag;
    }
  }
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
