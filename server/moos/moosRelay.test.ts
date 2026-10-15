/**
 * Moos relay tests — HMAC signing, typed delivery results, and mutual
 * exclusion with the legacy CRM AI sales agent.
 *
 * Rule: when the legacy agent's settings.enabled is true, the Moos relay
 * stays silent (suppressed, not failed) so the two agents can never answer
 * the same conversation. When settings cannot be read, the relay fails
 * closed (treats the legacy agent as enabled). Disabled relay (MOOS_RELAY_ENABLED
 * unset) reports {status:'disabled'} — the webhook guards the call so this is
 * never audit noise.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=0 tsx server/moos/moosRelay.test.ts
 */
import assert from "node:assert/strict";
import {
  deliverRelayEvent,
  isLegacyAiEnabled,
  isLegacyAiEnabledFresh,
  moosRelayEnabled,
  moosRelaySignature,
  relayInboundToMoos,
  resetMoosRelayCacheForTests,
  type MoosRelayEvent,
} from "./moosRelay.ts";

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

const event: MoosRelayEvent = {
  conversationId: "conv-1",
  messageId: "wamid.test1",
  phone: "923001234567",
  phoneNumberId: "243825222156651",
  type: "text",
  text: "10kw quotation",
  sentAt: Date.now(),
};

function env(extra: Record<string, string> = {}) {
  return {
    MOOS_RELAY_ENABLED: "true",
    MOOS_WORKER_URL: "http://worker.example",
    RELAY_SECRET: "s3cret",
    ...extra,
  } as NodeJS.ProcessEnv;
}

await test("relay disabled when MOOS_RELAY_ENABLED is unset → typed disabled, no POST", async () => {
  assert.equal(moosRelayEnabled(env({ MOOS_RELAY_ENABLED: "" })), false);
  assert.equal(moosRelayEnabled(env()), true);
  let fetched = 0;
  const r = await relayInboundToMoos(env({ MOOS_RELAY_ENABLED: "" }), event, {
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as any,
  });
  assert.deepEqual(r, { status: "disabled", reason: "relay_disabled" });
  assert.equal(fetched, 0);
});

await test("legacy AI enabled → suppressed (not failed), no POST", async () => {
  resetMoosRelayCacheForTests();
  let fetched = 0;
  const r = await relayInboundToMoos(env(), event, {
    loadSettings: async () => ({ settings: { enabled: true } }),
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as any,
  });
  assert.deepEqual(r, { status: "suppressed", reason: "legacy_ai_enabled" });
  assert.equal(fetched, 0);
});

await test("legacy AI disabled → signed POST to the worker → delivered", async () => {
  resetMoosRelayCacheForTests();
  let seen: { url: string; sig: string; body: string } | null = null;
  const r = await relayInboundToMoos(env(), event, {
    loadSettings: async () => ({ settings: { enabled: false } }),
    fetchImpl: (async (url: string, init: any) => {
      seen = { url, sig: init.headers["X-Relay-Signature-256"], body: init.body };
      return new Response("{}", { status: 200 });
    }) as any,
  });
  assert.deepEqual(r, { status: "delivered" });
  assert.ok(seen);
  assert.equal(seen!.url, "http://worker.example/webhooks/crm");
  const expected = moosRelaySignature(seen!.body, "s3cret");
  assert.equal(seen!.sig, expected);
  assert.ok(seen!.sig.startsWith("sha256="));
  const parsed = JSON.parse(seen!.body);
  assert.equal(parsed.messageId, "wamid.test1");
});

await test("settings unreadable → fail closed (treated as legacy enabled)", async () => {
  resetMoosRelayCacheForTests();
  let fetched = 0;
  const r = await relayInboundToMoos(env(), event, {
    loadSettings: async () => {
      throw new Error("storage down");
    },
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as any,
  });
  assert.deepEqual(r, { status: "suppressed", reason: "legacy_ai_enabled" });
  assert.equal(fetched, 0);
  assert.equal(await isLegacyAiEnabledFresh(async () => {
    throw new Error("x");
  }), true);
});

await test("legacy-ai check is cached (one settings read per 30s); fresh read bypasses cache", async () => {
  resetMoosRelayCacheForTests();
  let reads = 0;
  const loader = async () => {
    reads++;
    return { settings: { enabled: false } };
  };
  await isLegacyAiEnabled(loader);
  await isLegacyAiEnabled(loader);
  assert.equal(reads, 1);
  await isLegacyAiEnabledFresh(loader);
  assert.equal(reads, 2);
});

await test("worker non-2xx → typed failed (outbox retries; webhook still 200s)", async () => {
  resetMoosRelayCacheForTests();
  const r = await relayInboundToMoos(env(), event, {
    loadSettings: async () => ({ settings: { enabled: false } }),
    fetchImpl: (async () => new Response("boom", { status: 500 })) as any,
  });
  assert.equal(r.status, "failed");
  assert.match(String((r as any).reason), /worker_status_500/);
});

await test("missing worker URL or secret → typed failed, no POST", async () => {
  resetMoosRelayCacheForTests();
  const r1 = await deliverRelayEvent(env({ MOOS_WORKER_URL: "" }), event, {
    loadSettings: async () => ({ settings: { enabled: false } }),
  });
  const r2 = await deliverRelayEvent(env({ RELAY_SECRET: "" }), event, {
    loadSettings: async () => ({ settings: { enabled: false } }),
  });
  assert.equal(r1.status, "failed");
  assert.equal(r2.status, "failed");
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll Moos relay tests passed.");
}
