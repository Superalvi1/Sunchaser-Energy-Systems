/**
 * Isolated WA CRM adapter contract tests. No network, Meta credentials,
 * production database, or outbound message sends.
 * Run: node --experimental-strip-types server/integrations/wacrm/wacrmReadOnlyClient.test.ts
 */
import assert from "node:assert/strict";
import {
  createWacrmReadOnlyClient,
  readWacrmReadOnlyConfig,
  WacrmReadOnlyError,
} from "./wacrmReadOnlyClient.ts";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`, error);
  }
}

const baseEnv = {
  WACRM_INTEGRATION_ENABLED: "true",
  WACRM_BASE_URL: "https://wa.example.test",
  WACRM_READONLY_API_KEY: "wacrm_live_only_in_server",
};

function mockFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    return Promise.resolve(handler(new URL(String(input)), init));
  }) as typeof fetch;
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function config() {
  const value = readWacrmReadOnlyConfig(baseEnv);
  assert.ok(value);
  return value;
}

await test("disabled by default; no network or secret required", () => {
  assert.equal(readWacrmReadOnlyConfig({}), null);
  assert.throws(
    () => createWacrmReadOnlyClient(null, mockFetch(() => { throw Error("called"); })),
    (error: unknown) => error instanceof WacrmReadOnlyError && error.code === "disabled"
  );
});

await test("rejects insecure/embedded-credential/misconfigured origins", () => {
  for (const baseUrl of [
    "http://wa.example.test",
    "https://alice:password@wa.example.test",
    "https://wa.example.test/other",
    "https://wa.example.test/?key=secret",
    "not-a-url",
  ]) {
    assert.throws(
      () => readWacrmReadOnlyConfig({ ...baseEnv, WACRM_BASE_URL: baseUrl }),
      (error: unknown) => error instanceof WacrmReadOnlyError && error.code === "invalid_config"
    );
  }
});

await test("verifies exact account and missing read scopes, never attempts a send", async () => {
  let calls = 0;
  const client = createWacrmReadOnlyClient(
    config(),
    mockFetch((url, init) => {
      calls++;
      assert.equal(url.pathname, "/api/v1/me");
      assert.equal(init?.method, "GET");
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization,
        "Bearer wacrm_live_only_in_server");
      return json({
        data: {
          account: { id: "account_1", name: "Isolated Sandbox" },
          key: { id: "key_1", scopes: ["contacts:read", "messages:read"] },
        },
      });
    })
  );
  assert.deepEqual(await client.verifyReadScopes(), {
    accountId: "account_1",
    missingScopes: ["conversations:read"],
  });
  assert.equal(calls, 1);
  assert.equal("sendMessage" in client, false);
});

await test("read pagination is encoded and bounded", async () => {
  const client = createWacrmReadOnlyClient(
    config(),
    mockFetch((url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(url.pathname, "/api/v1/contacts");
      assert.equal(url.searchParams.get("search"), "a+b & sales");
      assert.equal(url.searchParams.get("cursor"), "cursor+/=");
      assert.equal(url.searchParams.get("limit"), "100");
      return json({ data: [], meta: { next_cursor: null } });
    })
  );
  assert.deepEqual(
    await client.listContacts({ search: "a+b & sales", cursor: "cursor+/=", limit: 100 }),
    { data: [], meta: { next_cursor: null } }
  );
  await assert.rejects(client.listContacts({ limit: 101 }));
});

await test("rejects malformed conversation ids before any upstream request", async () => {
  const client = createWacrmReadOnlyClient(
    config(),
    mockFetch(() => { throw Error("must never call"); })
  );
  await assert.rejects(
    client.listConversationMessages("../api/v1/messages"),
    (error: unknown) => error instanceof WacrmReadOnlyError && error.code === "invalid_input"
  );
});

await test("upstream errors do not leak API keys or upstream text", async () => {
  const client = createWacrmReadOnlyClient(
    config(),
    mockFetch(() => new Response("token=wacrm_live_only_in_server", { status: 401 }))
  );
  await assert.rejects(
    client.listConversations(),
    (error: unknown) => {
      assert.ok(error instanceof WacrmReadOnlyError);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.status, 401);
      assert.equal(error.message.includes("wacrm_live_only_in_server"), false);
      return true;
    }
  );
});

await test("missing API envelope fails closed", async () => {
  const client = createWacrmReadOnlyClient(config(), mockFetch(() => json({ ok: true })));
  await assert.rejects(
    client.listContacts(),
    (error: unknown) =>
      error instanceof WacrmReadOnlyError && error.code === "malformed_response"
  );
});

if (failed) process.exitCode = 1;
else console.log("WA CRM read-only adapter contract tests passed.");
