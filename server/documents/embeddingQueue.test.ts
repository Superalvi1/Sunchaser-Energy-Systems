import assert from "node:assert/strict";
import {
  createStubEmbeddingQueue,
  EMBEDDING_QUEUE_NOT_IMPLEMENTED_MESSAGE,
  StubEmbeddingQueue,
} from "./EmbeddingQueue.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("createStubEmbeddingQueue returns a StubEmbeddingQueue", createStubEmbeddingQueue() instanceof StubEmbeddingQueue);
check("new queue has zero jobs", createStubEmbeddingQueue().jobCount() === 0);
check("enqueue returns status not_implemented", createStubEmbeddingQueue().enqueue("doc-1", "user-1").status === "not_implemented");
check("enqueue echoes the documentId", createStubEmbeddingQueue().enqueue("doc-1", "user-1").documentId === "doc-1");
check("enqueue returns the documented not_implemented message", createStubEmbeddingQueue().enqueue("doc-1", "user-1").message === EMBEDDING_QUEUE_NOT_IMPLEMENTED_MESSAGE);
check("enqueue increments jobCount", (() => {
  const q = createStubEmbeddingQueue();
  q.enqueue("doc-1", "user-1");
  return q.jobCount() === 1;
})());
check("job ids are unique and sequential", (() => {
  const q = createStubEmbeddingQueue();
  const first = q.enqueue("doc-1", "user-1");
  const second = q.enqueue("doc-2", "user-1");
  return first.jobId === "emb-1" && second.jobId === "emb-2";
})());
check("distinct queue instances have independent counters", (() => {
  const q1 = createStubEmbeddingQueue();
  const q2 = createStubEmbeddingQueue();
  q1.enqueue("doc-1", "user-1");
  return q2.enqueue("doc-2", "user-1").jobId === "emb-1";
})());
check("enqueue never performs real embedding — status is always not_implemented regardless of document", createStubEmbeddingQueue().enqueue("any-doc", "any-user").status === "not_implemented");

console.log(`\nEmbeddingQueue tests: ${pass} passed`);
