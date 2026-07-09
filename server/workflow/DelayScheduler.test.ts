import assert from "node:assert/strict";
import { DelayScheduler } from "./DelayScheduler.ts";
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

await test("schedule rejects a negative duration", () => {
  const scheduler = new DelayScheduler(new ManualClock(0));
  assert.throws(() => scheduler.schedule("step-1", -1), RangeError);
});

await test("schedule accepts a duration of 0", () => {
  const scheduler = new DelayScheduler(new ManualClock(0));
  assert.doesNotThrow(() => scheduler.schedule("step-1", 0));
});

await test("schedule stamps scheduledAt from the clock", () => {
  const scheduler = new DelayScheduler(new ManualClock(100));
  const state = scheduler.schedule("step-1", 500);
  assert.equal(state.scheduledAt, 100);
});

await test("schedule computes resumeAt as scheduledAt plus duration", () => {
  const scheduler = new DelayScheduler(new ManualClock(100));
  const state = scheduler.schedule("step-1", 500);
  assert.equal(state.resumeAt, 600);
});

await test("schedule stores the step id", () => {
  const scheduler = new DelayScheduler(new ManualClock(0));
  const state = scheduler.schedule("wait-step", 100);
  assert.equal(state.stepId, "wait-step");
});

await test("isDue is false before the resume time", () => {
  const clock = new ManualClock(0);
  const scheduler = new DelayScheduler(clock);
  const state = scheduler.schedule("step-1", 1_000);
  clock.advance(999);
  assert.equal(scheduler.isDue(state), false);
});

await test("isDue is true exactly at the resume time", () => {
  const clock = new ManualClock(0);
  const scheduler = new DelayScheduler(clock);
  const state = scheduler.schedule("step-1", 1_000);
  clock.advance(1_000);
  assert.equal(scheduler.isDue(state), true);
});

await test("isDue is true after the resume time", () => {
  const clock = new ManualClock(0);
  const scheduler = new DelayScheduler(clock);
  const state = scheduler.schedule("step-1", 1_000);
  clock.advance(5_000);
  assert.equal(scheduler.isDue(state), true);
});

await test("a zero-duration delay is immediately due", () => {
  const scheduler = new DelayScheduler(new ManualClock(500));
  const state = scheduler.schedule("step-1", 0);
  assert.equal(scheduler.isDue(state), true);
});

await test("remaining reports the time left before resumeAt", () => {
  const clock = new ManualClock(0);
  const scheduler = new DelayScheduler(clock);
  const state = scheduler.schedule("step-1", 1_000);
  clock.advance(400);
  assert.equal(scheduler.remaining(state), 600);
});

await test("remaining is 0 once due, never negative", () => {
  const clock = new ManualClock(0);
  const scheduler = new DelayScheduler(clock);
  const state = scheduler.schedule("step-1", 1_000);
  clock.advance(5_000);
  assert.equal(scheduler.remaining(state), 0);
});

await test("remaining equals the full duration immediately after scheduling", () => {
  const scheduler = new DelayScheduler(new ManualClock(0));
  const state = scheduler.schedule("step-1", 2_500);
  assert.equal(scheduler.remaining(state), 2_500);
});

console.log(`\nDelayScheduler tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
