/**
 * WhatsApp outbound transport + security tests.
 * Run: npm run test:whatsapp-transport
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { isPublicApiRoute } from "../middleware/publicRoutes.ts";
import { createAuthorizationMiddleware } from "../middleware/authorization.ts";
import { signAccessToken } from "../auth/jwt.ts";
import {
  isValidGraphApiVersion,
  isValidPhoneNumberId,
  readWhatsAppConfig,
} from "./whatsappConfig.ts";
import { buildWhatsAppMessagesUrl } from "./whatsappGraphClient.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import { createWhatsAppOutboundRouter } from "./whatsappOutboundRoutes.ts";
import {
  sendOutboundPlainText,
  validateOutboundText,
} from "./whatsappOutboundService.ts";
import {
  authorizeOutboundWhatsAppActor,
  canSendOutboundWhatsApp,
} from "./whatsappPermissions.ts";
import { MESSAGE_STATUSES } from "./whatsappConstants.ts";
import type { RequestActor } from "../middleware/actor.ts";

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

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "whatsapp-outbound-test-secret-min-32-chars";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;

const PHONE_NUMBER_ID = "109876543210987";

function enabledConfig(overrides: Record<string, string> = {}) {
  return readWhatsAppConfig({
    WHATSAPP_CONVERSATIONS_ENABLED: "true",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
    WHATSAPP_APP_SECRET: "secret",
    WHATSAPP_ACCESS_TOKEN: "access-token",
    WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    WHATSAPP_GRAPH_API_VERSION: "v21.0",
    ...overrides,
  });
}

function actorStub(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    id: "u-staff",
    username: "staff",
    name: "Staff User",
    email: "staff@test.com",
    role: "Sales Executive",
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

async function seedConversation(
  repo: InMemoryWhatsAppRepository,
  opts: { phoneNumberId?: string } = {}
) {
  const channel = await repo.resolveOrCreateChannel({
    phoneNumberId: opts.phoneNumberId ?? PHONE_NUMBER_ID,
    displayPhoneNumber: "15551234567",
  });
  const contact = await repo.resolveOrCreateContact({
    phoneE164: "923001234567",
    profileName: "Ali",
  });
  const conversation = await repo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  return { channel, contact, conversation };
}

type HttpResult = { status: number; body: any };

function mockDb(users: any[]) {
  return { users } as any;
}

const staffUser = {
  id: "u-staff",
  username: "staff",
  name: "Staff User",
  email: "staff@test.com",
  role: "Sales Executive",
  account_status: "Approved",
};

const customerUser = {
  id: "u-customer",
  username: "customer",
  name: "Customer User",
  email: "customer@test.com",
  role: "Customer",
  account_status: "Approved",
  customerId: "cust-1",
};

const unknownRoleUser = {
  id: "u-unknown",
  username: "unknownrole",
  name: "Unknown",
  email: "unknown@test.com",
  role: "Warehouse Clerk",
  account_status: "Approved",
};

async function withOutboundServer(
  repo: InMemoryWhatsAppRepository,
  config: ReturnType<typeof enabledConfig>,
  fetchImpl: typeof fetch | undefined,
  users: any[],
  fn: (baseUrl: string, tokens: Record<string, string>) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    createAuthorizationMiddleware({
      resolveLocalDb: () => mockDb(users),
    })
  );
  app.use(
    "/api/conversations",
    createWhatsAppOutboundRouter({ repo, config, fetchImpl })
  );

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const tokens: Record<string, string> = {};
  for (const u of users) {
    tokens[u.username] = signAccessToken({
      userId: u.id,
      username: u.username,
      role: u.role,
    });
  }
  try {
    await fn(baseUrl, tokens);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function postMessage(
  baseUrl: string,
  conversationId: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

function mockGraphFetch(opts: {
  mode: "success" | "reject" | "timeout";
  providerMessageId?: string;
  calls: { count: number };
}): typeof fetch {
  return (async () => {
    opts.calls.count += 1;
    if (opts.mode === "timeout") {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (opts.mode === "reject") {
      return new Response(
        JSON.stringify({
          error: { message: "Invalid recipient", code: 131000 },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        messaging_product: "whatsapp",
        messages: [{ id: opts.providerMessageId ?? "wamid.OUTBOUND1" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
}

await test("21. Protected route rejects unauthenticated request", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls }),
    [staffUser],
    async (base) => {
      const res = await postMessage(base, conversation.id, { text: "hi" });
      assert.equal(res.status, 401);
      assert.equal(calls.count, 0);
      assert.equal(repo.messages.size, 0);
    }
  );
});

await test("22. Outbound route is absent from public allowlist", () => {
  assert.equal(
    isPublicApiRoute("POST", "/api/conversations/abc/messages"),
    false
  );
});

await test("1. Customer actor is denied", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls }),
    [customerUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${tokens.customer}` }
      );
      assert.equal(res.status, 403);
      assert.equal(calls.count, 0);
      assert.equal(repo.messages.size, 0);
    }
  );
});

await test("2. Unknown role is denied", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls }),
    [unknownRoleUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${tokens.unknownrole}` }
      );
      assert.equal(res.status, 403);
      assert.equal(calls.count, 0);
      assert.equal(repo.messages.size, 0);
    }
  );
});

await test("3. Approved staff role succeeds", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello staff" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 201);
      assert.equal(calls.count, 1);
    }
  );
});

await test("canSendOutboundWhatsApp requires exact Approved accountStatus", () => {
  assert.equal(canSendOutboundWhatsApp(actorStub({ role: "Sales Executive" })), true);
  assert.equal(canSendOutboundWhatsApp(actorStub({ role: "Admin" })), true);
  assert.equal(canSendOutboundWhatsApp(actorStub({ role: "Customer" })), false);
  assert.equal(canSendOutboundWhatsApp(actorStub({ role: "Warehouse Clerk" })), false);
  assert.equal(canSendOutboundWhatsApp(actorStub({ role: "Technician" })), false);
  assert.equal(
    canSendOutboundWhatsApp(
      actorStub({ role: "Sales Executive", accountStatus: undefined as unknown as string })
    ),
    false
  );
  assert.equal(
    canSendOutboundWhatsApp(actorStub({ role: "Sales Executive", accountStatus: "" })),
    false
  );
  assert.equal(
    canSendOutboundWhatsApp(actorStub({ role: "Sales Executive", accountStatus: "Suspended" })),
    false
  );
  assert.equal(
    canSendOutboundWhatsApp(actorStub({ role: "Sales Executive", accountStatus: "Rejected" })),
    false
  );
  assert.equal(
    canSendOutboundWhatsApp(actorStub({ role: "Sales Executive", accountStatus: "Inactive" })),
    false
  );
  assert.equal(
    canSendOutboundWhatsApp(actorStub({ role: "Sales Executive", accountStatus: "Pending" })),
    false
  );
  assert.equal(
    canSendOutboundWhatsApp(actorStub({ role: "Customer", accountStatus: "Approved" })),
    false
  );
  assert.equal(
    canSendOutboundWhatsApp(actorStub({ role: "Warehouse Clerk", accountStatus: "Approved" })),
    false
  );
  assert.equal(canSendOutboundWhatsApp(null), false);
});

await test("missing accountStatus denies before conversation lookup / Meta / message insert", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  let lookupCount = 0;
  const originalLookup = repo.getConversationBundle.bind(repo);
  repo.getConversationBundle = async (id) => {
    lookupCount += 1;
    return originalLookup(id);
  };
  const calls = { count: 0 };
  const result = await sendOutboundPlainText(conversation.id, "hello", {
    repo,
    config: enabledConfig(),
    actor: actorStub({ accountStatus: "" }),
    fetchImpl: mockGraphFetch({ mode: "success", calls }),
  });
  assert.equal(result.httpStatus, 403);
  assert.equal(lookupCount, 0);
  assert.equal(calls.count, 0);
  assert.equal(repo.messages.size, 0);
});

await test("authorizeOutboundWhatsAppActor returns 404 for missing conversation", async () => {
  const decision = authorizeOutboundWhatsAppActor(actorStub(), null);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 404);
});

await test("23. Empty text returns 400", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls: { count: 0 } }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "   " },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 400);
      assert.equal(repo.messages.size, 0);
    }
  );
});

await test("6-9. Non-string text payloads rejected without DB/Meta side effects", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  const payloads = [{ text: { a: 1 } }, { text: ["x"] }, { text: 12 }, { text: true }];
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls }),
    [staffUser],
    async (base, tokens) => {
      for (const body of payloads) {
        const res = await postMessage(base, conversation.id, body, {
          authorization: `Bearer ${tokens.staff}`,
        });
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      assert.equal(calls.count, 0);
      assert.equal(repo.messages.size, 0);
    }
  );
});

await test("validateOutboundText unit cases", () => {
  assert.equal(validateOutboundText({ a: 1 }).ok, false);
  assert.equal(validateOutboundText(["x"]).ok, false);
  assert.equal(validateOutboundText(1).ok, false);
  assert.equal(validateOutboundText(true).ok, false);
  assert.equal(validateOutboundText(null).ok, false);
  assert.equal(validateOutboundText(undefined).ok, false);
  assert.equal(validateOutboundText("").ok, false);
  assert.equal(validateOutboundText("   ").ok, false);
  const ok = validateOutboundText(" hello ");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.text, "hello");
});

await test("24. Unknown conversation returns 404", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls: { count: 0 } }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        "missing-conversation",
        { text: "hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 404);
    }
  );
});

await test("25. Sender/channel mismatch fails closed", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo, {
    phoneNumberId: "199999999999999",
  });
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 503);
      assert.equal(calls.count, 0);
    }
  );
});

await test("26. Missing access token/config returns 503", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig({ WHATSAPP_ACCESS_TOKEN: "" }),
    mockGraphFetch({ mode: "success", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 503);
      assert.equal(calls.count, 0);
    }
  );
});

await test("20. Invalid Graph version rejected (503, no Meta call)", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig({ WHATSAPP_GRAPH_API_VERSION: "v21.0/messages" }),
    mockGraphFetch({ mode: "success", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 503);
      assert.equal(calls.count, 0);
    }
  );
});

await test("21cfg. Invalid phone number ID rejected", async () => {
  assert.equal(isValidPhoneNumberId("pnid-1"), false);
  assert.equal(isValidPhoneNumberId("../123"), false);
  assert.equal(isValidPhoneNumberId("109876543210987"), true);
  assert.equal(buildWhatsAppMessagesUrl("v21.0", "pnid-1"), null);
  assert.equal(buildWhatsAppMessagesUrl("../v21.0", "109876543210987"), null);
  assert.equal(isValidGraphApiVersion("v21.0"), true);
  assert.equal(isValidGraphApiVersion("v21.0/messages"), false);
  assert.equal(isValidGraphApiVersion("vabc"), false);
  assert.equal(isValidGraphApiVersion(""), false);
  assert.ok(buildWhatsAppMessagesUrl("v21.0", "109876543210987"));
});

await test("27. Happy path transitions queued→sending→sent", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls, providerMessageId: "wamid.OK" }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 201);
      assert.equal(res.body.status, "sent");
      assert.equal(res.body.providerMessageId, "wamid.OK");
      const msg = repo.messages.get(res.body.messageId)!;
      assert.equal(msg.status, MESSAGE_STATUSES.SENT);
      assert.equal(calls.count, 1);
    }
  );
});

await test("28. Provider rejection transitions to failed", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "reject", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 502);
      assert.equal(res.body.status, MESSAGE_STATUSES.FAILED);
      assert.equal(calls.count, 1);
    }
  );
});

await test("29. Timeout transitions to timeout and does not resend", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "timeout", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 504);
      assert.equal(res.body.status, MESSAGE_STATUSES.TIMEOUT);
      assert.equal(calls.count, 1);
    }
  );
});

await test("30. Database creation failure means Graph API was never called", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  repo.failNextOutboundInsert = true;
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 500);
      assert.equal(calls.count, 0);
    }
  );
});

await test("31. Meta accepted but final status update initially failed: Meta called exactly once", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  let sentUpdateAttempts = 0;
  const originalUpdate = repo.updateMessageStatus.bind(repo);
  repo.updateMessageStatus = async (input) => {
    if (input.status === MESSAGE_STATUSES.SENT) {
      sentUpdateAttempts += 1;
      if (sentUpdateAttempts === 1) {
        throw new Error("simulated status update failure");
      }
    }
    return originalUpdate(input);
  };

  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({
      mode: "success",
      calls,
      providerMessageId: "wamid.RETRY",
    }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 201);
      assert.equal(calls.count, 1);
      assert.ok(sentUpdateAttempts >= 2);
    }
  );
});

await test("32. Audit events generated for important state transitions", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls: { count: 0 } }),
    [staffUser],
    async (base, tokens) => {
      await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      const types = repo.auditEvents.map((e) => e.eventType);
      assert.ok(types.includes("outbound_queued"));
      assert.ok(types.includes("outbound_sending"));
      assert.ok(types.includes("outbound_sent"));
    }
  );
});

await test("Disabled outbound returns 404", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  await withOutboundServer(
    repo,
    enabledConfig({ WHATSAPP_CONVERSATIONS_ENABLED: "false" }),
    mockGraphFetch({ mode: "success", calls: { count: 0 } }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 404);
    }
  );
});

await test("Inactive persistence returns 503", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  repo.active = false;
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls: { count: 0 } }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 503);
    }
  );
});

await test("provider rejection: failed-state DB update succeeds", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "reject", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 502);
      assert.equal(res.body.status, MESSAGE_STATUSES.FAILED);
      assert.equal(res.body.persistenceStatus, undefined);
      assert.equal(calls.count, 1);
    }
  );
});

await test("provider rejection: failed-state DB update retries then succeeds", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  let failAttempts = 0;
  const originalUpdate = repo.updateMessageStatus.bind(repo);
  repo.updateMessageStatus = async (input) => {
    if (input.status === MESSAGE_STATUSES.FAILED) {
      failAttempts += 1;
      if (failAttempts === 1) throw new Error("transient failed-status write");
    }
    return originalUpdate(input);
  };
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "reject", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 502);
      assert.equal(res.body.status, MESSAGE_STATUSES.FAILED);
      assert.equal(calls.count, 1);
      assert.ok(failAttempts >= 2);
    }
  );
});

await test("provider rejection: all failed-state DB updates fail → degraded, Meta once", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const originalUpdate = repo.updateMessageStatus.bind(repo);
  repo.updateMessageStatus = async (input) => {
    if (input.status === MESSAGE_STATUSES.FAILED) {
      throw new Error("persistent failed-status write failure");
    }
    return originalUpdate(input);
  };
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "reject", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 502);
      assert.equal(res.body.persistenceStatus, "incomplete");
      assert.equal(res.body.providerOutcome, "failed");
      assert.equal(res.body.status, MESSAGE_STATUSES.SENDING);
      assert.ok(res.body.messageId);
      assert.equal(calls.count, 1);
      assert.ok(
        repo.auditEvents.some((e) => e.eventType === "outbound_persistence_degraded")
      );
      const msg = repo.messages.get(res.body.messageId)!;
      assert.equal(msg.status, MESSAGE_STATUSES.SENDING);
    }
  );
});

await test("timeout: timeout-state DB update succeeds", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "timeout", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 504);
      assert.equal(res.body.status, MESSAGE_STATUSES.TIMEOUT);
      assert.equal(res.body.persistenceStatus, undefined);
      assert.equal(calls.count, 1);
    }
  );
});

await test("timeout: timeout-state DB update retries then succeeds", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  let timeoutAttempts = 0;
  const originalUpdate = repo.updateMessageStatus.bind(repo);
  repo.updateMessageStatus = async (input) => {
    if (input.status === MESSAGE_STATUSES.TIMEOUT) {
      timeoutAttempts += 1;
      if (timeoutAttempts === 1) throw new Error("transient timeout-status write");
    }
    return originalUpdate(input);
  };
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "timeout", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 504);
      assert.equal(res.body.status, MESSAGE_STATUSES.TIMEOUT);
      assert.equal(calls.count, 1);
      assert.ok(timeoutAttempts >= 2);
    }
  );
});

await test("timeout: all timeout-state DB updates fail → degraded, Meta once", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const originalUpdate = repo.updateMessageStatus.bind(repo);
  repo.updateMessageStatus = async (input) => {
    if (input.status === MESSAGE_STATUSES.TIMEOUT) {
      throw new Error("persistent timeout-status write failure");
    }
    return originalUpdate(input);
  };
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "timeout", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 504);
      assert.equal(res.body.persistenceStatus, "incomplete");
      assert.equal(res.body.providerOutcome, "timeout");
      assert.equal(res.body.status, MESSAGE_STATUSES.SENDING);
      assert.ok(res.body.messageId);
      assert.equal(calls.count, 1);
      assert.ok(
        repo.auditEvents.some((e) => e.eventType === "outbound_persistence_degraded")
      );
    }
  );
});

await test("degraded audit failure does not retry Meta or crash uncontrolled", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const originalUpdate = repo.updateMessageStatus.bind(repo);
  repo.updateMessageStatus = async (input) => {
    if (input.status === MESSAGE_STATUSES.FAILED) {
      throw new Error("status write failed");
    }
    return originalUpdate(input);
  };
  const originalAudit = repo.insertAuditEvent.bind(repo);
  repo.insertAuditEvent = async (input) => {
    if (input.eventType === "outbound_persistence_degraded") {
      throw new Error("audit unavailable Bearer secret-token-xyz");
    }
    return originalAudit(input);
  };
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "reject", calls }),
    [staffUser],
    async (base, tokens) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${tokens.staff}` }
      );
      assert.equal(res.status, 502);
      assert.equal(res.body.persistenceStatus, "incomplete");
      assert.equal(calls.count, 1);
      const bodyText = JSON.stringify(res.body);
      assert.equal(bodyText.includes("secret-token-xyz"), false);
      assert.equal(bodyText.includes("Bearer "), false);
    }
  );
});

if (failed > 0) {
  console.error(`\n${failed} outbound test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp outbound transport tests passed.");
