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
import type { InboxMessageRef } from "../whatsappInboxRepoSupport.ts";
import {
  createInMemoryWhatsAppInboxRepositories,
} from "../whatsappInboxRepository.ts";
import { createWhatsAppInboxRouter } from "../whatsappInboxRoutes.ts";
import { createWhatsAppInboxServices } from "../whatsappInboxServices.ts";
import { resetConnectionStoreForTests } from "../whatsappConnectionService.ts";
import {
  createMockAiDraftAdapter,
  type AiDraftConfig,
  type AiDraftGenerateRequest,
  type AiDraftOutcome,
  type InboxAiDraftAdapter,
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

type CapturingAdapter = InboxAiDraftAdapter & {
  calls: AiDraftGenerateRequest[];
};

function createCapturingAdapter(
  base: InboxAiDraftAdapter,
  opts?: {
    ignoreAbort?: boolean;
    delayMs?: number;
    failWith?: Error;
  }
): CapturingAdapter {
  const calls: AiDraftGenerateRequest[] = [];
  return {
    adapterId: "capturing-ai-draft",
    calls,
    async generateDraft(request) {
      calls.push(request);
      if (opts?.failWith) throw opts.failWith;
      if (opts?.delayMs && opts.delayMs > 0) {
        await new Promise<void>((resolve) => {
          // Intentionally ignores abortSignal when ignoreAbort is true.
          const timer = setTimeout(() => resolve(), opts.delayMs);
          if (!opts.ignoreAbort && request.abortSignal) {
            const onAbort = () => {
              clearTimeout(timer);
              resolve();
            };
            if (request.abortSignal.aborted) onAbort();
            else request.abortSignal.addEventListener("abort", onAbort, { once: true });
          }
        });
        if (request.abortSignal?.aborted && !opts.ignoreAbort) {
          return {
            status: "denied",
            companyId: request.companyId,
            conversationId: request.conversationId,
            reasonCode: "timeout",
            message: "AI draft generation timed out",
            requiresHumanReview: true,
            autoSendBlocked: true,
            escalate: true,
            escalationReasons: ["timeout"],
            audit: {
              draftId: "draft_timeout",
              companyId: request.companyId,
              conversationId: request.conversationId,
              actorUserId: request.actorUserId,
              messageIdHash: null,
              intent: "unknown",
              confidenceBucket: "n/a",
              escalate: true,
              escalationReasons: ["timeout"],
              injectionSuspected: false,
              providerId: "capturing",
              providerConfigured: true,
              draftEnabled: true,
              autoReplyEnabled: false,
              latencyMs: opts.delayMs,
              retries: 0,
              outcome: "denied",
              reasonCode: "timeout",
              createdAt: new Date().toISOString(),
            },
          } satisfies AiDraftOutcome;
        }
      }
      return base.generateDraft(request);
    },
  };
}

async function withDraftServer(
  opts: {
    users?: unknown[];
    aiDraftConfig?: AiDraftConfig;
    failAdapter?: boolean;
    failWithSecret?: string;
    ignoreAbortDelayMs?: number;
    sendCalls?: { count: number };
    capture?: { adapter?: CapturingAdapter };
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

  const mock = createMockAiDraftAdapter({
    config: aiDraftConfig,
    failWith: opts.failAdapter
      ? new Error("simulated provider failure")
      : opts.failWithSecret
        ? new Error(opts.failWithSecret)
        : undefined,
  });

  const adapter = createCapturingAdapter(mock, {
    ignoreAbort: opts.ignoreAbortDelayMs != null,
    delayMs: opts.ignoreAbortDelayMs,
    failWith: opts.failWithSecret
      ? new Error(opts.failWithSecret)
      : opts.failAdapter
        ? new Error("simulated provider failure")
        : undefined,
  });
  if (opts.capture) opts.capture.adapter = adapter;

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
      seedMessage(repos.store, {
        id: "m_disabled",
        conversationId: "c_disabled",
        direction: "inbound",
        textBody: "Do you install net metering?",
      });
      const res = await api(
        baseUrl,
        "POST",
        "/api/inbox/conversations/c_disabled/ai-draft",
        {
          token: tokens.staff,
          body: { messageId: "m_disabled" },
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
    seedMessage(repos.store, {
      id: "m_auth",
      conversationId: "c_auth",
      direction: "inbound",
      textBody: "hello",
    });
    const noToken = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_auth/ai-draft",
      { body: { messageId: "m_auth" } }
    );
    assert.equal(noToken.status, 401);

    const tech = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_auth/ai-draft",
      {
        token: tokens.tech,
        body: { messageId: "m_auth" },
      }
    );
    assert.equal(tech.status, 403);

    const pending = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_auth/ai-draft",
      {
        token: tokens.pending,
        body: { messageId: "m_auth" },
      }
    );
    assert.equal(pending.status, 403);
  });
});

