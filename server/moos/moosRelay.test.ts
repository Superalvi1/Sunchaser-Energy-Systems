/**
 * Moos relay tests — HMAC signing and mutual exclusion with the legacy CRM
 * AI sales agent.
 *
 * Rule: when the legacy agent's settings.enabled is true, the Moos relay
 * stays silent (onSuppressed fires) so the two agents can never answer the
 * same conversation. When settings cannot be read, the relay fails closed
 * (treats the legacy agent as enabled).
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=0 tsx server/moos/moosRelay.test.ts
 */
import assert from "node:assert/strict";
import {
  isLegacyAiEnabled,
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

await test("relay disabled when MOOS_RELAY_ENABLED is unset", async () => {
  let fetched = 0;
  const r = await relayInboundToMoos(env({ MOOS_RELAY_ENABLED: "" }), event, {
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as any,
  });
  assert.equal(r, false);
  assert.equal(fetched, 0);
});

await test("legacy AI enabled → relay suppressed, onSuppressed fires, no POST", async () => {
  resetMoosRelayCacheForTests();
  let fetched = 0;
  let suppressed: string | null = null;
  const r = await relayInboundToMoos(env(), event, {
    loadSettings: async () => ({ settings: { enabled: true } }),
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as any,
    onSuppressed: (reason) => {
      suppressed = reason;
    },
  });
  assert.equal(r, false);
  assert.equal(fetched, 0);
  assert.equal(suppressed, "legacy_ai_enabled");
});

await test("legacy AI disabled → signed POST to the worker", async () => {
  resetMoosRelayCacheForTests();
  let seen: { url: string; sig: string; body: string } | null = null;
  const r = await relayInboundToMoos(env(), event, {
    loadSettings: async () => ({ settings: { enabled: false } }),
    fetchImpl: (async (url: string, init: any) => {
      seen = { url, sig: init.headers["X-Relay-Signature-256"], body: init.body };
      return new Response("{}", { status: 200 });
    }) as any,
  });
  assert.equal(r, true);
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
  assert.equal(r, false);
  assert.equal(fetched, 0);
  assert.equal(await isLegacyAiEnabled(async () => {
    throw new Error("x");
  }), true);
});

await test("legacy-ai check is cached (one settings read per 30s)", async () => {
  resetMoosRelayCacheForTests();
  let reads = 0;
  const loader = async () => {
    reads++;
    return { settings: { enabled: false } };
  };
  await isLegacyAiEnabled(loader);
  await isLegacyAiEnabled(loader);
  assert.equal(reads, 1);
});

await test("worker non-2xx → relay reports failure (caller audits, webhook still 200s)", async () => {
  resetMoosRelayCacheForTests();
  const r = await relayInboundToMoos(env(), event, {
    loadSettings: async () => ({ settings: { enabled: false } }),
    fetchImpl: (async () => new Response("boom", { status: 500 })) as any,
  });
  assert.equal(r, false);
});

await test("missing worker URL or secret → no relay", async () => {
  resetMoosRelayCacheForTests();
  const r1 = await relayInboundToMoos(env({ MOOS_WORKER_URL: "" }), event, {
    loadSettings: async () => ({ settings: { enabled: false } }),
  });
  const r2 = await relayInboundToMoos(env({ RELAY_SECRET: "" }), event, {
    loadSettings: async () => ({ settings: { enabled: false } }),
  });
  assert.equal(r1, false);
  assert.equal(r2, false);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll Moos relay tests passed.");
}
