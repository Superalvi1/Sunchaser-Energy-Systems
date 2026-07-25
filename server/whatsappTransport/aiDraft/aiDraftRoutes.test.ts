/**
 * AI-03 inbox AI draft route tests.
 * Run: npm run test:whatsapp-ai-draft
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { signAccessToken } from "../../auth/jwt.ts";
import { createAuthorizationMiddleware } from "../../middleware/authorization.ts";
import type { WhatsAppConversationInbox } from "../whatsappInboxDatabaseTypes.ts";
import {
  createInMemoryWhatsAppInboxRepositories,
} from "../whatsappInboxRepository.ts";
import { createWhatsAppInboxRouter } from "../whatsappInboxRoutes.ts";
import { createWhatsAppInboxServices } from "../whatsappInboxServices.ts";
import { resetConnectionStoreForTests } from "../whatsappConnectionService.ts";
import {
  createMockAiDraftAdapter,
  type AiDraftConfig,
} from "./index.ts";

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
  process.env.JWT_SECRET || "whatsapp-ai-draft-route-test-secret-min-32!!";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const staffUser = {
  id: "u-staff",
  username: "staff",
  name: "Staff User",
  email: "staff@test.com",
  role: "Sales Executive",
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

type HttpResult = { status: number; body: any };

async function withDraftServer(
  opts: {
    users?: unknown[];
    aiDraftConfig?: AiDraftConfig;
    failAdapter?: boolean;
    sendCalls?: { count: number };
  },
  fn: (
    baseUrl: string,
    tokens: Record<string, string>,
    repos: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>
  ) => Promise<void>
): Promise<void> {
  const users = opts.users ?? [staffUser, technicianUser, pendingStaff];
  const repos = createInMemoryWhatsAppInboxRepositories();
  await resetConnectionStoreForTests({
    accessToken: "EAAG_test_token",
    phoneNumberId: "123456789012345",
    wabaId: "waba_test_1",
    phoneNumber: "+15551234567",
    lastWebhookAt: "2026-07-19T10:00:00.000Z",
  });

  const services = createWhatsAppInboxServices(repos, {
    now: () => Date.parse("2026-07-19T12:00:00.000Z"),
    assignees: {
      async getById(id, _companyId) {
        const u = (users as any[]).find((x) => x.id === id);
        if (!u) return null;
        return {
          id: u.id,
          role: u.role,
          accountStatus: u.account_status,
          companyId: "sunchaser",
        };
      },
    },
  });

  const sendCalls = opts.sendCalls ?? { count: 0 };
  const aiDraftConfig: AiDraftConfig = opts.aiDraftConfig ?? {
    draftEnabled: true,
    autoReplyEnabled: false,
    adapter: "mock",
    timeoutMs: 2_000,
  };

  const adapter = createMockAiDraftAdapter({
    config: aiDraftConfig,
    failWith: opts.failAdapter
      ? new Error("simulated provider failure")
      : undefined,
  });

  const app = express();
  app.use(express.json());
  app.use(
    createAuthorizationMiddleware({
      resolveLocalDb: () => mockDb(users),
    })
  );
  app.use(
    "/api/inbox",
    createWhatsAppInboxRouter({
      services,
      sendPort: async () => {
        sendCalls.count += 1;
        return { ok: true, messageId: "msg_should_not_be_created" };
      },
      sendEnabled: true,
      aiDraftAdapter: adapter,
      aiDraftConfig,
    })
  );

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
    await resetConnectionStoreForTests();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function api(
  baseUrl: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json();
  return { status: res.status, body };
}

await test("feature disabled by default rejects draft generation", async () => {
  const sendCalls = { count: 0 };
  await withDraftServer(
    {
      sendCalls,
      aiDraftConfig: {
        draftEnabled: false,
        autoReplyEnabled: false,
        adapter: "mock",
        timeoutMs: 1000,
      },
    },
    async (baseUrl, tokens, repos) => {
      seedConversation(repos.store, { id: "c_disabled" });
      const res = await api(
        baseUrl,
        "POST",
        "/api/inbox/conversations/c_disabled/ai-draft",
        {
          token: tokens.staff,
          body: { messageText: "Do you install net metering?" },
        }
      );
      assert.equal(res.status, 503);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, "feature_disabled");
      assert.equal(sendCalls.count, 0);
    }
  );
});

await test("unauthorized user rejected", async () => {
  await withDraftServer({}, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_auth" });
    const noToken = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_auth/ai-draft",
      { body: { messageText: "hello" } }
    );
    assert.equal(noToken.status, 401);

    const tech = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_auth/ai-draft",
      {
        token: tokens.tech,
        body: { messageText: "hello" },
      }
    );
    assert.equal(tech.status, 403);

    const pending = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_auth/ai-draft",
      {
        token: tokens.pending,
        body: { messageText: "hello" },
      }
    );
    assert.equal(pending.status, 403);
  });
});

await test("generation never sends a message", async () => {
  const sendCalls = { count: 0 };
  await withDraftServer({ sendCalls }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_nosend" });
    const beforeMessages = repos.store.messages.size;
    const res = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_nosend/ai-draft",
      {
        token: tokens.staff,
        body: { messageText: "What is the warranty?" },
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, "draft");
    assert.equal(res.body.data.autoSendBlocked, true);
    assert.equal(res.body.data.requiresHumanReview, true);
    assert.equal(sendCalls.count, 0);
    assert.equal(repos.store.messages.size, beforeMessages);
  });
});

await test("generated text is returned for editing (not locked)", async () => {
  await withDraftServer({}, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_edit" });
    const res = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_edit/ai-draft",
      {
        token: tokens.staff,
        body: { messageText: "Need a quote for 10kW" },
      }
    );
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.answer, "string");
    assert.ok(res.body.data.answer.length > 0);
    // Client may edit freely — server does not mark immutable.
    assert.equal(res.body.data.requiresHumanReview, true);
  });
});

await test("provider failure is safe (503, no send)", async () => {
  const sendCalls = { count: 0 };
  await withDraftServer(
    { sendCalls, failAdapter: true },
    async (baseUrl, tokens, repos) => {
      seedConversation(repos.store, { id: "c_fail" });
      const res = await api(
        baseUrl,
        "POST",
        "/api/inbox/conversations/c_fail/ai-draft",
        {
          token: tokens.staff,
          body: { messageText: "help" },
        }
      );
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "provider_unavailable");
      assert.equal(res.body.error.details.autoSendBlocked, true);
      assert.equal(sendCalls.count, 0);
    }
  );
});

await test("opening conversation does not auto-generate (no side route)", async () => {
  const sendCalls = { count: 0 };
  await withDraftServer({ sendCalls }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_open" });
    const detail = await api(
      baseUrl,
      "GET",
      "/api/inbox/conversations/c_open",
      { token: tokens.staff }
    );
    assert.equal(detail.status, 200);
    assert.equal(sendCalls.count, 0);
    // GET detail must not include a generated draft payload.
    assert.equal(detail.body.data.aiDraft, undefined);
  });
});

if (failed > 0) {
  console.error(`\n${failed} ai-draft route test(s) failed`);
  process.exit(1);
}
console.log("\nAll ai-draft route tests passed");
