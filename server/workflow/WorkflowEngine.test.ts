import assert from "node:assert/strict";
import { WorkflowEngine } from "./WorkflowEngine.ts";
import { ActionHandlerRegistry } from "./ActionHandlerRegistry.ts";
import { AuditLog } from "./AuditLog.ts";
import { ManualClock } from "./Clock.ts";
import { WorkflowDefinitionError } from "./errors.ts";
import type { WorkflowDefinition } from "./types.ts";

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

function setup(random: () => number = () => 0.5) {
  const clock = new ManualClock(0);
  const audit = new AuditLog(clock);
  const actions = new ActionHandlerRegistry();
  const engine = new WorkflowEngine({ clock, audit, actions, random });
  return { clock, audit, actions, engine };
}

// --- Definition validation ---

await test("validateDefinition throws on a duplicate step id", () => {
  const definition: WorkflowDefinition = {
    id: "wf-1",
    name: "dup",
    version: 1,
    startStepId: "a",
    steps: [
      { id: "a", type: "trigger", event: "go", next: null },
      { id: "a", type: "trigger", event: "go", next: null },
    ],
  };
  assert.throws(() => WorkflowEngine.validateDefinition(definition), WorkflowDefinitionError);
});

await test("validateDefinition throws when startStepId is not defined", () => {
  const definition: WorkflowDefinition = {
    id: "wf-1",
    name: "bad-start",
    version: 1,
    startStepId: "missing",
    steps: [{ id: "a", type: "trigger", event: "go", next: null }],
  };
  assert.throws(() => WorkflowEngine.validateDefinition(definition), WorkflowDefinitionError);
});

await test("validateDefinition throws when a step references an unknown next id", () => {
  const definition: WorkflowDefinition = {
    id: "wf-1",
    name: "dangling",
    version: 1,
    startStepId: "a",
    steps: [{ id: "a", type: "trigger", event: "go", next: "ghost" }],
  };
  assert.throws(() => WorkflowEngine.validateDefinition(definition), WorkflowDefinitionError);
});

await test("validateDefinition accepts a well-formed single-step definition", () => {
  const definition: WorkflowDefinition = {
    id: "wf-1",
    name: "ok",
    version: 1,
    startStepId: "a",
    steps: [{ id: "a", type: "trigger", event: "go", next: null }],
  };
  assert.doesNotThrow(() => WorkflowEngine.validateDefinition(definition));
});

await test("start throws a WorkflowDefinitionError for an invalid definition before creating an instance", async () => {
  const { engine } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-1",
    name: "bad",
    version: 1,
    startStepId: "missing",
    steps: [],
  };
  await assert.rejects(() => engine.start(definition), WorkflowDefinitionError);
});

// --- Trigger + linear completion ---

await test("a trigger-only workflow completes immediately", async () => {
  const { engine } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-trigger",
    name: "trigger only",
    version: 1,
    startStepId: "start",
    steps: [{ id: "start", type: "trigger", event: "order.created", next: null }],
  };
  const instance = await engine.start(definition);
  assert.equal(instance.status, "completed");
});

await test("workflow.started and workflow.completed are recorded in the audit trail", async () => {
  const { engine, audit } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-trigger",
    name: "trigger only",
    version: 1,
    startStepId: "start",
    steps: [{ id: "start", type: "trigger", event: "order.created", next: null }],
  };
  const instance = await engine.start(definition);
  const types = audit.entriesFor(instance.id).map((e) => e.type);
  assert.equal(types[0], "workflow.started");
  assert.equal(types[types.length - 1], "workflow.completed");
});

await test("history records every step id visited in order", async () => {
  const { engine } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-chain",
    name: "chain",
    version: 1,
    startStepId: "a",
    steps: [
      { id: "a", type: "trigger", event: "go", next: "b" },
      { id: "b", type: "trigger", event: "go", next: null },
    ],
  };
  const instance = await engine.start(definition);
  assert.deepEqual(instance.history, ["a", "b"]);
});

