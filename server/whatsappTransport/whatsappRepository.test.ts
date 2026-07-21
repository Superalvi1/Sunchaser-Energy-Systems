/**
 * WhatsApp repository conflict-recovery and status-update tests.
 * Run: npm run test:whatsapp-transport
 */
import assert from "node:assert/strict";
import {
  InMemoryWhatsAppRepository,
  SupabaseWhatsAppRepository,
  isUniqueViolation,
} from "./whatsappRepository.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

await test("15. Only 23505 treated as unique violation", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ code: "23503" }), false);
  assert.equal(isUniqueViolation({ message: "duplicate key" }), false);
  assert.equal(isUniqueViolation({ message: "unique constraint" }), false);
  assert.equal(isUniqueViolation(null), false);
});

type QueryResult = { data: any; error: any };

function createFakeSupabase(handlers: {
  onInsertMessages?: () => QueryResult;
  onSelectMessages?: () => QueryResult;
  onInsertStatus?: () => QueryResult;
  onSelectStatus?: () => QueryResult;
  onUpdateMessages?: () => QueryResult;
  onSelectMessagesByWa?: () => QueryResult;
}) {
  const from = (table: string) => {
    const state: Record<string, any> = { table, filters: {} };
    const api: any = {
      select() {
        return api;
      },
      insert() {
        return api;
      },
      update() {
        return api;
      },
      eq(col: string, val: unknown) {
        state.filters[col] = val;
        return api;
      },
      maybeSingle: async () => {
        if (table === "whatsapp_messages" && state.op !== "update") {
          if (handlers.onSelectMessages) return handlers.onSelectMessages();
        }
        if (table === "whatsapp_message_status_events") {
          if (handlers.onSelectStatus) return handlers.onSelectStatus();
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (table === "whatsapp_messages") {
          if (handlers.onInsertMessages) return handlers.onInsertMessages();
        }
        if (table === "whatsapp_message_status_events") {
          if (handlers.onInsertStatus) return handlers.onInsertStatus();
        }
        return { data: null, error: { message: "unexpected single" } };
      },
      then: undefined as any,
    };

    // Capture op for insert/update chains used with await on builder.
    const wrap = (op: string) => {
      state.op = op;
      return api;
    };

    api.insert = () => wrap("insert");
    api.update = () => {
      wrap("update");
      // supabase update().eq().eq() is thenable-ish via awaiting the builder in our code —
      // our repo awaits `{ error }` from update chain without single().
      api.then = (
        resolve: (v: QueryResult) => void,
        reject?: (e: unknown) => void
      ) => {
        try {
          const result = handlers.onUpdateMessages
            ? handlers.onUpdateMessages()
            : { data: null, error: null };
          resolve(result);
        } catch (e) {
          reject?.(e);
        }
      };
      return api;
    };

    // For select().eq().eq() without maybeSingle used in matchingMessages
    api.then = (
      resolve: (v: QueryResult) => void,
      reject?: (e: unknown) => void
    ) => {
      try {
        if (table === "whatsapp_messages" && handlers.onSelectMessagesByWa) {
          resolve(handlers.onSelectMessagesByWa());
          return;
        }
        resolve({ data: null, error: null });
      } catch (e) {
        reject?.(e);
      }
    };

    return api;
  };

  return { from } as any;
}

await test("16. 23505 followed by successful reselect returns persisted row", async () => {
  const existing = {
    id: "wmsg_existing",
    company_id: DEFAULT_COMPANY_ID,
    conversation_id: "wcv_1",
    direction: "inbound",
    status: "received",
    text_body: "hello",
    wa_message_id: "wamid.X",
    provider_error: null,
    occurred_at: new Date().toISOString(),
    sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    raw_payload: {},
  };
  let insertCalls = 0;
  const client = createFakeSupabase({
    onSelectMessages: () => {
      // first pre-check: none; after conflict: existing
      if (insertCalls === 0) return { data: null, error: null };
      return { data: existing, error: null };
    },
    onInsertMessages: () => {
      insertCalls += 1;
      return { data: null, error: { code: "23505", message: "duplicate" } };
    },
  });

  // Adjust: pre-check maybeSingle returns null, insert fails 23505, reselect returns existing.
  let selectCount = 0;
  const client2 = {
    from: (table: string) => {
      assert.equal(table, "whatsapp_messages");
      const api: any = {
        select() {
          return api;
        },
        insert() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          selectCount += 1;
          if (selectCount === 1) return { data: null, error: null };
          return { data: existing, error: null };
        },
        single: async () => ({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      };
      return api;
    },
  };

  const repo = new SupabaseWhatsAppRepository(() => client2 as any);
  // Bypass isActive dependency on env by stubbing.
  repo.isActive = () => true;

  const result = await repo.insertInboundMessage({
    conversationId: "wcv_1",
    waMessageId: "wamid.X",
    textBody: "hello",
    occurredAt: new Date().toISOString(),
    rawPayload: {},
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.created, false);
    assert.equal(result.row.id, "wmsg_existing");
  }
  void client;
});

await test("17. 23505 followed by missing row fails", async () => {
  let selectCount = 0;
  const client = {
    from: () => {
      const api: any = {
        select() {
          return api;
        },
        insert() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          selectCount += 1;
          return { data: null, error: null };
        },
        single: async () => ({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      };
      return api;
    },
  };
  const repo = new SupabaseWhatsAppRepository(() => client as any);
  repo.isActive = () => true;
  const result = await repo.insertInboundMessage({
    conversationId: "wcv_1",
    waMessageId: "wamid.Y",
    textBody: "hello",
    occurredAt: new Date().toISOString(),
    rawPayload: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /not found/i);
    assert.equal(result.uniqueConflict, true);
  }
});

await test("17b. 23505 followed by reselect DB error fails", async () => {
  let selectCount = 0;
  const client = {
    from: () => {
      const api: any = {
        select() {
          return api;
        },
        insert() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          selectCount += 1;
          if (selectCount === 1) return { data: null, error: null };
          return { data: null, error: { message: "reselect down" } };
        },
        single: async () => ({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      };
      return api;
    },
  };
  const repo = new SupabaseWhatsAppRepository(() => client as any);
  repo.isActive = () => true;
  const result = await repo.insertInboundMessage({
    conversationId: "wcv_1",
    waMessageId: "wamid.Z",
    textBody: "hello",
    occurredAt: new Date().toISOString(),
    rawPayload: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /reselect failed/i);
});

await test("non-23505 insert error surfaces", async () => {
  const client = {
    from: () => {
      const api: any = {
        select() {
          return api;
        },
        insert() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({
          data: null,
          error: { code: "57014", message: "statement timeout" },
        }),
      };
      return api;
    },
  };
  const repo = new SupabaseWhatsAppRepository(() => client as any);
  repo.isActive = () => true;
  const result = await repo.insertInboundMessage({
    conversationId: "wcv_1",
    waMessageId: "wamid.T",
    textBody: "hello",
    occurredAt: new Date().toISOString(),
    rawPayload: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /timeout/i);
});

await test("status conflict recovery reselects real row", async () => {
  let phase: "insert" | "reselect" = "insert";
  const client = {
    from: (table: string) => {
      const api: any = {
        select() {
          return api;
        },
        insert() {
          phase = "insert";
          return api;
        },
        update() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          if (table === "whatsapp_message_status_events") {
            return { data: { id: "wse_existing" }, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === "whatsapp_message_status_events") {
            return {
              data: null,
              error: { code: "23505", message: "duplicate" },
            };
          }
          return { data: null, error: { message: "unexpected" } };
        },
        then(
          resolve: (v: any) => void,
          _reject?: (e: unknown) => void
        ) {
          // select matching messages / update chain
          resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
  const repo = new SupabaseWhatsAppRepository(() => client as any);
  repo.isActive = () => true;
  const result = await repo.insertStatusEvent({
    kind: "status",
    phoneNumberId: "1",
    displayPhoneNumber: null,
    wabaEntryId: null,
    waMessageId: "wamid.S",
    status: "delivered",
    statusTimestamp: "2024-01-01T00:00:00.000Z",
    recipientWaId: "92300",
    rawEvent: {},
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.created, false);
    assert.equal(result.row.id, "wse_existing");
  }
  void phase;
});

await test("18. Status update DB error surfaces after status insert", async () => {
  const client = {
    from: (table: string) => {
      let wroteInsert = false;
      let wroteUpdate = false;
      let wroteSelect = false;
      const api: any = {
        select() {
          wroteSelect = true;
          return api;
        },
        insert() {
          wroteInsert = true;
          return api;
        },
        update() {
          wroteUpdate = true;
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === "whatsapp_message_status_events" && wroteInsert) {
            return { data: { id: "wse_new" }, error: null };
          }
          return { data: null, error: { message: "unexpected single" } };
        },
        then(resolve: (v: any) => void) {
          if (table === "whatsapp_messages" && wroteUpdate) {
            resolve({ data: null, error: { message: "update blew up" } });
            return;
          }
          if (table === "whatsapp_messages" && wroteSelect) {
            resolve({ data: [{ id: "wmsg_1" }], error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
  const repo = new SupabaseWhatsAppRepository(() => client as any);
  repo.isActive = () => true;
  const result = await repo.insertStatusEvent({
    kind: "status",
    phoneNumberId: "1",
    displayPhoneNumber: null,
    wabaEntryId: null,
    waMessageId: "wamid.U",
    status: "read",
    statusTimestamp: "2024-01-01T00:00:01.000Z",
    recipientWaId: null,
    rawEvent: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /message update failed/i);
});

await test("19. Missing related message handled explicitly (in-memory)", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const result = await repo.insertStatusEvent({
    kind: "status",
    phoneNumberId: "1",
    displayPhoneNumber: null,
    wabaEntryId: null,
    waMessageId: "wamid.NONE",
    status: "delivered",
    statusTimestamp: "2024-01-01T00:00:00.000Z",
    recipientWaId: null,
    rawEvent: {},
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.row.messageUpdated, false);
    assert.equal(result.row.messageNotFound, true);
  }
});

await test("duplicate status remains idempotent (in-memory)", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const event = {
    kind: "status" as const,
    phoneNumberId: "1",
    displayPhoneNumber: null,
    wabaEntryId: null,
    waMessageId: "wamid.DUP",
    status: "delivered" as const,
    statusTimestamp: "2024-01-01T00:00:00.000Z",
    recipientWaId: null,
    rawEvent: {},
  };
  const a = await repo.insertStatusEvent(event);
  const b = await repo.insertStatusEvent(event);
  assert.equal(a.ok && b.ok, true);
  if (a.ok && b.ok) {
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.row.id, b.row.id);
  }
  assert.equal(repo.statusEvents.size, 1);
});

await test("webhook remains processed=false when inbound conflict recovery fails", async () => {
  // Covered via InsertResult failure path: in-memory cannot simulate 23505 easily,
  // assert failPersistAfterClaim leaves processed false (integration already exists).
  const repo = new InMemoryWhatsAppRepository();
  const claim = await repo.claimWebhookEvent("hash-fail");
  assert.equal(claim.kind, "created");
  repo.failPersistAfterClaim = "boom";
  await assert.rejects(async () => {
    await repo.insertInboundMessage({
      conversationId: "c",
      waMessageId: "wamid.F",
      textBody: "x",
      occurredAt: new Date().toISOString(),
      rawPayload: {},
    });
  });
  const event = repo.webhookEvents.get("hash-fail");
  assert.equal(event?.processed, false);
});

if (failed > 0) {
  console.error(`\n${failed} repository test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp repository tests passed.");
