import assert from "node:assert/strict";
import { EscalationManager } from "./EscalationManager.ts";
import { ActionHandlerRegistry } from "./ActionHandlerRegistry.ts";
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

function setup() {
  const clock = new ManualClock(0);
  const audit = new AuditLog(clock);
  const registry = new ActionHandlerRegistry();
  const escalations = new EscalationManager(registry, audit);
  return { clock, audit, registry, escalations };
}

await test("escalate records an escalation.triggered audit entry", async () => {
  const { audit, escalations } = setup();
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "retryExhausted",
    context: {},
  });
  const entries = audit.entriesFor("wfi-1");
  assert.equal(entries.some((e) => e.type === "escalation.triggered"), true);
});

await test("escalate without a handler does not throw and records only the trigger", async () => {
  const { audit, escalations } = setup();
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "approvalTimeout",
    context: {},
  });
  const entries = audit.entriesFor("wfi-1");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "escalation.triggered");
});

await test("escalate invokes the named handler when provided", async () => {
  const { registry, escalations } = setup();
  let called = false;
  registry.register("notifyOncall", () => {
    called = true;
  });
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "retryExhausted",
    handler: "notifyOncall",
    context: {},
  });
  assert.equal(called, true);
});

await test("escalate passes reason and stepId as the handler's input", async () => {
  const { registry, escalations } = setup();
  let receivedInput: unknown;
  registry.register("notifyOncall", (input) => {
    receivedInput = input;
  });
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-7",
    reason: "approvalRejected",
    handler: "notifyOncall",
    context: {},
  });
  assert.deepEqual(receivedInput, { reason: "approvalRejected", stepId: "step-7" });
});

await test("escalate passes the workflow context through to the handler", async () => {
  const { registry, escalations } = setup();
  let receivedContext: unknown;
  registry.register("notifyOncall", (_input, context) => {
    receivedContext = context;
  });
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "retryExhausted",
    handler: "notifyOncall",
    context: { orderId: "o-1" },
  });
  assert.deepEqual(receivedContext, { orderId: "o-1" });
});

await test("escalate records escalation.handled after a successful handler run", async () => {
  const { audit, registry, escalations } = setup();
  registry.register("notifyOncall", () => "ok");
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "retryExhausted",
    handler: "notifyOncall",
    context: {},
  });
  const types = audit.entriesFor("wfi-1").map((e) => e.type);
  assert.deepEqual(types, ["escalation.triggered", "escalation.handled"]);
});

await test("escalate does not throw when the handler itself throws", async () => {
  const { registry, escalations } = setup();
  registry.register("brokenHandler", () => {
    throw new Error("handler exploded");
  });
  await assert.doesNotReject(() =>
    escalations.escalate({
      instanceId: "wfi-1",
      stepId: "step-1",
      reason: "retryExhausted",
      handler: "brokenHandler",
      context: {},
    })
  );
});

await test("escalate records escalation.handlerFailed when the handler throws", async () => {
  const { audit, registry, escalations } = setup();
  registry.register("brokenHandler", () => {
    throw new Error("handler exploded");
  });
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "retryExhausted",
    handler: "brokenHandler",
    context: {},
  });
  const types = audit.entriesFor("wfi-1").map((e) => e.type);
  assert.deepEqual(types, ["escalation.triggered", "escalation.handlerFailed"]);
});

await test("escalate records the error message when the handler fails", async () => {
  const { audit, registry, escalations } = setup();
  registry.register("brokenHandler", () => {
    throw new Error("handler exploded");
  });
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "retryExhausted",
    handler: "brokenHandler",
    context: {},
  });
  const failedEntry = audit.entriesFor("wfi-1").find((e) => e.type === "escalation.handlerFailed");
  assert.equal(failedEntry?.data?.error, "handler exploded");
});

await test("escalate does not throw when referencing an unregistered handler name", async () => {
  const { escalations } = setup();
  await assert.doesNotReject(() =>
    escalations.escalate({
      instanceId: "wfi-1",
      stepId: "step-1",
      reason: "retryExhausted",
      handler: "doesNotExist",
      context: {},
    })
  );
});

await test("escalate records escalation.handlerFailed for an unregistered handler name", async () => {
  const { audit, escalations } = setup();
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "retryExhausted",
    handler: "doesNotExist",
    context: {},
  });
  const types = audit.entriesFor("wfi-1").map((e) => e.type);
  assert.deepEqual(types, ["escalation.triggered", "escalation.handlerFailed"]);
});

await test("escalate audit entries carry the escalation reason", async () => {
  const { audit, escalations } = setup();
  await escalations.escalate({
    instanceId: "wfi-1",
    stepId: "step-1",
    reason: "approvalTimeout",
    context: {},
  });
  const entry = audit.entriesFor("wfi-1")[0];
  assert.equal(entry.data?.reason, "approvalTimeout");
});

console.log(`\nEscalationManager tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