await test("generation never sends a message", async () => {
  const sendCalls = { count: 0 };
  await withDraftServer({ sendCalls }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_nosend" });
    seedMessage(repos.store, {
      id: "m_nosend",
      conversationId: "c_nosend",
      direction: "inbound",
      textBody: "What is the warranty?",
    });
    const beforeMessages = repos.store.messages.size;
    const res = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_nosend/ai-draft",
      {
        token: tokens.staff,
        body: { messageId: "m_nosend" },
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, "draft");
    assert.equal(res.body.data.autoSendBlocked, true);
    assert.equal(res.body.data.requiresHumanReview, true);
    assert.equal(sendCalls.count, 0);
    assert.equal(repos.store.messages.size, beforeMessages);
    // No internal audit IDs/metadata exposed to the client.
    assert.equal(res.body.data.audit, undefined);
    assert.equal(res.body.data.draftId, undefined);
  });
});

await test("generated text is returned for editing (not locked)", async () => {
  await withDraftServer({}, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_edit" });
    seedMessage(repos.store, {
      id: "m_edit",
      conversationId: "c_edit",
      direction: "inbound",
      textBody: "Need a quote for 10kW",
    });
    const res = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_edit/ai-draft",
      {
        token: tokens.staff,
        body: { messageId: "m_edit" },
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
      seedMessage(repos.store, {
        id: "m_fail",
        conversationId: "c_fail",
        direction: "inbound",
        textBody: "help",
      });
      const res = await api(
        baseUrl,
        "POST",
        "/api/inbox/conversations/c_fail/ai-draft",
        {
          token: tokens.staff,
          body: { messageId: "m_fail" },
        }
      );
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "provider_unavailable");
      assert.equal(res.body.error.details.autoSendBlocked, true);
      assert.equal(sendCalls.count, 0);
    }
  );
});

await test("raw provider error containing a secret is not returned to client", async () => {
  const secret = "sk-live-SUPER_SECRET_PROVIDER_KEY_99";
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ")
    );
  };
  try {
    await withDraftServer(
      { failWithSecret: `Provider rejected key ${secret}` },
      async (baseUrl, tokens, repos) => {
        seedConversation(repos.store, { id: "c_secret" });
        seedMessage(repos.store, {
          id: "m_secret",
          conversationId: "c_secret",
          direction: "inbound",
          textBody: "hello",
        });
        const res = await api(
          baseUrl,
          "POST",
          "/api/inbox/conversations/c_secret/ai-draft",
          {
            token: tokens.staff,
            body: { messageId: "m_secret" },
          }
        );
        assert.equal(res.status, 503);
        assert.equal(res.body.error.code, "provider_unavailable");
        assert.equal(res.body.error.message, "AI draft generation failed");
        assert.equal(JSON.stringify(res.body).includes(secret), false);
        assert.ok(logs.some((line) => line.includes('"outcomeCode"')));
        assert.equal(logs.some((line) => line.includes(secret)), false);
      }
    );
  } finally {
    console.error = originalError;
  }
});

await test("message from another conversation is rejected", async () => {
  const capture: { adapter?: CapturingAdapter } = {};
  const sendCalls = { count: 0 };
  await withDraftServer({ capture, sendCalls }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_a" });
    seedConversation(repos.store, { id: "c_b" });
    seedMessage(repos.store, {
      id: "m_b_only",
      conversationId: "c_b",
      direction: "inbound",
      textBody: "secret from conversation B",
    });
    const res = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_a/ai-draft",
      {
        token: tokens.staff,
        body: { messageId: "m_b_only" },
      }
    );
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "not_found");
    assert.equal(capture.adapter?.calls.length ?? 0, 0);
    assert.equal(sendCalls.count, 0);
  });
});

await test("fabricated messageId is rejected", async () => {
  const capture: { adapter?: CapturingAdapter } = {};
  await withDraftServer({ capture }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_fake" });
    const res = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_fake/ai-draft",
      {
        token: tokens.staff,
        body: { messageId: "msg_does_not_exist_zzz" },
      }
    );
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "not_found");
    assert.equal(capture.adapter?.calls.length ?? 0, 0);
  });
});

