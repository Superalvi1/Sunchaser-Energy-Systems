import assert from "node:assert/strict";
import { ActionHandlerRegistry } from "./ActionHandlerRegistry.ts";
import { UnknownActionHandlerError } from "./errors.ts";

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

await test("has returns false for an unregistered handler", () => {
  const registry = new ActionHandlerRegistry();
  assert.equal(registry.has("sendEmail"), false);
});

await test("register makes has return true", () => {
  const registry = new ActionHandlerRegistry();
  registry.register("sendEmail", () => "ok");
  assert.equal(registry.has("sendEmail"), true);
});

await test("invoke calls the registered handler with input and context", async () => {
  const registry = new ActionHandlerRegistry();
  let receivedInput: unknown;
  let receivedContext: unknown;
  registry.register("doThing", (input, context) => {
    receivedInput = input;
    receivedContext = context;
    return "done";
  });
  const result = await registry.invoke("doThing", { a: 1 }, { b: 2 });
  assert.equal(result, "done");
  assert.deepEqual(receivedInput, { a: 1 });
  assert.deepEqual(receivedContext, { b: 2 });
});

await test("invoke awaits async handlers and returns their resolved value", async () => {
  const registry = new ActionHandlerRegistry();
  registry.register("asyncThing", async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return `resolved:${String(input)}`;
  });
  const result = await registry.invoke("asyncThing", "x", {});
  assert.equal(result, "resolved:x");
});

await test("invoke throws UnknownActionHandlerError for an unregistered name", async () => {
  const registry = new ActionHandlerRegistry();
  await assert.rejects(() => registry.invoke("missing", {}, {}), UnknownActionHandlerError);
});

await test("invoke propagates a synchronous handler's thrown error", async () => {
  const registry = new ActionHandlerRegistry();
  registry.register("boom", () => {
    throw new Error("kaboom");
  });
  await assert.rejects(() => registry.invoke("boom", {}, {}), /kaboom/);
});

await test("invoke propagates a rejected async handler's error", async () => {
  const registry = new ActionHandlerRegistry();
  registry.register("boomAsync", async () => {
    throw new Error("async kaboom");
  });
  await assert.rejects(() => registry.invoke("boomAsync", {}, {}), /async kaboom/);
});

await test("register overwrites a previously registered handler with the same name", async () => {
  const registry = new ActionHandlerRegistry();
  registry.register("thing", () => "first");
  registry.register("thing", () => "second");
  assert.equal(await registry.invoke("thing", {}, {}), "second");
});

await test("unregister removes a handler", async () => {
  const registry = new ActionHandlerRegistry();
  registry.register("thing", () => "ok");
  registry.unregister("thing");
  assert.equal(registry.has("thing"), false);
  await assert.rejects(() => registry.invoke("thing", {}, {}), UnknownActionHandlerError);
});

await test("unregister on a name that was never registered is a no-op", () => {
  const registry = new ActionHandlerRegistry();
  assert.doesNotThrow(() => registry.unregister("nope"));
});

await test("names lists every registered handler name", () => {
  const registry = new ActionHandlerRegistry();
  registry.register("a", () => 1);
  registry.register("b", () => 2);
  assert.deepEqual(registry.names().sort(), ["a", "b"]);
});

await test("names returns an empty array for a fresh registry", () => {
  const registry = new ActionHandlerRegistry();
  assert.deepEqual(registry.names(), []);
});

console.log(`\nActionHandlerRegistry tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
