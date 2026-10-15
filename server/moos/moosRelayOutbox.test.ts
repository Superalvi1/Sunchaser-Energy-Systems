/**
 * Moos relay outbox tests — durable inbound relay with bounded retry/backoff
 * and dead-letter alerting.
 *
 * Guarantees under test:
 *  - enqueue is idempotent per wamid (duplicate → no second row);
 *  - drain delivers queued events to the worker via HMAC POST;
 *  - worker failures are retried with backoff, then dead-lettered with a
 *    MOOS_RELAY_DEAD_LETTER audit (the human alert);
 *  - legacy AI enabled at drain time → suppressed (dropped, audited, never
 *    retried — the legacy agent owns the conversation);
 *  - drain is a no-op while MOOS_RELAY_ENABLED is unset.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=0 tsx server/moos/moosRelayOutbox.test.ts
 */
import assert from "node:assert/strict";
import {
  drainMoosRelayOutbox,
  InMemoryMoosRelayOutboxStore,
  MOOS_RELAY_OUTBOX_MAX_ATTEMPTS,
  MOOS_RELAY_RETRY_DELAYS_MS,
  type MoosRelayOutboxRow,
} from "./moosRelayOutbox.ts";
import type { MoosRelayEvent } from "./moosRelay.ts";

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

const evt = (wamid: string, conversationId = "conv-1"): MoosRelayEvent => ({
  conversationId,
  messageId: wamid,
  phone: "923001234567",
  phoneNumberId: "243825222156651",
  type: "text",
  text: "10kw quotation",
  sentAt: Date.now(),
});

const enabledEnv = {
  MOOS_RELAY_ENABLED: "true",
  MOOS_WORKER_URL: "http://worker.example",
  RELAY_SECRET: "s3cret",
} as NodeJS.ProcessEnv;

const okFetch = (async () => new Response("{}", { status: 200 })) as any;
const failFetch = (async () => new Response("boom", { status: 500 })) as any;
const legacyOff = async () => ({ settings: { enabled: false } });
const legacyOn = async () => ({ settings: { enabled: true } });

function drainDeps(store: InMemoryMoosRelayOutboxStore, overrides: Record<string, any> = {}) {
  const audits: any[] = [];
  return {
    deps: {
      store,
      env: enabledEnv,
      loadSettings: legacyOff,
      fetchImpl: okFetch,
      audit: async (eventType: string, entityId: string, metadata: any) => {
        audits.push({ eventType, entityId, metadata });
      },
      now: () => Date.now(),
      ...overrides,
    },
    audits,
  };
}

await test("enqueue is idempotent per wamid", async () => {
  const store = new InMemoryMoosRelayOutboxStore();
  const r1 = await store.enqueue(evt("wamid.a"));
  assert.deepEqual(r1, { enqueued: true, duplicate: false });
  const r2 = await store.enqueue(evt("wamid.a"));
  assert.deepEqual(r2, { enqueued: false, duplicate: true });
  assert.equal((await store.claimDue(Date.now(), 10)).length, 1);
});

await test("drain delivers queued events → delivered", async () => {
  const store = new InMemoryMoosRelayOutboxStore();
  await store.enqueue(evt("wamid.b"));
  const { deps } = drainDeps(store);
  const report = await drainMoosRelayOutbox(deps);
  assert.equal(report.delivered, 1);
  assert.equal(report.skipped, false);
  const row: MoosRelayOutboxRow | null = await store.get("wamid.b");
  assert.equal(row?.status, "delivered");
  // Already delivered → not claimed again.
  assert.equal((await store.claimDue(Date.now(), 10)).length, 0);
});

await test("worker failure → retried with backoff, then dead-lettered with human alert", async () => {
  const store = new InMemoryMoosRelayOutboxStore();
  await store.enqueue(evt("wamid.c"));
  let now = Date.now();
  const { deps, audits } = drainDeps(store, {
    fetchImpl: failFetch,
    now: () => now,
  });
  // Attempts 1..4 → retried with increasing backoff.
  for (let attempt = 1; attempt < MOOS_RELAY_OUTBOX_MAX_ATTEMPTS; attempt++) {
    const report = await drainMoosRelayOutbox(deps);
    assert.equal(report.retried, 1, `attempt ${attempt} should retry`);
    const row = (await store.get("wamid.c"))!;
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, attempt);
    const expectedDelay = MOOS_RELAY_RETRY_DELAYS_MS[attempt - 1];
    assert.ok(
      row.nextAttemptAt >= now + expectedDelay - 1000,
      `backoff ~${expectedDelay}ms after attempt ${attempt}`
    );
    // Not yet due → drain finds nothing until time passes.
    const idle = await drainMoosRelayOutbox(deps);
    assert.equal(idle.retried, 0);
    assert.equal(idle.deadLettered, 0);
    now = row.nextAttemptAt + 1;
  }
  // 5th failure → dead letter + human alert audit.
  const final = await drainMoosRelayOutbox(deps);
  assert.equal(final.deadLettered, 1);
  const row = (await store.get("wamid.c"))!;
  assert.equal(row.status, "dead_letter");
  assert.ok(
    audits.some((a) => a.eventType === "MOOS_RELAY_DEAD_LETTER"),
    "dead-letter audit emitted"
  );
  // Dead letter → never claimed again.
  assert.equal((await store.claimDue(now + 10 ** 12, 10)).length, 0);
});

await test("legacy AI on at drain time → suppressed, audited, never retried", async () => {
  const store = new InMemoryMoosRelayOutboxStore();
  await store.enqueue(evt("wamid.d"));
  let fetched = 0;
  const { deps, audits } = drainDeps(store, {
    loadSettings: legacyOn,
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as any,
  });
  const report = await drainMoosRelayOutbox(deps);
  assert.equal(report.suppressed, 1);
  assert.equal(fetched, 0);
  const row = (await store.get("wamid.d"))!;
  assert.equal(row.status, "suppressed");
  assert.ok(audits.some((a) => a.eventType === "MOOS_RELAY_SUPPRESSED"));
  // Suppressed → never retried.
  assert.equal((await store.claimDue(Date.now() + 10 ** 12, 10)).length, 0);
});

await test("drain skipped while MOOS_RELAY_ENABLED is unset", async () => {
  const store = new InMemoryMoosRelayOutboxStore();
  await store.enqueue(evt("wamid.e"));
  let fetched = 0;
  const { deps } = drainDeps(store, {
    env: { MOOS_RELAY_ENABLED: "" } as NodeJS.ProcessEnv,
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as any,
  });
  const report = await drainMoosRelayOutbox(deps);
  assert.equal(report.skipped, true);
  assert.equal(fetched, 0);
  assert.equal((await store.get("wamid.e"))?.status, "queued");
});

await test("claimDue returns only due rows, oldest first", async () => {
  const store = new InMemoryMoosRelayOutboxStore();
  const t0 = Date.now();
  await store.enqueue(evt("wamid.f1"));
  await store.enqueue(evt("wamid.f2"));
  // Push f2 into the future.
  await store.markFailed("wamid.f2", t0 + 600_000, t0, "boom");
  const due = await store.claimDue(t0, 10);
  assert.deepEqual(due.map((r) => r.messageId), ["wamid.f1"]);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll Moos relay outbox tests passed.");
}
