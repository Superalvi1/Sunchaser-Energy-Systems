/**
 * PR 2 Inbox API route tests (Step 4A).
 * Run: npm run test:whatsapp-inbox-routes
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { signAccessToken } from "../auth/jwt.ts";
import { createAuthorizationMiddleware } from "../middleware/authorization.ts";
import type { WhatsAppConversationInbox } from "./whatsappInboxDatabaseTypes.ts";
import {
  decodeInboxCursor,
  encodeInboxCursor,
  parseAssignBody,
  parseDeltaQuery,
  parseListConversationsQuery,
  parseReadWatermarkBody,
  parseSendMessageBody,
  parseStatusBody,
} from "./whatsappInboxDtos.ts";
import { mapInboxError } from "./whatsappInboxHttp.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import {
  createInMemoryWhatsAppInboxRepositories,
} from "./whatsappInboxRepository.ts";
import type { InboxMessageRef } from "./whatsappInboxRepoSupport.ts";
import { createWhatsAppInboxRouter } from "./whatsappInboxRoutes.ts";
import { createWhatsAppInboxServices } from "./whatsappInboxServices.ts";
import {
  createInboxOutboundSendPort,
  isInboxSendTransportReady,
} from "./whatsappInboxSendTransport.ts";

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

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "whatsapp-inbox-api-test-secret-min-32-chars!!";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;

const staffUser = {
  id: "u-staff",
  username: "staff",
  name: "Staff User",
  email: "staff@test.com",
  role: "Sales Executive",
  account_status: "Approved",
};

const adminUser = {
  id: "u-admin",
  username: "admin",
  name: "Admin User",
  email: "admin@test.com",
  role: "Admin",
  account_status: "Approved",
};

const technicianUser = {
  id: "u-tech",
  username: "tech",
  name: "Tech User",
  email: "tech@test.com",
  role: "Technician",
  account_status: "Approved",
};

const pendingStaff = {
  id: "u-pending",
  username: "pending",
  name: "Pending",
  email: "pending@test.com",
  role: "Sales Executive",
  account_status: "Pending",
};

function mockDb(users: unknown[]) {
  return { users } as any;
}

function seedConversation(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<WhatsAppConversationInbox, "id"> &
    Partial<WhatsAppConversationInbox>
): WhatsAppConversationInbox {
  const now = partial.updatedAt ?? "2026-07-19T10:00:00.000Z";
  const row: WhatsAppConversationInbox = {
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
  };
  store.conversations.set(row.id, row);
  return row;
}

function seedMessage(
  store: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>["store"],
  partial: Pick<InboxMessageRef, "id" | "conversationId" | "direction"> &
    Partial<InboxMessageRef>
): InboxMessageRef {
  const row: InboxMessageRef = {
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
  };
  store.messages.set(row.id, row);
  return row;
}

type HttpResult = { status: number; body: any };

async function withInboxServer(
  opts: {
    users?: unknown[];
    sendPort?: Parameters<typeof createWhatsAppInboxRouter>[0]["sendPort"];
    resolveSendPort?: Parameters<
      typeof createWhatsAppInboxRouter
    >[0]["resolveSendPort"];
    sendEnabled?: boolean;
    createLead?: Parameters<
      typeof createWhatsAppInboxServices
    >[1]["createLead"];
  },
  fn: (
    baseUrl: string,
    tokens: Record<string, string>,
    repos: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>
  ) => Promise<void>
): Promise<void> {
  const users = opts.users ?? [staffUser, adminUser, technicianUser, pendingStaff];
  const repos = createInMemoryWhatsAppInboxRepositories();
  const services = createWhatsAppInboxServices(repos, {
    now: () => Date.parse("2026-07-19T12:00:00.000Z"),
    assignees: {
      async getById(id) {
        const u = (users as any[]).find((x) => x.id === id);
        if (!u) return null;
        return {
          id: u.id,
          role: u.role,
          accountStatus: u.account_status,
        };
      },
    },
    createLead: opts.createLead,
  });

  const app = express();
  app.use(express.json());
  app.use(
    createAuthorizationMiddleware({
      resolveLocalDb: () => mockDb(users),
    })
  );
  const routerDeps: Parameters<typeof createWhatsAppInboxRouter>[0] = {
    services,
  };
  if ("sendPort" in opts) routerDeps.sendPort = opts.sendPort;
  if (opts.resolveSendPort) routerDeps.resolveSendPort = opts.resolveSendPort;
  if (opts.sendEnabled != null) routerDeps.sendEnabled = opts.sendEnabled;
  // Tests omit sendPort → explicitly disable (no production Graph config).
  if (!("sendPort" in opts) && !opts.resolveSendPort) {
    routerDeps.sendPort = null;
  }
  app.use("/api/inbox", createWhatsAppInboxRouter(routerDeps));

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const tokens: Record<string, string> = {};
  for (const u of users as any[]) {
    tokens[u.username] = signAccessToken({
      userId: u.id,
      username: u.username,
      role: u.role,
    });
  }

  try {
    await fn(baseUrl, tokens, repos);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function api(
  baseUrl: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; query?: Record<string, string> } = {}
): Promise<HttpResult> {
  const qs = opts.query
    ? `?${new URLSearchParams(opts.query).toString()}`
    : "";
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}/api/inbox${path}${qs}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// DTO / error mapper unit checks
// ---------------------------------------------------------------------------

await test("dto: list query rejects invalid status", () => {
  const parsed = parseListConversationsQuery({ status: "closed" });
  assert.equal(parsed.ok, false);
});

await test("dto: send body requires idempotencyKey", () => {
  const parsed = parseSendMessageBody({
    conversationId: "c1",
    text: "hello",
  });
  assert.equal(parsed.ok, false);
});

await test("dto: rejects unknown fields (strict)", () => {
  const send = parseSendMessageBody({
    conversationId: "c1",
    text: "hello",
    idempotencyKey: "k1",
    extra: true,
  });
  assert.equal(send.ok, false);
  if (!send.ok) assert.match(send.message, /Unknown field/);

  const list = parseListConversationsQuery({ status: "open", foo: "bar" });
  assert.equal(list.ok, false);

  const read = parseReadWatermarkBody({
    conversationId: "c1",
    lastSeenMessageId: "m1",
    lastSeenMessageCreatedAt: "2026-07-19T10:00:00.000Z",
    unexpected: 1,
  });
  assert.equal(read.ok, false);
});

await test("dto: rejects malformed timestamps", () => {
  const cursor = decodeInboxCursor(
    encodeInboxCursor({ at: "not-a-date", id: "c1" })
  );
  assert.equal(cursor.ok, false);
  if (!cursor.ok) assert.equal(cursor.field, "cursor.at");

  const delta = parseDeltaQuery({ sinceAt: "yesterday", sinceId: "c1" });
  assert.equal(delta.ok, false);
  if (!delta.ok) assert.equal(delta.field, "sinceAt");

  const read = parseReadWatermarkBody({
    conversationId: "c1",
    lastSeenMessageId: "m1",
    lastSeenMessageCreatedAt: "2026-13-40T99:99:99.000Z",
  });
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.field, "lastSeenMessageCreatedAt");
});

await test("dto: assign + status happy paths", () => {
  assert.equal(
    parseAssignBody({
      conversationId: "c1",
      assigneeUserId: "u1",
      expectedLockVersion: 1,
    }).ok,
    true
  );
  assert.equal(
    parseStatusBody({
      conversationId: "c1",
      status: "pending",
      expectedLockVersion: 2,
    }).ok,
    true
  );
});

await test("error mapper: InboxServiceError codes", () => {
  assert.equal(
    mapInboxError(new InboxServiceError("forbidden", "no")).status,
    403
  );
  assert.equal(
    mapInboxError(new InboxServiceError("not_found", "no")).status,
    404
  );
  assert.equal(
    mapInboxError(new InboxServiceError("already_linked", "no")).status,
    409
  );
});

// ---------------------------------------------------------------------------
// Auth / RBAC
// ---------------------------------------------------------------------------

await test("rbac: missing JWT → 401", async () => {
  await withInboxServer({}, async (baseUrl) => {
    const res = await api(baseUrl, "GET", "/conversations");
    assert.equal(res.status, 401);
  });
});

await test("rbac: technician without crm_leads → 403", async () => {
  await withInboxServer({}, async (baseUrl, tokens) => {
    const res = await api(baseUrl, "GET", "/conversations", {
      token: tokens.tech,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, "forbidden");
  });
});

await test("rbac: pending account → 403 from auth or rbac", async () => {
  await withInboxServer({}, async (baseUrl, tokens) => {
    const res = await api(baseUrl, "GET", "/conversations", {
      token: tokens.pending,
    });
    assert.ok(res.status === 403 || res.status === 401);
  });
});

// ---------------------------------------------------------------------------
// Integration — conversations / delta / detail
// ---------------------------------------------------------------------------

await test("integration: list + detail + delta envelope", async () => {
  await withInboxServer({}, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, {
      id: "c1",
      updatedAt: "2026-07-19T10:00:00.000Z",
      lastMessageAt: "2026-07-19T10:00:00.000Z",
    });
    seedConversation(repos.store, {
      id: "c2",
      updatedAt: "2026-07-19T11:00:00.000Z",
      lastMessageAt: "2026-07-19T11:00:00.000Z",
    });
    seedMessage(repos.store, {
      id: "m1",
      conversationId: "c1",
      direction: "inbound",
      createdAt: "2026-07-19T10:00:00.000Z",
      occurredAt: "2026-07-19T10:00:00.000Z",
    });

    const list = await api(baseUrl, "GET", "/conversations", {
      token: tokens.staff,
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.success, true);
    assert.deepEqual(
      list.body.data.conversations.map((c: any) => c.id),
      ["c2", "c1"]
    );

    const detail = await api(baseUrl, "GET", "/conversations/c1", {
      token: tokens.staff,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.conversation.id, "c1");
    assert.equal(detail.body.data.freeForm.freeFormAllowed, true);

    const since = encodeInboxCursor({
      at: "1970-01-01T00:00:00.000Z",
      id: "",
    });
    const delta = await api(baseUrl, "GET", "/delta", {
      token: tokens.staff,
      query: { since },
    });
    assert.equal(delta.status, 200);
    assert.ok(delta.body.data.conversations.length >= 2);
  });
});

await test("validation: delta missing since → 400", async () => {
  await withInboxServer({}, async (baseUrl, tokens) => {
    const res = await api(baseUrl, "GET", "/delta", {
      token: tokens.staff,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "validation_error");
  });
});

// ---------------------------------------------------------------------------
// Assignment / status / CRM / read
// ---------------------------------------------------------------------------

await test("integration: assign / unassign / status", async () => {
  await withInboxServer({}, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c1", status: "open", lockVersion: 1 });

    const assigned = await api(baseUrl, "POST", "/assign", {
      token: tokens.staff,
      body: {
        conversationId: "c1",
        assigneeUserId: "u-staff",
        expectedLockVersion: 1,
      },
    });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.data.conversation.assignedUserId, "u-staff");
    assert.equal(assigned.body.data.conversation.lockVersion, 2);

    const pending = await api(baseUrl, "POST", "/status", {
      token: tokens.staff,
      body: {
        conversationId: "c1",
        status: "pending",
        expectedLockVersion: 2,
      },
    });
    assert.equal(pending.status, 200);
    assert.equal(pending.body.data.conversation.status, "pending");

    const unassigned = await api(baseUrl, "POST", "/unassign", {
      token: tokens.staff,
      body: { conversationId: "c1", expectedLockVersion: 3 },
    });
    assert.equal(unassigned.status, 200);
    assert.equal(unassigned.body.data.conversation.assignedUserId, null);
  });
});

await test("rbac: non-admin cannot archive", async () => {
  await withInboxServer({}, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c1", status: "open", lockVersion: 1 });
    const res = await api(baseUrl, "POST", "/status", {
      token: tokens.staff,
      body: {
        conversationId: "c1",
        status: "archived",
        expectedLockVersion: 1,
      },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "forbidden");
  });
});

await test("integration: crm link + create-lead + unlink", async () => {
  await withInboxServer(
    {
      createLead: async () => ({ leadId: "lead_new_1" }),
    },
    async (baseUrl, tokens, repos) => {
      seedConversation(repos.store, { id: "c1" });

      const linked = await api(baseUrl, "POST", "/crm/link", {
        token: tokens.staff,
        body: {
          conversationId: "c1",
          linkedEntityType: "lead",
          linkedEntityId: "lead_1",
        },
      });
      assert.equal(linked.status, 200);
      assert.equal(linked.body.data.link.linkedEntityId, "lead_1");

      const dup = await api(baseUrl, "POST", "/crm/create-lead", {
        token: tokens.staff,
        body: { conversationId: "c1" },
      });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.error.code, "already_linked");

      const unlinked = await api(baseUrl, "DELETE", "/crm/link", {
        token: tokens.staff,
        body: { conversationId: "c1" },
      });
      assert.equal(unlinked.status, 200);
      assert.equal(unlinked.body.data.deleted, true);

      const created = await api(baseUrl, "POST", "/crm/create-lead", {
        token: tokens.staff,
        body: { conversationId: "c1" },
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.kind, "created");
    }
  );
});

await test("integration: messages/read + watermark alias", async () => {
  await withInboxServer({}, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c1" });
    seedMessage(repos.store, {
      id: "m_in",
      conversationId: "c1",
      direction: "inbound",
      createdAt: "2026-07-19T10:00:00.000Z",
    });
    seedMessage(repos.store, {
      id: "m_out",
      conversationId: "c1",
      direction: "outbound",
      createdAt: "2026-07-19T10:01:00.000Z",
    });

    const read = await api(baseUrl, "POST", "/messages/read", {
      token: tokens.staff,
      body: {
        conversationId: "c1",
        lastSeenMessageId: "m_out",
        lastSeenMessageCreatedAt: "2026-07-19T10:01:00.000Z",
      },
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.data.advanced, true);
    assert.equal(
      read.body.data.watermark.lastReadInboundMessageId,
      "m_in"
    );

    const watermark = await api(baseUrl, "POST", "/watermark", {
      token: tokens.staff,
      body: {
        conversationId: "c1",
        lastSeenMessageId: "m_out",
        lastSeenMessageCreatedAt: "2026-07-19T10:01:00.000Z",
      },
    });
    assert.equal(watermark.status, 200);
    assert.equal(watermark.body.data.advanced, false);
  });
});

await test("integration: messages/send with sendPort + idempotent replay", async () => {
  let sends = 0;
  await withInboxServer(
    {
      sendPort: async () => {
        sends += 1;
        return { ok: true, messageId: "m_out_1" };
      },
    },
    async (baseUrl, tokens, repos) => {
      seedConversation(repos.store, { id: "c1", status: "pending" });
      seedMessage(repos.store, {
        id: "m_in",
        conversationId: "c1",
        direction: "inbound",
        createdAt: "2026-07-19T11:00:00.000Z",
        occurredAt: "2026-07-19T11:00:00.000Z",
      });

      const first = await api(baseUrl, "POST", "/messages/send", {
        token: tokens.staff,
        body: {
          conversationId: "c1",
          text: "Hello",
          idempotencyKey: "key-1",
        },
      });
      assert.equal(first.status, 201);
      assert.equal(first.body.data.messageId, "m_out_1");
      assert.equal(sends, 1);
      assert.equal(
        (await repos.conversations.getById("c1"))!.status,
        "open"
      );

      const replay = await api(baseUrl, "POST", "/messages/send", {
        token: tokens.staff,
        body: {
          conversationId: "c1",
          text: "Hello again",
          idempotencyKey: "key-1",
        },
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.data.replay, true);
      assert.equal(sends, 1);
    }
  );
});

await test("validation: send missing text → 400", async () => {
  await withInboxServer({}, async (baseUrl, tokens) => {
    const res = await api(baseUrl, "POST", "/messages/send", {
      token: tokens.staff,
      body: { conversationId: "c1", idempotencyKey: "k" },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "validation_error");
  });
});

await test("regression: transport throw finalizes idempotency to failed_known", async () => {
  await withInboxServer(
    {
      sendPort: async () => {
        throw new Error("graph_transport_boom");
      },
    },
    async (baseUrl, tokens, repos) => {
      seedConversation(repos.store, { id: "c1" });
      seedMessage(repos.store, {
        id: "m_in",
        conversationId: "c1",
        direction: "inbound",
        createdAt: "2026-07-19T11:00:00.000Z",
        occurredAt: "2026-07-19T11:00:00.000Z",
      });

      const res = await api(baseUrl, "POST", "/messages/send", {
        token: tokens.staff,
        body: {
          conversationId: "c1",
          text: "Hello",
          idempotencyKey: "key-throw",
        },
      });
      assert.ok(res.status >= 400);
      const row = repos.store.idempotencyKeys.get("key-throw");
      assert.ok(row, "idempotency row must exist");
      assert.equal(row!.state, "failed_known");
      assert.match(String(row!.error), /graph_transport_boom/);
    }
  );
});

await test("regression: send disabled does not claim idempotency", async () => {
  await withInboxServer({ sendPort: null }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c1" });
    seedMessage(repos.store, {
      id: "m_in",
      conversationId: "c1",
      direction: "inbound",
      createdAt: "2026-07-19T11:00:00.000Z",
      occurredAt: "2026-07-19T11:00:00.000Z",
    });

    const res = await api(baseUrl, "POST", "/messages/send", {
      token: tokens.staff,
      body: {
        conversationId: "c1",
        text: "Hello",
        idempotencyKey: "key-disabled",
      },
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "send_unavailable");
    assert.equal(repos.store.idempotencyKeys.has("key-disabled"), false);
  });
});

await test("regression: production transport config (inject vs disabled)", async () => {
  assert.equal(
    isInboxSendTransportReady({
      env: {
        WHATSAPP_CONVERSATIONS_ENABLED: "false",
      } as NodeJS.ProcessEnv,
    }),
    false
  );
  assert.equal(
    createInboxOutboundSendPort({
      env: {
        WHATSAPP_CONVERSATIONS_ENABLED: "false",
      } as NodeJS.ProcessEnv,
    }),
    null
  );

  let injectedCalls = 0;
  await withInboxServer(
    {
      resolveSendPort: () => async () => {
        injectedCalls += 1;
        return { ok: true, messageId: "m_injected" };
      },
    },
    async (baseUrl, tokens, repos) => {
      seedConversation(repos.store, { id: "c1" });
      seedMessage(repos.store, {
        id: "m_in",
        conversationId: "c1",
        direction: "inbound",
        createdAt: "2026-07-19T11:00:00.000Z",
        occurredAt: "2026-07-19T11:00:00.000Z",
      });

      const res = await api(baseUrl, "POST", "/messages/send", {
        token: tokens.staff,
        body: {
          conversationId: "c1",
          text: "Hello",
          idempotencyKey: "key-inject",
        },
      });
      assert.equal(res.status, 201);
      assert.equal(injectedCalls, 1);
      assert.equal(
        repos.store.idempotencyKeys.get("key-inject")!.state,
        "completed"
      );
    }
  );

  await withInboxServer(
    { resolveSendPort: () => null },
    async (baseUrl, tokens, repos) => {
      seedConversation(repos.store, { id: "c1" });
      const res = await api(baseUrl, "POST", "/messages/send", {
        token: tokens.staff,
        body: {
          conversationId: "c1",
          text: "Hello",
          idempotencyKey: "key-unconfigured",
        },
      });
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "send_unavailable");
      assert.equal(repos.store.idempotencyKeys.has("key-unconfigured"), false);
    }
  );
});

await test("regression: malformed timestamps rejected before service", async () => {
  await withInboxServer({}, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c1" });
    seedMessage(repos.store, {
      id: "m1",
      conversationId: "c1",
      direction: "inbound",
      createdAt: "2026-07-19T10:00:00.000Z",
    });

    const badCursor = encodeInboxCursor({ at: "nope", id: "c1" });
    const list = await api(baseUrl, "GET", "/conversations", {
      token: tokens.staff,
      query: { cursor: badCursor },
    });
    assert.equal(list.status, 400);
    assert.equal(list.body.error.code, "validation_error");

    const delta = await api(baseUrl, "GET", "/delta", {
      token: tokens.staff,
      query: { sinceAt: "not-iso", sinceId: "c1" },
    });
    assert.equal(delta.status, 400);

    const read = await api(baseUrl, "POST", "/messages/read", {
      token: tokens.staff,
      body: {
        conversationId: "c1",
        lastSeenMessageId: "m1",
        lastSeenMessageCreatedAt: "bad-ts",
      },
    });
    assert.equal(read.status, 400);
    assert.equal(read.body.error.details?.field, "lastSeenMessageCreatedAt");
  });
});

await test("regression: unknown DTO fields → 400", async () => {
  await withInboxServer({}, async (baseUrl, tokens) => {
    const res = await api(baseUrl, "POST", "/assign", {
      token: tokens.staff,
      body: {
        conversationId: "c1",
        assigneeUserId: "u-staff",
        expectedLockVersion: 1,
        sneaky: true,
      },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "validation_error");
    assert.match(String(res.body.error.message), /Unknown field/);
  });
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll inbox API route tests passed.");
