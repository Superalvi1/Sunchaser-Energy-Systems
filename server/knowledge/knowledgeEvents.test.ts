import assert from "node:assert/strict";
import { createKnowledgeDocument } from "./KnowledgeDocument.ts";
import {
  createKnowledgeEvent,
  isKnowledgeEventType,
  knowledgeEventForDocumentCreated,
  knowledgeEventForIndexRequested,
  sortKnowledgeEventsDesc,
} from "./KnowledgeEvents.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const doc = createKnowledgeDocument({
  id: "doc-1",
  title: "T",
  collection: "General",
  owner: "u1",
  visibility: "company",
  department: "Ops",
  companyId: "c1",
  tags: [],
  mimeType: "application/pdf",
  checksum: "x",
  language: "en",
  source: "upload",
  status: "active",
});

check("isKnowledgeEventType accepts document.created", isKnowledgeEventType("document.created"));
check("isKnowledgeEventType accepts search.requested", isKnowledgeEventType("search.requested"));
check("isKnowledgeEventType rejects unknown", !isKnowledgeEventType("unknown.event"));

check(
  "knowledgeEventForDocumentCreated sets correct type and documentId",
  (() => {
    const evt = knowledgeEventForDocumentCreated("evt-1", doc, "actor-1");
    return evt.type === "document.created" && evt.documentId === "doc-1" && evt.actorId === "actor-1";
  })()
);

check(
  "knowledgeEventForIndexRequested marks not implemented in payload",
  (() => {
    const evt = knowledgeEventForIndexRequested("evt-2", "doc-1", "actor-1", "c1");
    return evt.type === "index.requested" && evt.payload.implemented === false;
  })()
);

check(
  "createKnowledgeEvent uses deterministic timestamp when omitted",
  createKnowledgeEvent({
    id: "e1",
    type: "document.updated",
    documentId: "d1",
    actorId: "a1",
    companyId: "c1",
    payload: {},
  }).occurredAt === "1970-01-01T00:00:00.000Z"
);

check(
  "sortKnowledgeEventsDesc orders by occurredAt descending",
  (() => {
    const sorted = sortKnowledgeEventsDesc([
      createKnowledgeEvent({ id: "a", type: "document.created", documentId: "d", actorId: "a", companyId: "c", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" }),
      createKnowledgeEvent({ id: "b", type: "document.created", documentId: "d", actorId: "a", companyId: "c", payload: {}, occurredAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    return sorted[0].id === "b";
  })()
);

check(
  "sortKnowledgeEventsDesc breaks ties by id ascending",
  (() => {
    const sorted = sortKnowledgeEventsDesc([
      createKnowledgeEvent({ id: "b", type: "document.created", documentId: "d", actorId: "a", companyId: "c", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" }),
      createKnowledgeEvent({ id: "a", type: "document.created", documentId: "d", actorId: "a", companyId: "c", payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    return sorted[0].id === "a";
  })()
);

console.log(`\nKnowledgeEvents tests: ${pass} passed`);