await test("start seeds the instance context from the caller-supplied context", async () => {
  const { engine } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-ctx",
    name: "ctx",
    version: 1,
    startStepId: "a",
    steps: [{ id: "a", type: "trigger", event: "go", next: null }],
  };
  const instance = await engine.start(definition, { orderId: "o-1" });
  assert.equal(instance.context.orderId, "o-1");
});

await test("start assigns a generated instance id when none is supplied", async () => {
  const { engine } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-id",
    name: "id",
    version: 1,
    startStepId: "a",
    steps: [{ id: "a", type: "trigger", event: "go", next: null }],
  };
  const instance = await engine.start(definition);
  assert.equal(typeof instance.id, "string");
  assert.ok(instance.id.length > 0);
});

await test("start honors a caller-supplied instance id", async () => {
  const { engine } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-id",
    name: "id",
    version: 1,
    startStepId: "a",
    steps: [{ id: "a", type: "trigger", event: "go", next: null }],
  };
  const instance = await engine.start(definition, {}, "custom-id");
  assert.equal(instance.id, "custom-id");
});

// --- Condition branching ---

function branchingDefinition(): WorkflowDefinition {
  return {
    id: "wf-branch",
    name: "branch",
    version: 1,
    startStepId: "check",
    steps: [
      {
        id: "check",
        type: "condition",
        expression: { op: "gt", field: "amount", value: 1_000 },
        onTrue: "highValue",
        onFalse: "lowValue",
      },
      { id: "highValue", type: "trigger", event: "noop", next: null },
      { id: "lowValue", type: "trigger", event: "noop", next: null },
    ],
  };
}

await test("condition step routes to onTrue when the expression is true", async () => {
  const { engine } = setup();
  const instance = await engine.start(branchingDefinition(), { amount: 5_000 });
  assert.deepEqual(instance.history, ["check", "highValue"]);
});

await test("condition step routes to onFalse when the expression is false", async () => {
  const { engine } = setup();
  const instance = await engine.start(branchingDefinition(), { amount: 10 });
  assert.deepEqual(instance.history, ["check", "lowValue"]);
});

await test("condition step falls back to next when onTrue is absent and the result is true", async () => {
  const { engine } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-fallback",
    name: "fallback",
    version: 1,
    startStepId: "check",
    steps: [
      {
        id: "check",
        type: "condition",
        expression: { op: "eq", field: "x", value: 1 },
        next: "fallthrough",
      },
      { id: "fallthrough", type: "trigger", event: "noop", next: null },
    ],
  };
  const instance = await engine.start(definition, { x: 1 });
  assert.deepEqual(instance.history, ["check", "fallthrough"]);
});

await test("condition.evaluated audit entry records the boolean result", async () => {
  const { engine, audit } = setup();
  const instance = await engine.start(branchingDefinition(), { amount: 5_000 });
  const entry = audit.entriesFor(instance.id).find((e) => e.type === "condition.evaluated");
  assert.equal(entry?.data?.result, true);
});

// --- Action success ---

await test("a successful action stores its result under instance.results", async () => {
  const { engine, actions } = setup();
  actions.register("charge", () => ({ chargeId: "ch-1" }));
  const definition: WorkflowDefinition = {
    id: "wf-action",
    name: "action",
    version: 1,
    startStepId: "charge",
    steps: [{ id: "charge", type: "action", handler: "charge", next: null }],
  };
  const instance = await engine.start(definition);
  assert.deepEqual(instance.results.charge, { chargeId: "ch-1" });
  assert.equal(instance.status, "completed");
});

