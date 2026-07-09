import assert from "node:assert/strict";
import { TriggerRegistry } from "./TriggerRegistry.ts";

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

await test("match returns nothing when no bindings are registered", () => {
  const registry = new TriggerRegistry();
  assert.deepEqual(registry.match("order.created", {}), []);
});

await test("register + match finds a binding for a matching event name", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  const matches = registry.match("order.created", {});
  assert.equal(matches.length, 1);
  assert.equal(matches[0].workflowId, "wf-1");
});

await test("match ignores bindings for a different event name", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  assert.deepEqual(registry.match("order.cancelled", {}), []);
});

await test("match returns every workflow bound to the same event", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  registry.register({ workflowId: "wf-2", event: "order.created" });
  const matches = registry.match("order.created", {});
  assert.deepEqual(
    matches.map((m) => m.workflowId).sort(),
    ["wf-1", "wf-2"]
  );
});

await test("register rejects a duplicate workflowId+event binding", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  assert.throws(() => registry.register({ workflowId: "wf-1", event: "order.created" }), RangeError);
});

await test("the same workflow can bind to multiple distinct events", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  registry.register({ workflowId: "wf-1", event: "order.cancelled" });
  assert.equal(registry.bindingsFor("wf-1").length, 2);
});

await test("a condition on a binding filters matches by payload", () => {
  const registry = new TriggerRegistry();
  registry.register({
    workflowId: "wf-1",
    event: "order.created",
    condition: { op: "gt", field: "amount", value: 1_000 },
  });
  assert.deepEqual(registry.match("order.created", { amount: 500 }), []);
  const matches = registry.match("order.created", { amount: 2_000 });
  assert.equal(matches.length, 1);
});

await test("a binding without a condition always matches on event name alone", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  const matches = registry.match("order.created", { anything: "goes" });
  assert.equal(matches.length, 1);
});

await test("multiple bindings on the same event can have independent conditions", () => {
  const registry = new TriggerRegistry();
  registry.register({
    workflowId: "wf-small",
    event: "order.created",
    condition: { op: "lt", field: "amount", value: 100 },
  });
  registry.register({
    workflowId: "wf-large",
    event: "order.created",
    condition: { op: "gte", field: "amount", value: 100 },
  });
  assert.deepEqual(
    registry.match("order.created", { amount: 50 }).map((m) => m.workflowId),
    ["wf-small"]
  );
  assert.deepEqual(
    registry.match("order.created", { amount: 500 }).map((m) => m.workflowId),
    ["wf-large"]
  );
});

await test("unregister removes only the targeted workflow+event binding", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  registry.register({ workflowId: "wf-1", event: "order.cancelled" });
  registry.unregister("wf-1", "order.created");
  assert.deepEqual(registry.match("order.created", {}), []);
  assert.equal(registry.match("order.cancelled", {}).length, 1);
});

await test("unregister on a binding that does not exist is a no-op", () => {
  const registry = new TriggerRegistry();
  assert.doesNotThrow(() => registry.unregister("wf-none", "nothing"));
});

await test("bindingsFor returns an empty array for a workflow with no bindings", () => {
  const registry = new TriggerRegistry();
  assert.deepEqual(registry.bindingsFor("wf-none"), []);
});

await test("clear removes every binding", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  registry.register({ workflowId: "wf-2", event: "order.cancelled" });
  registry.clear();
  assert.deepEqual(registry.match("order.created", {}), []);
  assert.deepEqual(registry.match("order.cancelled", {}), []);
});

await test("after unregistering, the same workflowId+event can be re-registered", () => {
  const registry = new TriggerRegistry();
  registry.register({ workflowId: "wf-1", event: "order.created" });
  registry.unregister("wf-1", "order.created");
  assert.doesNotThrow(() => registry.register({ workflowId: "wf-1", event: "order.created" }));
});

await test("match evaluates compound and/or conditions", () => {
  const registry = new TriggerRegistry();
  registry.register({
    workflowId: "wf-1",
    event: "order.created",
    condition: {
      op: "and",
      expressions: [
        { op: "eq", field: "region", value: "US" },
        { op: "gt", field: "amount", value: 100 },
      ],
    },
  });
  assert.equal(registry.match("order.created", { region: "US", amount: 50 }).length, 0);
  assert.equal(registry.match("order.created", { region: "EU", amount: 500 }).length, 0);
  assert.equal(registry.match("order.created", { region: "US", amount: 500 }).length, 1);
});

console.log(`\nTriggerRegistry tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
