import assert from "node:assert/strict";
import { createStubOcrQueue, OCR_QUEUE_NOT_IMPLEMENTED_MESSAGE, StubOcrQueue } from "./OcrQueue.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("createStubOcrQueue returns a StubOcrQueue", createStubOcrQueue() instanceof StubOcrQueue);
check("new queue has zero jobs", createStubOcrQueue().jobCount() === 0);
check("enqueue returns status not_implemented", createStubOcrQueue().enqueue("doc-1", "user-1").status === "not_implemented");
check("enqueue echoes the documentId", createStubOcrQueue().enqueue("doc-1", "user-1").documentId === "doc-1");
check("enqueue returns the documented not_implemented message", createStubOcrQueue().enqueue("doc-1", "user-1").message === OCR_QUEUE_NOT_IMPLEMENTED_MESSAGE);
check("enqueue increments jobCount", (() => {
  const q = createStubOcrQueue();
  q.enqueue("doc-1", "user-1");
  return q.jobCount() === 1;
})());
check("job ids are unique and sequential", (() => {
  const q = createStubOcrQueue();
  const first = q.enqueue("doc-1", "user-1");
  const second = q.enqueue("doc-2", "user-1");
  return first.jobId === "ocr-1" && second.jobId === "ocr-2";
})());
check("distinct queue instances have independent counters", (() => {
  const q1 = createStubOcrQueue();
  const q2 = createStubOcrQueue();
  q1.enqueue("doc-1", "user-1");
  return q2.enqueue("doc-2", "user-1").jobId === "ocr-1";
})());
check("enqueue never performs real OCR — status is always not_implemented regardless of document", createStubOcrQueue().enqueue("any-doc", "any-user").status === "not_implemented");

console.log(`\nOcrQueue tests: ${pass} passed`);
