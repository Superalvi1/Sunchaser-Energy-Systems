import assert from "node:assert/strict";
import { ManualClock, SystemClock } from "./Clock.ts";

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

await test("SystemClock.now returns a number close to Date.now()", () => {
  const clock = new SystemClock();
  const before = Date.now();
  const now = clock.now();
  const after = Date.now();
  assert.ok(now >= before && now <= after);
});

await test("ManualClock defaults to 0", () => {
  const clock = new ManualClock();
  assert.equal(clock.now(), 0);
});

await test("ManualClock starts at provided timestamp", () => {
  const clock = new ManualClock(1_000);
  assert.equal(clock.now(), 1_000);
});

await test("ManualClock.advance moves time forward", () => {
  const clock = new ManualClock(100);
  clock.advance(50);
  assert.equal(clock.now(), 150);
});

await test("ManualClock.advance accumulates across calls", () => {
  const clock = new ManualClock(0);
  clock.advance(10);
  clock.advance(20);
  clock.advance(30);
  assert.equal(clock.now(), 60);
});

await test("ManualClock.advance returns the new timestamp", () => {
  const clock = new ManualClock(5);
  assert.equal(clock.advance(5), 10);
});

await test("ManualClock.advance(0) is a no-op", () => {
  const clock = new ManualClock(42);
  clock.advance(0);
  assert.equal(clock.now(), 42);
});

await test("ManualClock.advance rejects negative durations", () => {
  const clock = new ManualClock(0);
  assert.throws(() => clock.advance(-1), RangeError);
});

await test("ManualClock.set overwrites the current time", () => {
  const clock = new ManualClock(0);
  clock.set(9_999);
  assert.equal(clock.now(), 9_999);
});

await test("ManualClock.set accepts an earlier timestamp than current", () => {
  const clock = new ManualClock(1_000);
  clock.set(10);
  assert.equal(clock.now(), 10);
});

await test("ManualClock instances are independent", () => {
  const a = new ManualClock(0);
  const b = new ManualClock(0);
  a.advance(100);
  assert.equal(a.now(), 100);
  assert.equal(b.now(), 0);
});

await test("ManualClock implements the Clock interface shape", () => {
  const clock = new ManualClock(0);
  assert.equal(typeof clock.now, "function");
});

console.log(`\nClock tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
