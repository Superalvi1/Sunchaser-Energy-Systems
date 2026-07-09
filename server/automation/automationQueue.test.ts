import assert from "node:assert/strict";
import {
  computeRetryDelayMs,
  createAutomationQueue,
  createAutomationQueueJob,
  DEFAULT_AUTOMATION_RETRY_POLICY,
  markJobCompleted,
  markJobRunning,
  scheduleJobRetry,
  shouldRetryJob,
} from "./AutomationQueue.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const job = createAutomationQueueJob({
  id: "j1", companyId: "c1", ruleId: "r1", actionId: "a1", actionType: "queue_email",
  triggerEventId: "te-1", maxAttempts: 3, payload: { template: "x" },
});

check("job pending", job.status === "pending");
check("job attempts zero", job.attempts === 0);
check("should retry", shouldRetryJob(job));

check("fixed delay", computeRetryDelayMs(1, { ...DEFAULT_AUTOMATION_RETRY_POLICY, backoff: "fixed" }) === 1000);
check("linear delay", computeRetryDelayMs(2, { ...DEFAULT_AUTOMATION_RETRY_POLICY, backoff: "linear" }) === 2000);
check("exponential delay", computeRetryDelayMs(3, { ...DEFAULT_AUTOMATION_RETRY_POLICY, backoff: "exponential" }) === 4000);
check("max delay cap", computeRetryDelayMs(10, DEFAULT_AUTOMATION_RETRY_POLICY) <= DEFAULT_AUTOMATION_RETRY_POLICY.maxDelayMs);

const running = markJobRunning(job, 0);
check("mark running", running.status === "running");

const completed = markJobCompleted(job, 1000);
check("mark completed", completed.status === "completed");

const retried = scheduleJobRetry(job, "network_error", 5000);
check("schedule retry attempts", retried.attempts === 1);
check("schedule retry failed status", retried.status === "failed");
check("schedule retry nextRetryAt", retried.nextRetryAt !== null);

const dead = scheduleJobRetry({ ...job, attempts: 2 }, "fail", 5000);
check("dead letter", dead.status === "dead_letter");
check("no retry when dead", !shouldRetryJob(dead));

const queue = createAutomationQueue();
queue.enqueue(job);
check("queue length", queue.length === 1);
check("list pending", queue.listPending(0).length === 1);

const retryJob = scheduleJobRetry(job, "err", 0);
queue.update(retryJob);
check("list pending future retry", queue.listPending(0).length === 0);
check("list pending when due", queue.listPending(Date.parse(retryJob.nextRetryAt!)).length === 1);

queue.update(markJobCompleted(job, 0));
check("queue update", queue.get("j1")?.status === "completed");

for (let i = 1; i <= 5; i += 1) {
  const d = computeRetryDelayMs(i, DEFAULT_AUTOMATION_RETRY_POLICY);
  check(`delay iteration ${i}`, d > 0);
}

console.log(`\nautomationQueue.test.ts: ${pass} passed`);
