import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { createKnowledgeDocumentMetadata } from "./KnowledgeMetadata.ts";
import {
  buildKnowledgeDocumentInput,
  createInMemoryKnowledgeRepository,
} from "./KnowledgeRepository.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

function actor(overrides: Partial<RequestActor> = {}): RequestActor {
  return {
    id: "user-1",
    username: "alice",
    name: "Alice",
    email: "alice@test.com",
    role: "Admin",
    accountStatus: "Active",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

function metadata(documentId: string) {
  return createKnowledgeDocumentMetadata({ documentId, fileName: "test.pdf", fileSizeBytes: 100 });
}

check(
  "repository save and findById round-trip",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    const input = buildKnowledgeDocumentInput({ id: "doc-1", owner: "user-1" });
    repo.save(input, metadata("doc-1"), actor());
    return repo.findById("doc-1", actor())?.id === "doc-1";
  })()
);

check(
  "repository emits document.created event on first save",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    const result = repo.save(buildKnowledgeDocumentInput({ id: "doc-1" }), metadata("doc-1"), actor());
    return result.event.type === "document.created";
  })()
);

check(
  "repository emits document.updated event on second save",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    repo.save(buildKnowledgeDocumentInput({ id: "doc-1" }), metadata("doc-1"), actor());
    const result = repo.save(buildKnowledgeDocumentInput({ id: "doc-1", title: "Updated" }), metadata("doc-1"), actor());
    return result.event.type === "document.updated";
  })()
);

check(
  "findById returns null for missing document",
  createInMemoryKnowledgeRepository().findById("missing", actor()) === null
);

check(
  "findById returns null when permission denied",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    const input = buildKnowledgeDocumentInput({ id: "doc-private", owner: "user-1", visibility: "private", collection: "Finance" });
    repo.save(input, metadata("doc-private"), actor({ id: "user-1" }));
    return repo.findById("doc-private", actor({ id: "user-2", role: "Sales Executive" })) === null;
  })()
);

check(
  "listByCollection filters by collection and permission",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    repo.save(buildKnowledgeDocumentInput({ id: "s1", collection: "Sales" }), metadata("s1"), actor());
    repo.save(buildKnowledgeDocumentInput({ id: "f1", collection: "Finance" }), metadata("f1"), actor());
    const sales = repo.listByCollection("Sales", actor());
    return sales.length === 1 && sales[0].id === "s1";
  })()
);

check(
  "delete removes document and emits event",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    repo.save(buildKnowledgeDocumentInput({ id: "doc-del" }), metadata("doc-del"), actor());
    const result = repo.delete("doc-del", actor());
    return result.ok && repo.findById("doc-del", actor()) === null && repo.listEvents("doc-del").some((e) => e.type === "document.deleted");
  })()
);

check(
  "delete denied for non-owner non-admin",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    repo.save(buildKnowledgeDocumentInput({ id: "doc-x", owner: "user-1", visibility: "private" }), metadata("doc-x"), actor({ id: "user-1" }));
    const result = repo.delete("doc-x", actor({ id: "user-2", role: "Sales Executive" }));
    return !result.ok && repo.size() === 1;
  })()
);

check(
  "save throws when metadata documentId mismatches",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    try {
      repo.save(buildKnowledgeDocumentInput({ id: "doc-1" }), metadata("doc-2"), actor());
      return false;
    } catch (e) {
      return e instanceof Error && e.message.includes("metadata.documentId must match");
    }
  })()
);

check(
  "listByCollection returns sorted by id",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    repo.save(buildKnowledgeDocumentInput({ id: "doc-z" }), metadata("doc-z"), actor());
    repo.save(buildKnowledgeDocumentInput({ id: "doc-a" }), metadata("doc-a"), actor());
    const ids = repo.listByCollection("General", actor()).map((d) => d.id);
    return ids.join(",") === "doc-a,doc-z";
  })()
);

check(
  "buildKnowledgeDocumentInput produces valid document defaults",
  buildKnowledgeDocumentInput().collection === "General" && buildKnowledgeDocumentInput().status === "active"
);

console.log(`\nKnowledgeRepository tests: ${pass} passed`);
