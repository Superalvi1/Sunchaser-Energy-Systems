import assert from "node:assert/strict";
import { createKnowledgeChunk } from "./KnowledgeChunk.ts";
import { createKnowledgeDocument } from "./KnowledgeDocument.ts";
import {
  createStubKnowledgeIndexer,
  KNOWLEDGE_INDEXER_NOT_IMPLEMENTED_MESSAGE,
  STUB_KNOWLEDGE_INDEXER,
} from "./KnowledgeIndexer.ts";
import {
  createStubKnowledgeSearch,
  normalizeKnowledgeSearchQuery,
  STUB_KNOWLEDGE_SEARCH,
} from "./KnowledgeSearch.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const doc = createKnowledgeDocument({
  id: "doc-1",
  title: "Manual",
  collection: "Engineering",
  owner: "u1",
  visibility: "company",
  department: "Eng",
  companyId: "c1",
  tags: [],
  mimeType: "application/pdf",
  checksum: "x",
  language: "en",
  source: "upload",
  status: "active",
});

const chunk = createKnowledgeChunk({
  id: "chunk-1",
  documentId: "doc-1",
  sequence: 0,
  contentRef: "",
  byteOffset: 0,
  byteLength: 512,
  checksum: "c1",
});

check("STUB_KNOWLEDGE_INDEXER returns not_implemented status", STUB_KNOWLEDGE_INDEXER.index(doc, [chunk], "actor-1").status === "not_implemented");
check("stub indexer message is deterministic", STUB_KNOWLEDGE_INDEXER.index(doc, [chunk], "actor-1").message === KNOWLEDGE_INDEXER_NOT_IMPLEMENTED_MESSAGE);
check("stub indexer reports chunk count", STUB_KNOWLEDGE_INDEXER.index(doc, [chunk, chunk], "actor-1").chunkCount === 2);
check("stub indexer assigns sequential job ids", (() => {
  const indexer = createStubKnowledgeIndexer();
  const j1 = indexer.index(doc, [], "a");
  const j2 = indexer.index(doc, [], "a");
  return j1.jobId === "kidx-1" && j2.jobId === "kidx-2";
})());

check("STUB_KNOWLEDGE_SEARCH returns empty hits", STUB_KNOWLEDGE_SEARCH.search({ query: "solar panel", companyId: "c1", actorId: "a1" }).hits.length === 0);
check("stub search status is not_implemented", STUB_KNOWLEDGE_SEARCH.search({ query: "test", companyId: "c1", actorId: "a1" }).status === "not_implemented");
check("stub search total is zero", STUB_KNOWLEDGE_SEARCH.search({ query: "test", companyId: "c1", actorId: "a1" }).total === 0);
check("stub search preserves query string", STUB_KNOWLEDGE_SEARCH.search({ query: "  invoice  ", companyId: "c1", actorId: "a1" }).query === "  invoice  ");

check(
  "normalizeKnowledgeSearchQuery trims fields",
  (() => {
    const q = normalizeKnowledgeSearchQuery({ query: "  hello ", companyId: " c1 ", actorId: " a1 ", limit: 3.7 });
    return q.query === "hello" && q.companyId === "c1" && q.actorId === "a1" && q.limit === 3;
  })()
);

check(
  "normalizeKnowledgeSearchQuery floors negative limit to zero",
  normalizeKnowledgeSearchQuery({ query: "x", companyId: "c", actorId: "a", limit: -5 }).limit === 0
);

check(
  "stub indexer is deterministic across identical calls",
  (() => {
    const indexer = createStubKnowledgeIndexer();
    const a = indexer.index(doc, [chunk], "actor-1");
    const b = indexer.index(doc, [chunk], "actor-1");
    return a.status === b.status && a.message === b.message && a.chunkCount === b.chunkCount;
  })()
);

check(
  "stub search is deterministic across identical calls",
  (() => {
    const search = createStubKnowledgeSearch();
    const q = { query: "warranty", companyId: "c1", actorId: "a1" };
    return JSON.stringify(search.search(q)) === JSON.stringify(search.search(q));
  })()
);

console.log(`\nKnowledgeArchitecture tests: ${pass} passed`);