await test("browser text differing from stored message is ignored", async () => {
  const capture: { adapter?: CapturingAdapter } = {};
  await withDraftServer({ capture }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_mismatch" });
    seedMessage(repos.store, {
      id: "m_stored",
      conversationId: "c_mismatch",
      direction: "inbound",
      textBody: "STORED_AUTHORITATIVE_QUESTION",
    });
    const res = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_mismatch/ai-draft",
      {
        token: tokens.staff,
        body: {
          messageId: "m_stored",
          messageText: "FABRICATED_BROWSER_TEXT_SHOULD_BE_IGNORED",
        },
      }
    );
    assert.equal(res.status, 200);
    assert.equal(capture.adapter?.calls.length, 1);
    assert.equal(
      capture.adapter?.calls[0]?.messageText,
      "STORED_AUTHORITATIVE_QUESTION"
    );
    assert.equal(capture.adapter?.calls[0]?.messageId, "m_stored");
    assert.equal(
      JSON.stringify(res.body).includes("FABRICATED_BROWSER_TEXT"),
      false
    );
  });
});

await test("without messageId server resolves latest eligible inbound", async () => {
  const capture: { adapter?: CapturingAdapter } = {};
  await withDraftServer({ capture }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_latest" });
    seedMessage(repos.store, {
      id: "m_old",
      conversationId: "c_latest",
      direction: "inbound",
      textBody: "older question",
      createdAt: "2026-07-19T09:00:00.000Z",
    });
    seedMessage(repos.store, {
      id: "m_new",
      conversationId: "c_latest",
      direction: "inbound",
      textBody: "newest inbound question",
      createdAt: "2026-07-19T11:00:00.000Z",
    });
    seedMessage(repos.store, {
      id: "m_out",
      conversationId: "c_latest",
      direction: "outbound",
      textBody: "agent reply",
      createdAt: "2026-07-19T11:30:00.000Z",
    });
    const res = await api(
      baseUrl,
      "POST",
      "/api/inbox/conversations/c_latest/ai-draft",
      {
        token: tokens.staff,
        body: {},
      }
    );
    assert.equal(res.status, 200);
    assert.equal(capture.adapter?.calls[0]?.messageId, "m_new");
    assert.equal(
      capture.adapter?.calls[0]?.messageText,
      "newest inbound question"
    );
  });
});

await test("adapter ignoring AbortSignal still times out via Promise.race", async () => {
  const sendCalls = { count: 0 };
  const started = Date.now();
  await withDraftServer(
    {
      sendCalls,
      ignoreAbortDelayMs: 5_000,
      aiDraftConfig: {
        draftEnabled: true,
        autoReplyEnabled: false,
        adapter: "mock",
        timeoutMs: 80,
      },
    },
    async (baseUrl, tokens, repos) => {
      seedConversation(repos.store, { id: "c_timeout" });
      seedMessage(repos.store, {
        id: "m_timeout",
        conversationId: "c_timeout",
        direction: "inbound",
        textBody: "slow please",
      });
      const res = await api(
        baseUrl,
        "POST",
        "/api/inbox/conversations/c_timeout/ai-draft",
        {
          token: tokens.staff,
          body: { messageId: "m_timeout" },
        }
      );
      const elapsed = Date.now() - started;
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "timeout");
      assert.equal(res.body.error.message, "AI draft generation timed out");
      assert.ok(elapsed < 2_000, `expected hard timeout, elapsed=${elapsed}`);
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

await test("generation still never calls sendPort across hardened paths", async () => {
  const sendCalls = { count: 0 };
  await withDraftServer({ sendCalls }, async (baseUrl, tokens, repos) => {
    seedConversation(repos.store, { id: "c_guard" });
    seedMessage(repos.store, {
      id: "m_guard",
      conversationId: "c_guard",
      direction: "inbound",
      textBody: "guard path",
    });
    await api(baseUrl, "POST", "/api/inbox/conversations/c_guard/ai-draft", {
      token: tokens.staff,
      body: { messageId: "m_guard" },
    });
    await api(baseUrl, "POST", "/api/inbox/conversations/c_guard/ai-draft", {
      token: tokens.staff,
      body: { messageId: "msg_missing" },
    });
    assert.equal(sendCalls.count, 0);
  });
});

if (failed > 0) {
  console.error(`\n${failed} ai-draft route test(s) failed`);
  process.exit(1);
}
console.log("\nAll ai-draft route tests passed");
