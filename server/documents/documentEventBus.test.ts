import assert from "node:assert/strict";
import {
  createDocumentPipelineEvent,
  createInMemoryDocumentEventBus,
  DOCUMENT_PIPELINE_EVENT_TYPES,
  InMemoryDocumentEventBus,
  isDocumentPipelineEventType,
} from "./DocumentEventBus.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function evt(overrides: Partial<Parameters<typeof createDocumentPipelineEvent>[0]> = {}) {
  return createDocumentPipelineEvent({
    id: "e1",
    type: "pipeline.upload_received",
    familyId: "f1",
    actorId: "user-1",
    companyId: "co1",
    payload: {},
    ...overrides,
  });
}

check("DOCUMENT_PIPELINE_EVENT_TYPES has 12 event types", DOCUMENT_PIPELINE_EVENT_TYPES.length === 12);
check("isDocumentPipelineEventType accepts valid type", isDocumentPipelineEventType("pipeline.completed"));
check("isDocumentPipelineEventType rejects unknown type", !isDocumentPipelineEventType("pipeline.unknown"));

check("createDocumentPipelineEvent trims id", createDocumentPipelineEvent({ id: " e1 ", type: "pipeline.completed", familyId: "f1", actorId: "a1", companyId: "co1", payload: {} }).id === "e1");
check("createDocumentPipelineEvent defaults occurredAt", evt().occurredAt === "1970-01-01T00:00:00.000Z");
check("createDocumentPipelineEvent accepts explicit occurredAt", evt({ occurredAt: "2026-01-01T00:00:00.000Z" }).occurredAt === "2026-01-01T00:00:00.000Z");
check("createDocumentPipelineEvent copies payload (not by reference)", (() => {
  const payload = { a: 1 };
  const e = evt({ payload });
  payload.a = 2;
  return e.payload.a === 1;
})());

check("createInMemoryDocumentEventBus returns an InMemoryDocumentEventBus", createInMemoryDocumentEventBus() instanceof InMemoryDocumentEventBus);
check("new bus has empty history", createInMemoryDocumentEventBus().history().length === 0);
check("new bus has zero subscribers for any type", createInMemoryDocumentEventBus().subscriberCount("pipeline.completed") === 0);

check("publish adds the event to history", (() => {
  const bus = createInMemoryDocumentEventBus();
  bus.publish(evt());
  return bus.history().length === 1;
})());

check("subscribe increases subscriberCount", (() => {
  const bus = createInMemoryDocumentEventBus();
  bus.subscribe("pipeline.completed", () => {});
  return bus.subscriberCount("pipeline.completed") === 1;
})());

check("typed subscriber receives matching event", (() => {
  const bus = createInMemoryDocumentEventBus();
  let received = false;
  bus.subscribe("pipeline.completed", () => {
    received = true;
  });
  bus.publish(evt({ type: "pipeline.completed" }));
  return received;
})());

check("typed subscriber does not receive non-matching event", (() => {
  const bus = createInMemoryDocumentEventBus();
  let received = false;
  bus.subscribe("pipeline.completed", () => {
    received = true;
  });
  bus.publish(evt({ type: "pipeline.failed" }));
  return !received;
})());

check("subscribeAll receives every event type", (() => {
  const bus = createInMemoryDocumentEventBus();
  let count = 0;
  bus.subscribeAll(() => {
    count += 1;
  });
  bus.publish(evt({ type: "pipeline.completed" }));
  bus.publish(evt({ type: "pipeline.failed" }));
  return count === 2;
})());

check("publish delivers to both typed and wildcard subscribers", (() => {
  const bus = createInMemoryDocumentEventBus();
  let typedCount = 0;
  let wildcardCount = 0;
  bus.subscribe("pipeline.completed", () => {
    typedCount += 1;
  });
  bus.subscribeAll(() => {
    wildcardCount += 1;
  });
  bus.publish(evt({ type: "pipeline.completed" }));
  return typedCount === 1 && wildcardCount === 1;
})());

check("unsubscribe (typed) stops further delivery", (() => {
  const bus = createInMemoryDocumentEventBus();
  let count = 0;
  const unsubscribe = bus.subscribe("pipeline.completed", () => {
    count += 1;
  });
  bus.publish(evt({ type: "pipeline.completed" }));
  unsubscribe();
  bus.publish(evt({ id: "e2", type: "pipeline.completed" }));
  return count === 1;
})());

check("unsubscribe (wildcard) stops further delivery", (() => {
  const bus = createInMemoryDocumentEventBus();
  let count = 0;
  const unsubscribe = bus.subscribeAll(() => {
    count += 1;
  });
  bus.publish(evt());
  unsubscribe();
  bus.publish(evt({ id: "e2" }));
  return count === 1;
})());

check("a throwing subscriber does not stop delivery to remaining subscribers", (() => {
  const bus = createInMemoryDocumentEventBus();
  let secondCalled = false;
  bus.subscribe("pipeline.completed", () => {
    throw new Error("boom");
  });
  bus.subscribe("pipeline.completed", () => {
    secondCalled = true;
  });
  bus.publish(evt({ type: "pipeline.completed" }));
  return secondCalled;
})());

check("publish never throws even when a subscriber throws", (() => {
  const bus = createInMemoryDocumentEventBus();
  bus.subscribe("pipeline.completed", () => {
    throw new Error("boom");
  });
  bus.publish(evt({ type: "pipeline.completed" }));
  return true;
})());

check("publish returns handler failures for throwing subscribers", (() => {
  const bus = createInMemoryDocumentEventBus();
  bus.subscribe("pipeline.completed", () => {
    throw new Error("boom");
  });
  const failures = bus.publish(evt({ type: "pipeline.completed" }));
  return failures.length === 1 && failures[0].error === "boom";
})());

check("publish returns empty failures array when no subscriber throws", (() => {
  const bus = createInMemoryDocumentEventBus();
  bus.subscribe("pipeline.completed", () => {});
  return bus.publish(evt({ type: "pipeline.completed" })).length === 0;
})());

check("history filters by familyId when provided", (() => {
  const bus = createInMemoryDocumentEventBus();
  bus.publish(evt({ id: "e1", familyId: "f1" }));
  bus.publish(evt({ id: "e2", familyId: "f2" }));
  return bus.history("f1").length === 1;
})());

check("history returns all events when familyId omitted", (() => {
  const bus = createInMemoryDocumentEventBus();
  bus.publish(evt({ id: "e1", familyId: "f1" }));
  bus.publish(evt({ id: "e2", familyId: "f2" }));
  return bus.history().length === 2;
})());

check("history is sorted deterministically by id", (() => {
  const bus = createInMemoryDocumentEventBus();
  bus.publish(evt({ id: "b" }));
  bus.publish(evt({ id: "a" }));
  const ids = bus.history().map((e) => e.id);
  return ids[0] === "a" && ids[1] === "b";
})());

check("multiple subscribers to the same type are all delivered to", (() => {
  const bus = createInMemoryDocumentEventBus();
  let count = 0;
  bus.subscribe("pipeline.completed", () => (count += 1));
  bus.subscribe("pipeline.completed", () => (count += 1));
  bus.subscribe("pipeline.completed", () => (count += 1));
  bus.publish(evt({ type: "pipeline.completed" }));
  return count === 3;
})());

console.log(`\nDocumentEventBus tests: ${pass} passed`);
