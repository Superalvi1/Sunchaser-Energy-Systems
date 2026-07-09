import assert from "node:assert/strict";
import { RetryPolicy } from "./RetryPolicy.ts";

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

await test("constructor rejects maxAttempts below 1", () => {
  assert.throws(
    () => new RetryPolicy({ maxAttempts: 0, backoff: "fixed", baseDelayMs: 10 }),
    RangeError
  );
});
await test("constructor accepts maxAttempts of exactly 1", () => {
  assert.doesNotThrow(() => new RetryPolicy({ maxAttempts: 1, backoff: "fixed", baseDelayMs: 10 }));
});
await test("constructor rejects negative baseDelayMs", () => {
  assert.throws(
    () => new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: -1 }),
    RangeError
  );
});
await test("constructor accepts baseDelayMs of 0", () => {
  assert.doesNotThrow(() => new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 0 }));
});
await test("jitter defaults to disabled", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 100 });
  assert.equal(policy.jitter, false);
});
await test("maxDelayMs defaults to unbounded", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 100 });
  assert.equal(policy.maxDelayMs, Number.POSITIVE_INFINITY);
});

await test("shouldRetry is true while attempts remain below the cap", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 10 });
  assert.equal(policy.shouldRetry(1), true);
  assert.equal(policy.shouldRetry(2), true);
});
await test("shouldRetry is false once the attempt count reaches the cap", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 10 });
  assert.equal(policy.shouldRetry(3), false);
});
await test("shouldRetry is false beyond the cap", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 10 });
  assert.equal(policy.shouldRetry(4), false);
});
await test("shouldRetry is always false when maxAttempts is 1", () => {
  const policy = new RetryPolicy({ maxAttempts: 1, backoff: "fixed", baseDelayMs: 10 });
  assert.equal(policy.shouldRetry(1), false);
});

await test("fixed backoff returns the same delay regardless of attempt number", () => {
  const policy = new RetryPolicy({ maxAttempts: 5, backoff: "fixed", baseDelayMs: 200 });
  assert.equal(policy.computeDelay(1), 200);
  assert.equal(policy.computeDelay(2), 200);
  assert.equal(policy.computeDelay(4), 200);
});

await test("linear backoff scales delay by the attempt number", () => {
  const policy = new RetryPolicy({ maxAttempts: 5, backoff: "linear", baseDelayMs: 100 });
  assert.equal(policy.computeDelay(1), 100);
  assert.equal(policy.computeDelay(2), 200);
  assert.equal(policy.computeDelay(3), 300);
});

await test("exponential backoff doubles the delay each attempt", () => {
  const policy = new RetryPolicy({ maxAttempts: 6, backoff: "exponential", baseDelayMs: 50 });
  assert.equal(policy.computeDelay(1), 50);
  assert.equal(policy.computeDelay(2), 100);
  assert.equal(policy.computeDelay(3), 200);
  assert.equal(policy.computeDelay(4), 400);
});

await test("computeDelay caps at maxDelayMs when provided", () => {
  const policy = new RetryPolicy({
    maxAttempts: 6,
    backoff: "exponential",
    baseDelayMs: 100,
    maxDelayMs: 250,
  });
  assert.equal(policy.computeDelay(1), 100);
  assert.equal(policy.computeDelay(2), 200);
  assert.equal(policy.computeDelay(3), 250);
  assert.equal(policy.computeDelay(4), 250);
});

await test("computeDelay with jitter disabled is deterministic", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 300 });
  assert.equal(policy.computeDelay(1, () => 0.9999), 300);
});

await test("computeDelay with jitter scales between 50% and 100% of the base delay", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 100, jitter: true });
  assert.equal(policy.computeDelay(1, () => 0), 50);
  assert.equal(policy.computeDelay(1, () => 1), 100);
  assert.equal(policy.computeDelay(1, () => 0.5), 75);
});

await test("computeDelay defaults to Math.random when no generator is supplied", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 100, jitter: true });
  const delay = policy.computeDelay(1);
  assert.ok(delay >= 50 && delay <= 100);
});

await test("computeDelay rounds to the nearest integer millisecond", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 10, jitter: true });
  const delay = policy.computeDelay(1, () => 0.33);
  assert.equal(Number.isInteger(delay), true);
});

await test("computeDelay never returns a negative number", () => {
  const policy = new RetryPolicy({ maxAttempts: 3, backoff: "fixed", baseDelayMs: 0 });
  assert.equal(policy.computeDelay(1), 0);
});

await test("jitter is applied after the maxDelayMs cap", () => {
  const policy = new RetryPolicy({
    maxAttempts: 5,
    backoff: "exponential",
    baseDelayMs: 100,
    maxDelayMs: 200,
    jitter: true,
  });
  const delay = policy.computeDelay(4, () => 1);
  assert.equal(delay, 200);
});

await test("multiple RetryPolicy instances do not share state", () => {
  const a = new RetryPolicy({ maxAttempts: 2, backoff: "fixed", baseDelayMs: 10 });
  const b = new RetryPolicy({ maxAttempts: 5, backoff: "fixed", baseDelayMs: 20 });
  assert.equal(a.shouldRetry(2), false);
  assert.equal(b.shouldRetry(2), true);
});

await test("exponential backoff at attempt 1 equals baseDelayMs (2^0)", () => {
  const policy = new RetryPolicy({ maxAttempts: 5, backoff: "exponential", baseDelayMs: 40 });
  assert.equal(policy.computeDelay(1), 40);
});

await test("linear backoff at attempt 1 equals baseDelayMs", () => {
  const policy = new RetryPolicy({ maxAttempts: 5, backoff: "linear", baseDelayMs: 40 });
  assert.equal(policy.computeDelay(1), 40);
});

await test("readonly config fields reflect constructor input", () => {
  const policy = new RetryPolicy({
    maxAttempts: 4,
    backoff: "linear",
    baseDelayMs: 15,
    maxDelayMs: 999,
    jitter: true,
  });
  assert.equal(policy.maxAttempts, 4);
  assert.equal(policy.backoff, "linear");
  assert.equal(policy.baseDelayMs, 15);
  assert.equal(policy.maxDelayMs, 999);
  assert.equal(policy.jitter, true);
});

console.log(`\nRetryPolicy tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