await test("an action handler receives the instance context plus prior results", async () => {
  const { engine, actions } = setup();
  let seen: any;
  actions.register("first", () => "first-result");
  actions.register("second", (_input, context) => {
    seen = context;
    return "second-result";
  });
  const definition: WorkflowDefinition = {
    id: "wf-scope",
    name: "scope",
    version: 1,
    startStepId: "first",
    steps: [
      { id: "first", type: "action", handler: "first", next: "second" },
      { id: "second", type: "action", handler: "second", next: null },
    ],
  };
  await engine.start(definition, { customerId: "c-1" });
  assert.equal(seen.customerId, "c-1");
  assert.equal(seen.results.first, "first-result");
});

await test("an action step passes its configured input to the handler", async () => {
  const { engine, actions } = setup();
  let receivedInput: unknown;
  actions.register("sendEmail", (input) => {
    receivedInput = input;
  });
  const definition: WorkflowDefinition = {
    id: "wf-input",
    name: "input",
    version: 1,
    startStepId: "send",
    steps: [{ id: "send", type: "action", handler: "sendEmail", input: { to: "a@b.com" }, next: null }],
  };
  await engine.start(definition);
  assert.deepEqual(receivedInput, { to: "a@b.com" });
});

// --- Retry ---

await test("a failing action with no retry policy and no onFailure fails the workflow", async () => {
  const { engine } = setup();
  const { actions } = setup();
  const registry = new ActionHandlerRegistry();
  registry.register("flaky", () => {
    throw new Error("boom");
  });
  const clock = new ManualClock(0);
  const audit = new AuditLog(clock);
  const eng = new WorkflowEngine({ clock, audit, actions: registry });
  const definition: WorkflowDefinition = {
    id: "wf-fail",
    name: "fail",
    version: 1,
    startStepId: "flaky",
    steps: [{ id: "flaky", type: "action", handler: "flaky", next: null }],
  };
  const instance = await eng.start(definition);
  assert.equal(instance.status, "failed");
  assert.equal(instance.failureReason, "boom");
});

await test("a failing action with onFailure routes to the failure step instead of failing the workflow", async () => {
  const clock = new ManualClock(0);
  const audit = new AuditLog(clock);
  const registry = new ActionHandlerRegistry();
  registry.register("flaky", () => {
    throw new Error("boom");
  });
  const eng = new WorkflowEngine({ clock, audit, actions: registry });
  const definition: WorkflowDefinition = {
    id: "wf-onfail",
    name: "onfail",
    version: 1,
    startStepId: "flaky",
    steps: [
      { id: "flaky", type: "action", handler: "flaky", next: null, onFailure: "cleanup" },
      { id: "cleanup", type: "trigger", event: "noop", next: null },
    ],
  };
  const instance = await eng.start(definition);
  assert.equal(instance.status, "completed");
  assert.deepEqual(instance.history, ["flaky", "cleanup"]);
});

await test("a failing action schedules a retry instead of failing when attempts remain", async () => {
  const { engine, actions } = setup();
  let calls = 0;
  actions.register("flaky", () => {
    calls += 1;
    throw new Error("still down");
  });
  const definition: WorkflowDefinition = {
    id: "wf-retry",
    name: "retry",
    version: 1,
    startStepId: "flaky",
    steps: [
      {
        id: "flaky",
        type: "action",
        handler: "flaky",
        next: null,
        retry: { maxAttempts: 3, backoff: "fixed", baseDelayMs: 100 },
      },
    ],
  };
  const instance = await engine.start(definition);
  assert.equal(instance.status, "waiting");
  assert.equal(instance.pendingRetry?.attempt, 1);
  assert.equal(calls, 1);
});

await test("tick before the retry delay elapses leaves the instance waiting", async () => {
  const { engine, actions, clock } = setup();
  actions.register("flaky", () => {
    throw new Error("still down");
  });
  const definition: WorkflowDefinition = {
    id: "wf-retry-tick",
    name: "retry tick",
    version: 1,
    startStepId: "flaky",
    steps: [
      {
        id: "flaky",
        type: "action",
        handler: "flaky",
        next: null,
        retry: { maxAttempts: 3, backoff: "fixed", baseDelayMs: 100 },
      },
    ],
  };
  let instance = await engine.start(definition);
  clock.advance(50);
  instance = await engine.tick(instance, definition);
  assert.equal(instance.status, "waiting");
});

