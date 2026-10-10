import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceLockCount, withInvoiceLock } from "./invoiceLock.ts";

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

test("work on one key runs strictly one after another, in arrival order", async () => {
  const log: string[] = [];
  const job = (name: string, ms: number) => withInvoiceLock("inv-1", async () => {
    log.push(`start ${name}`);
    await tick(ms);
    log.push(`end ${name}`);
  });
  await Promise.all([job("a", 15), job("b", 1), job("c", 5)]);
  assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("a read-modify-write that yields in the middle does not lose updates under the lock", async () => {
  let balance = 100;
  const withdraw = (n: number) => withInvoiceLock("inv-2", async () => {
    const seen = balance;
    await tick();
    if (n <= seen) balance = seen - n;
  });
  await Promise.all(Array.from({ length: 5 }, () => withdraw(30)));
  assert.equal(balance, 10, "three withdrawals of 30 fit in 100; the others see the reduced balance and are skipped");
  // the same code without the lock is the race this module exists to close
  let racy = 100;
  await Promise.all(Array.from({ length: 5 }, async () => { const seen = racy; await tick(); if (30 <= seen) racy = seen - 30; }));
  assert.equal(racy, 70, "without the lock every caller read 100 and the last write wins");
});

test("different keys do not wait for each other", async () => {
  const order: string[] = [];
  const slow = withInvoiceLock("inv-3", async () => { await tick(30); order.push("slow"); });
  const fast = withInvoiceLock("inv-4", async () => { order.push("fast"); });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["fast", "slow"]);
});

test("an error releases the lock and propagates; the queue keeps moving and cleans up", async () => {
  await assert.rejects(withInvoiceLock("inv-5", async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await withInvoiceLock("inv-5", async () => "next"), "next");
  await tick(5);
  assert.equal(invoiceLockCount(), 0, "no keys are kept once everything finished");
});

test("a hung holder cannot freeze the invoice: waiters proceed after the maximum wait", async () => {
  let release!: () => void;
  const hung = withInvoiceLock("inv-6", () => new Promise<void>((r) => { release = r; }));
  const started = Date.now();
  const second = await withInvoiceLock("inv-6", async () => "ran", 40);
  assert.equal(second, "ran");
  assert.ok(Date.now() - started >= 35, "it waited for the holder first");
  release();
  await hung;
});
