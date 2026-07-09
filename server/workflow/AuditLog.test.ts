import assert from "node:assert/strict";
import { AuditLog } from "./AuditLog.ts";
import { ManualClock } from "./Clock.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

await test("record returns an entry with seq 1 for the first call", () => {
  const audit = new AuditLog(new ManualClock(0));
  const entry = audit.record("wfi-1", "workflow.started");
  assert.equal(entry.seq, 1);
});

await test("record increments seq across calls", () => {
  const audit = new AuditLog(new ManualClock(0));
  audit.record("wfi-1", "a");
  const second = audit.record("wfi-1", "b");
  assert.equal(second.seq, 2);
});

await test("record stamps the entry with the clock's current time", () => {
  const clock = new ManualClock(500);
  const audit = new AuditLog(clock);
  const entry = audit.record("wfi-1", "a");
  assert.equal(entry.timestamp, 500);
});

await test("record uses the clock reading at call time, not construction time", () => {
  const clock = new ManualClock(0);
  const audit = new AuditLog(clock);
  clock.advance(1_000);
  const entry = audit.record("wfi-1", "a");
  assert.equal(entry.timestamp, 1_000);
});

await test("record stores instanceId and type", () => {
  const audit = new AuditLog(new ManualClock(0));
  const entry = audit.record("wfi-42", "step.started");
  assert.equal(entry.instanceId, "wfi-42");
  assert.equal(entry.type, "step.started");
});

await test("record omits stepId when not provided", () => {
  const audit = new AuditLog(new ManualClock(0));
  const entry = audit.record("wfi-1", "a");
  assert.equal("stepId" in entry, false);
});

await test("record includes stepId when provided", () => {
  const audit = new AuditLog(new ManualClock(0));
  const entry = audit.record("wfi-1", "a", "step-1");
  assert.equal(entry.stepId, "step-1");
});

await test("record omits data when not provided", () => {
  const audit = new AuditLog(new ManualClock(0));
  const entry = audit.record("wfi-1", "a");
  assert.equal("data" in entry, false);
});

await test("record attaches arbitrary data payload", () => {
  const audit = new AuditLog(new ManualClock(0));
  const entry = audit.record("wfi-1", "a", "step-1", { foo: "bar" });
  assert.deepEqual(entry.data, { foo: "bar" });
});

await test("entriesFor filters by instance id", () => {
  const audit = new AuditLog(new ManualClock(0));
  audit.record("wfi-1", "a");
  audit.record("wfi-2", "b");
  audit.record("wfi-1", "c");
  const entries = audit.entriesFor("wfi-1");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.type), ["a", "c"]);
});

await test("entriesFor returns an empty array for an unknown instance", () => {
  const audit = new AuditLog(new ManualClock(0));
  audit.record("wfi-1", "a");
  assert.deepEqual(audit.entriesFor("nope"), []);
});

await test("all returns every recorded entry across instances", () => {
  const audit = new AuditLog(new ManualClock(0));
  audit.record("wfi-1", "a");
  audit.record("wfi-2", "b");
  assert.equal(audit.all().length, 2);
});

await test("all preserves insertion order", () => {
  const audit = new AuditLog(new ManualClock(0));
  audit.record("wfi-1", "first");
  audit.record("wfi-1", "second");
  audit.record("wfi-1", "third");
  assert.deepEqual(audit.all().map((e) => e.type), ["first", "second", "third"]);
});

await test("has no public clear method", () => {
  const audit = new AuditLog(new ManualClock(0));
  assert.equal("clear" in audit, false);
  assert.equal(typeof (audit as { clear?: unknown }).clear, "undefined");
});

await test("all() array mutation does not affect the stored log", () => {
  const audit = new AuditLog(new ManualClock(0));
  audit.record("wfi-1", "a");
  const snapshot = audit.all();
  snapshot.push({
    seq: 99,
    timestamp: 0,
    instanceId: "wfi-1",
    type: "injected",
  });
  assert.equal(audit.all().length, 1);
  assert.deepEqual(audit.all().map((e) => e.type), ["a"]);
});

await test("mutating a returned entry does not affect the stored log", () => {
  const audit = new AuditLog(new ManualClock(0));
  const recorded = audit.record("wfi-1", "original", "step-1", { nested: { value: 1 } });
  const fromAll = audit.all()[0]!;
  const fromEntriesFor = audit.entriesFor("wfi-1")[0]!;

  assert.throws(() => {
    (recorded as { type: string }).type = "mutated";
  });
  assert.throws(() => {
    (fromAll as { type: string }).type = "mutated";
  });
  assert.throws(() => {
    (fromEntriesFor as { type: string }).type = "mutated";
  });
  assert.throws(() => {
    (fromAll.data as { nested: { value: number } }).nested.value = 99;
  });

  assert.equal(audit.all()[0]!.type, "original");
  assert.deepEqual(audit.all()[0]!.data, { nested: { value: 1 } });
});

await test("sequence numbers continue monotonically and never reset", () => {
  const audit = new AuditLog(new ManualClock(0));
  const first = audit.record("wfi-1", "a");
  const second = audit.record("wfi-2", "b");
  const third = audit.record("wfi-1", "c");
  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.equal(third.seq, 3);
  assert.deepEqual(audit.all().map((e) => e.seq), [1, 2, 3]);
});

await test("append-only: new records extend history without rewriting prior entries", () => {
  const audit = new AuditLog(new ManualClock(0));
  audit.record("wfi-1", "first");
  const before = audit.all();
  audit.record("wfi-1", "second");
  assert.equal(before.length, 1);
  assert.equal(before[0]!.type, "first");
  assert.deepEqual(audit.all().map((e) => e.type), ["first", "second"]);
});

console.log(`\nAuditLog tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