await test("tick after the retry delay elapses retries the action", async () => {
  const { engine, actions, clock } = setup();
  let calls = 0;
  actions.register("flaky", () => {
    calls += 1;
    if (calls < 2) throw new Error("still down");
    return "recovered";
  });
  const definition: WorkflowDefinition = {
    id: "wf-retry-success",
    name: "retry success",
    version: 1,
    startStepId: "flaky",
    steps: [
      {
        id: "flaky",
        type: "action",
        handler: "flaky",
        next: null,
        retry: { maxAttempts: 3, backoff: "fixed", baseDelayMs: 100 },
      },
    ],
  };
  let instance = await engine.start(definition);
  clock.advance(100);
  instance = await engine.tick(instance, definition);
  assert.equal(instance.status, "completed");
  assert.equal(instance.results.flaky, "recovered");
  assert.equal(calls, 2);
});

await test("retry attempts stop once maxAttempts is exhausted, then escalate/fail", async () => {
  const { engine, actions, clock } = setup();
  let calls = 0;
  actions.register("alwaysFails", () => {
    calls += 1;
    throw new Error("nope");
  });
  const definition: WorkflowDefinition = {
    id: "wf-exhaust",
    name: "exhaust",
    version: 1,
    startStepId: "alwaysFails",
    steps: [
      {
        id: "alwaysFails",
        type: "action",
        handler: "alwaysFails",
        next: null,
        retry: { maxAttempts: 2, backoff: "fixed", baseDelayMs: 10 },
      },
    ],
  };
  let instance = await engine.start(definition);
  assert.equal(instance.status, "waiting");
  clock.advance(10);
  instance = await engine.tick(instance, definition);
  assert.equal(instance.status, "failed");
  assert.equal(calls, 2);
});

await test("retryExhausted triggers escalation with the configured handler", async () => {
  const { engine, actions, clock, audit } = setup();
  actions.register("alwaysFails", () => {
    throw new Error("nope");
  });
  let escalated = false;
  actions.register("pageOncall", () => {
    escalated = true;
  });
  const definition: WorkflowDefinition = {
    id: "wf-escalate",
    name: "escalate",
    version: 1,
    startStepId: "alwaysFails",
    steps: [
      {
        id: "alwaysFails",
        type: "action",
        handler: "alwaysFails",
        next: null,
        retry: { maxAttempts: 1, backoff: "fixed", baseDelayMs: 10 },
        escalationHandler: "pageOncall",
      },
    ],
  };
  const instance = await engine.start(definition);
  assert.equal(instance.status, "failed");
  assert.equal(escalated, true);
  assert.equal(
    audit.entriesFor(instance.id).some((e) => e.type === "escalation.triggered"),
    true
  );
});

// --- Approval ---

function approvalDefinition(overrides: Partial<import("./types.ts").ApprovalStep> = {}): WorkflowDefinition {
  return {
    id: "wf-approval",
    name: "approval",
    version: 1,
    startStepId: "review",
    steps: [
      {
        id: "review",
        type: "approval",
        approvers: ["alice", "bob"],
        next: "approved",
        onRejected: "rejected",
        ...overrides,
      },
      { id: "approved", type: "trigger", event: "noop", next: null },
      { id: "rejected", type: "trigger", event: "noop", next: null },
    ],
  };
}

await test("an approval step puts the instance into a waiting state", async () => {
  const { engine } = setup();
  const instance = await engine.start(approvalDefinition());
  assert.equal(instance.status, "waiting");
  assert.equal(instance.pendingApproval?.stepId, "review");
});

