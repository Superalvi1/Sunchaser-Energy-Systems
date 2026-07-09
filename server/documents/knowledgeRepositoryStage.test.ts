import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { createInMemoryKnowledgeRepository } from "../knowledge/KnowledgeRepository.ts";
import type { KnowledgeDocumentInput } from "../knowledge/KnowledgeDocument.ts";
import { DocumentPipelineError } from "./DocumentModels.ts";
import { saveToKnowledgeRepository } from "./KnowledgeRepositoryStage.ts";

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
    role: "Sales Executive",
    accountStatus: "Active",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

function docInput(overrides: Partial<KnowledgeDocumentInput> = {}): KnowledgeDocumentInput {
  return {
    id: "doc-1",
    title: "Test Doc",
    collection: "General",
    owner: "user-1",
    visibility: "company",
    department: "Operations",
    companyId: "co1",
    tags: [],
    mimeType: "application/pdf",
    checksum: "checksum-1",
    language: "en",
    source: "upload",
    status: "active",
    ...overrides,
  };
}

check("saveToKnowledgeRepository succeeds for a valid document + metadata", (() => {
  const repo = createInMemoryKnowledgeRepository();
  const result = saveToKnowledgeRepository(repo, {
    documentInput: docInput(),
    metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
    actor: actor(),
  });
  return result.ok && result.document.id === "doc-1";
})());

check("saveToKnowledgeRepository persists into the repository", (() => {
  const repo = createInMemoryKnowledgeRepository();
  saveToKnowledgeRepository(repo, {
    documentInput: docInput(),
    metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
    actor: actor(),
  });
  return repo.size() === 1;
})());

check(
  "saveToKnowledgeRepository throws DocumentPipelineError for invalid document input",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    try {
      saveToKnowledgeRepository(repo, {
        documentInput: docInput({ id: "" }),
        metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
        actor: actor(),
      });
      return false;
    } catch (e) {
      return (
        e instanceof DocumentPipelineError &&
        e.stage === "knowledge_repository" &&
        e.reason === "Invalid knowledge document input."
      );
    }
  })()
);

check(
  "saveToKnowledgeRepository preserves cause for invalid document input",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    try {
      saveToKnowledgeRepository(repo, {
        documentInput: docInput({ id: "" }),
        metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
        actor: actor(),
      });
      return false;
    } catch (e) {
      return (
        e instanceof DocumentPipelineError &&
        e.details?.cause instanceof Error &&
        String(e.details.cause.message).includes("Invalid knowledge document:")
      );
    }
  })()
);

check(
  "saveToKnowledgeRepository does not leak document field values in error message",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    const secretTitle = "SECRET-TITLE-xyzzy-12345";
    try {
      saveToKnowledgeRepository(repo, {
        documentInput: docInput({ id: "", title: secretTitle }),
        metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
        actor: actor(),
      });
      return false;
    } catch (e) {
      if (!(e instanceof DocumentPipelineError)) return false;
      const combined = `${e.message} ${e.reason}`;
      return !combined.includes(secretTitle);
    }
  })()
);

check(
  "saveToKnowledgeRepository throws for mismatched metadata.documentId",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    try {
      saveToKnowledgeRepository(repo, {
        documentInput: docInput({ id: "doc-1" }),
        metadata: { documentId: "doc-2", fileName: "f.pdf", fileSizeBytes: 10 },
        actor: actor(),
      });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError;
    }
  })()
);

check(
  "saveToKnowledgeRepository throws for invalid metadata",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    try {
      saveToKnowledgeRepository(repo, {
        documentInput: docInput(),
        metadata: { documentId: "doc-1", fileName: "", fileSizeBytes: -1 },
        actor: actor(),
      });
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && e.stage === "knowledge_repository";
    }
  })()
);

check(
  "saveToKnowledgeRepository throws when write is denied by permissions",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    try {
      saveToKnowledgeRepository(repo, {
        documentInput: docInput({ collection: "HR", owner: "other-user" }),
        metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
        actor: actor({ role: "Sales Executive", id: "not-owner" }),
      });
      return false;
    } catch (e) {
      return (
        e instanceof DocumentPipelineError &&
        e.stage === "knowledge_repository" &&
        e.reason === "Knowledge document write denied."
      );
    }
  })()
);

check(
  "saveToKnowledgeRepository preserves cause for repository write denial",
  (() => {
    const repo = createInMemoryKnowledgeRepository();
    try {
      saveToKnowledgeRepository(repo, {
        documentInput: docInput({ collection: "HR", owner: "other-user" }),
        metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
        actor: actor({ role: "Sales Executive", id: "not-owner" }),
      });
      return false;
    } catch (e) {
      return (
        e instanceof DocumentPipelineError &&
        e.details?.cause instanceof Error &&
        String(e.details.cause.message).startsWith("Write denied:")
      );
    }
  })()
);

check("saveToKnowledgeRepository returns an event alongside the saved document", (() => {
  const repo = createInMemoryKnowledgeRepository();
  const result = saveToKnowledgeRepository(repo, {
    documentInput: docInput(),
    metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
    actor: actor(),
  });
  return result.event.type === "document.created";
})());

check("second save of the same id is treated as an update event", (() => {
  const repo = createInMemoryKnowledgeRepository();
  saveToKnowledgeRepository(repo, {
    documentInput: docInput(),
    metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
    actor: actor({ id: "user-1" }),
  });
  const result = saveToKnowledgeRepository(repo, {
    documentInput: docInput({ title: "Updated" }),
    metadata: { documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 10 },
    actor: actor({ id: "user-1" }),
  });
  return result.event.type === "document.updated";
})());

console.log(`\nKnowledgeRepositoryStage tests: ${pass} passed`);
