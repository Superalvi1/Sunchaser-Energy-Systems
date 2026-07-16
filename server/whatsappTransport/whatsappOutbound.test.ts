/**
 * WhatsApp outbound transport tests.
 * Run: npm run test:whatsapp-transport
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { isPublicApiRoute } from "../middleware/publicRoutes.ts";
import { createAuthorizationMiddleware } from "../middleware/authorization.ts";
import { signAccessToken } from "../auth/jwt.ts";
import { readWhatsAppConfig } from "./whatsappConfig.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import { createWhatsAppOutboundRouter } from "./whatsappOutboundRoutes.ts";
import { MESSAGE_STATUSES } from "./whatsappConstants.ts";

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
// Force local auth hydration for tests (no real Supabase).
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;

const PHONE_NUMBER_ID = "pnid-configured";

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

function mockDb() {
  return {
    users: [
      {
        id: "u-staff",
        username: "staff",
        name: "Staff User",
        email: "staff@test.com",
        role: "Super Admin",
        account_status: "Approved",
      },
    ],
  } as any;
}

async function withOutboundServer(
  repo: InMemoryWhatsAppRepository,
  config: ReturnType<typeof enabledConfig>,
  fetchImpl: typeof fetch | undefined,
  fn: (baseUrl: string, token: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    createAuthorizationMiddleware({
      resolveLocalDb: () => mockDb(),
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
  const token = signAccessToken({
    userId: "u-staff",
    username: "staff",
    role: "Super Admin",
  });
  try {
    await fn(baseUrl, token);
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
  return (async (_url: any, init?: any) => {
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
    async (base) => {
      const res = await postMessage(base, conversation.id, { text: "hi" });
      assert.equal(res.status, 401);
      assert.equal(calls.count, 0);
    }
  );
});

await test("22. Outbound route is absent from public allowlist", () => {
  assert.equal(
    isPublicApiRoute("POST", "/api/conversations/abc/messages"),
    false
  );
  assert.equal(
    isPublicApiRoute("POST", "/api/conversations/wcv_1/messages"),
    false
  );
});

await test("23. Empty text returns 400", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls: { count: 0 } }),
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "   " },
        { authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 400);
    }
  );
});

await test("24. Unknown conversation returns 404", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls: { count: 0 } }),
    async (base, token) => {
      const res = await postMessage(
        base,
        "missing-conversation",
        { text: "hello" },
        { authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 404);
    }
  );
});

await test("25. Sender/channel mismatch fails closed", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo, {
    phoneNumberId: "pnid-other",
  });
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls }),
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${token}` }
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
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 503);
      assert.equal(calls.count, 0);
    }
  );
});

await test("27. Happy path transitions queued→sending→sent", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  const calls = { count: 0 };
  await withOutboundServer(
    repo,
    enabledConfig(),
    mockGraphFetch({ mode: "success", calls, providerMessageId: "wamid.OK" }),
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 201);
      assert.equal(res.body.status, "sent");
      assert.equal(res.body.providerMessageId, "wamid.OK");
      assert.ok(res.body.messageId);
      const msg = repo.messages.get(res.body.messageId)!;
      assert.equal(msg.status, MESSAGE_STATUSES.SENT);
      assert.equal(msg.waMessageId, "wamid.OK");
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
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 502);
      assert.equal(res.body.status, MESSAGE_STATUSES.FAILED);
      const msg = repo.messages.get(res.body.messageId)!;
      assert.equal(msg.status, MESSAGE_STATUSES.FAILED);
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
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${token}` }
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
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 500);
      assert.equal(calls.count, 0);
    }
  );
});

await test("31. Meta accepted but final status update initially failed: Meta called exactly once", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const { conversation } = await seedConversation(repo);
  // Fail first status update after Meta success; retries should succeed.
  // Flow: queued→sending (ok), then sent update fails once then succeeds.
  repo.failStatusUpdatesRemaining = 0;
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
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 201);
      assert.equal(res.body.providerMessageId, "wamid.RETRY");
      assert.equal(calls.count, 1);
      assert.ok(sentUpdateAttempts >= 2);
      const msg = repo.messages.get(res.body.messageId)!;
      assert.equal(msg.status, MESSAGE_STATUSES.SENT);
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
    async (base, token) => {
      await postMessage(
        base,
        conversation.id,
        { text: "Outbound hello" },
        { authorization: `Bearer ${token}` }
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
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${token}` }
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
    async (base, token) => {
      const res = await postMessage(
        base,
        conversation.id,
        { text: "hello" },
        { authorization: `Bearer ${token}` }
      );
      assert.equal(res.status, 503);
    }
  );
});

if (failed > 0) {
  console.error(`\n${failed} outbound test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp outbound transport tests passed.");