await test("decide with a single deciding vote reaching quorum resumes the workflow", async () => {
  const { engine } = setup();
  let instance = await engine.start(approvalDefinition({ quorum: 1 }));
  instance = await engine.decide(instance, approvalDefinition({ quorum: 1 }), "alice", "approved");
  assert.equal(instance.status, "completed");
  assert.deepEqual(instance.history, ["review", "approved"]);
});

await test("decide requires quorum before advancing past the approval step", async () => {
  const { engine } = setup();
  const definition = approvalDefinition();
  let instance = await engine.start(definition);
  instance = await engine.decide(instance, definition, "alice", "approved");
  assert.equal(instance.status, "waiting");
  instance = await engine.decide(instance, definition, "bob", "approved");
  assert.equal(instance.status, "completed");
});

await test("decide routes to onRejected when the approval is rejected", async () => {
  const { engine } = setup();
  const definition = approvalDefinition({ approvers: ["alice"], quorum: 1 });
  let instance = await engine.start(definition);
  instance = await engine.decide(instance, definition, "alice", "rejected");
  assert.equal(instance.status, "completed");
  assert.deepEqual(instance.history, ["review", "rejected"]);
});

await test("decide throws when there is no pending approval on the instance", async () => {
  const { engine } = setup();
  const definition: WorkflowDefinition = {
    id: "wf-noapproval",
    name: "no approval",
    version: 1,
    startStepId: "a",
    steps: [{ id: "a", type: "trigger", event: "go", next: null }],
  };
  const instance = await engine.start(definition);
  await assert.rejects(() => engine.decide(instance, definition, "alice", "approved"));
});

await test("decide clears pendingApproval once the vote resolves the step", async () => {
  const { engine } = setup();
  const definition = approvalDefinition({ quorum: 1 });
  let instance = await engine.start(definition);
  instance = await engine.decide(instance, definition, "alice", "approved");
  assert.equal(instance.pendingApproval, undefined);
});

await test("approvalRejected escalation invokes the configured escalation handler", async () => {
  const { engine, actions } = setup();
  let escalated = false;
  actions.register("notifyRejection", () => {
    escalated = true;
  });
  const definition = approvalDefinition({
    approvers: ["alice"],
    quorum: 1,
    escalationHandler: "notifyRejection",
  });
  let instance = await engine.start(definition);
  instance = await engine.decide(instance, definition, "alice", "rejected");
  assert.equal(escalated, true);
});

// --- Approval timeout via tick ---

await test("tick before the approval timeout elapses leaves the instance waiting", async () => {
  const { engine, clock } = setup();
  const definition = approvalDefinition({ timeoutMs: 1_000, onTimeout: "rejected" });
  let instance = await engine.start(definition);
  clock.advance(500);
  instance = await engine.tick(instance, definition);
  assert.equal(instance.status, "waiting");
});

await test("tick after the approval timeout elapses escalates and routes to onTimeout", async () => {
  const { engine, clock, audit } = setup();
  const definition = approvalDefinition({ timeoutMs: 1_000, onTimeout: "rejected" });
  let instance = await engine.start(definition);
  clock.advance(1_000);
  instance = await engine.tick(instance, definition);
  assert.equal(instance.status, "completed");
  assert.deepEqual(instance.history, ["review", "rejected"]);
  assert.equal(
    audit.entriesFor(instance.id).some((e) => e.type === "approval.timedOut"),
    true
  );
});

await test("a timed-out approval with no onTimeout target completes the workflow at a dead end", async () => {
  const { engine, clock } = setup();
  const definition = approvalDefinition({ timeoutMs: 1_000, onTimeout: null });
  let instance = await engine.start(definition);
  clock.advance(2_000);
  instance = await engine.tick(instance, definition);
  assert.equal(instance.status, "completed");
  assert.equal(instance.currentStepId, null);
});

// --- Delay ---

function delayDefinition(): WorkflowDefinition {
  return {
    id: "wf-delay",
    name: "delay",
    version: 1,
    startStepId: "wait",
    steps: [
      { id: "wait", type: "delay", durationMs: 1_000, next: "after" },
      { id: "after", type: "trigger", event: "noop", next: null },
    ],
  };
}

await test("a delay step puts the instance into a waiting state with a pendingDelay", async () => {
  const { engine } = setup();
  const instance = await engine.start(delayDefinition());
  assert.equal(instance.status, "waiting");
  assert.equal(instance.pendingDelay?.stepId, "wait");
});

await test("tick before the delay elapses leaves the instance waiting", async () => {
  const { engine, clock } = setup();
  let instance = await engine.start(delayDefinition());
  clock.advance(500);
  instance = await engine.tick(instance, delayDefinition());
  assert.equal(instance.status, "waiting");
});

await test("tick after the delay elapses resumes the workflow past the delay step", async () => {
  const { engine, clock } = setup();
  const definition = delayDefinition();
  let instance = await engine.start(definition);
  clock.advance(1_000);
  instance = await engine.tick(instance, definition);
  assert.equal(instance.status, "completed");
  assert.deepEqual(instance.history, ["wait", "after"]);
});

await test("tick on an already-completed instance is a no-op", async () => {
  const { engine, clock } = setup();
  const definition = delayDefinition();
  let instance = await engine.start(definition);
  clock.advance(1_000);
  instance = await engine.tick(instance, definition);
  const again = await engine.tick(instance, definition);
  assert.equal(again, instance);
});

// --- Audit trail for a full multi-primitive workflow ---

await test("a full trigger -> condition -> action -> approval -> delay chain produces a coherent audit trail", async () => {
  const { engine, actions, clock, audit } = setup();
  actions.register("charge", () => "charged");
  const definition: WorkflowDefinition = {
    id: "wf-full",
    name: "full",
    version: 1,
    startStepId: "trig",
    steps: [
      { id: "trig", type: "trigger", event: "order.created", next: "check" },
      {
        id: "check",
        type: "condition",
        expression: { op: "gt", field: "amount", value: 100 },
        onTrue: "charge",
        onFalse: null,
      },
      { id: "charge", type: "action", handler: "charge", next: "review" },
      { id: "review", type: "approval", approvers: ["alice"], next: "wait" },
      { id: "wait", type: "delay", durationMs: 1_000, next: null },
    ],
  };
  let instance = await engine.start(definition, { amount: 500 });
  assert.equal(instance.status, "waiting");
  assert.ok(instance.pendingApproval);
  instance = await engine.decide(instance, definition, "alice", "approved");
  assert.equal(instance.status, "waiting");
  assert.ok(instance.pendingDelay);
  clock.advance(1_000);
  instance = await engine.tick(instance, definition);
  assert.equal(instance.status, "completed");
  assert.deepEqual(instance.history, ["trig", "check", "charge", "review", "wait"]);

  const types = audit.entriesFor(instance.id).map((e) => e.type);
  assert.deepEqual(types, [
    "workflow.started",
    "trigger.fired",
    "condition.evaluated",
    "action.succeeded",
    "approval.requested",
    "approval.voted",
    "delay.scheduled",
    "delay.resumed",
    "workflow.completed",
  ]);
});

// --- Runaway cycle guard ---

await test("an unguarded synchronous cycle throws instead of hanging forever", async () => {
  const clock = new ManualClock(0);
  const audit = new AuditLog(clock);
  const actions = new ActionHandlerRegistry();
  const engine = new WorkflowEngine({ clock, audit, actions, maxStepsPerRun: 50 });
  const definition: WorkflowDefinition = {
    id: "wf-cycle",
    name: "cycle",
    version: 1,
    startStepId: "a",
    steps: [
      { id: "a", type: "trigger", event: "go", next: "b" },
      { id: "b", type: "trigger", event: "go", next: "a" },
    ],
  };
  await assert.rejects(() => engine.start(definition));
});

console.log(`\nWorkflowEngine tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
