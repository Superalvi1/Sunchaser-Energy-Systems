import assert from "node:assert/strict";
import {
  createKnowledgeDocument,
  isActiveKnowledgeDocument,
  isKnowledgeDocumentArchived,
  validateKnowledgeDocument,
} from "./KnowledgeDocument.ts";
import { KNOWLEDGE_DEFAULT_TIMESTAMP } from "./KnowledgeModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const validInput = {
  id: "doc-001",
  title: "Installation Manual",
  collection: "Engineering" as const,
  owner: "user-admin",
  visibility: "company" as const,
  department: "Engineering",
  companyId: "sunchaser",
  tags: ["manual", "solar"],
  mimeType: "application/pdf" as const,
  checksum: "sha256:abc",
  language: "EN",
  source: "upload" as const,
  status: "active" as const,
};

check("validateKnowledgeDocument accepts valid input", validateKnowledgeDocument(validInput).ok === true);
check("createKnowledgeDocument normalizes language to lowercase", createKnowledgeDocument(validInput).language === "en");
check("createKnowledgeDocument normalizes tags", createKnowledgeDocument(validInput).tags.join(",") === "manual,solar");
check("createKnowledgeDocument uses deterministic timestamp when omitted", createKnowledgeDocument(validInput).createdAt === KNOWLEDGE_DEFAULT_TIMESTAMP);
check("isActiveKnowledgeDocument true for active status", isActiveKnowledgeDocument(createKnowledgeDocument(validInput)));
check("isKnowledgeDocumentArchived false for active", !isKnowledgeDocumentArchived(createKnowledgeDocument(validInput)));

check(
  "validateKnowledgeDocument rejects empty id",
  validateKnowledgeDocument({ ...validInput, id: "" }).ok === false
);
check(
  "validateKnowledgeDocument rejects empty title",
  validateKnowledgeDocument({ ...validInput, title: "  " }).ok === false
);
check(
  "validateKnowledgeDocument rejects invalid collection",
  validateKnowledgeDocument({ ...validInput, collection: "Bad" as "General" }).ok === false
);
check(
  "validateKnowledgeDocument rejects invalid visibility",
  validateKnowledgeDocument({ ...validInput, visibility: "public" as "company" }).ok === false
);
check(
  "validateKnowledgeDocument rejects unsupported mimeType",
  validateKnowledgeDocument({ ...validInput, mimeType: "application/x-bad" as "application/pdf" }).ok === false
);
check(
  "validateKnowledgeDocument rejects invalid source",
  validateKnowledgeDocument({ ...validInput, source: "ftp" as "upload" }).ok === false
);
check(
  "validateKnowledgeDocument rejects invalid status",
  validateKnowledgeDocument({ ...validInput, status: "processing" as "active" }).ok === false
);
check(
  "validateKnowledgeDocument rejects non-array tags",
  validateKnowledgeDocument({ ...validInput, tags: "tag" as unknown as string[] }).ok === false
);

check(
  "archived document detected correctly",
  isKnowledgeDocumentArchived(createKnowledgeDocument({ ...validInput, status: "archived" }))
);

check(
  "explicit createdAt and updatedAt are preserved",
  (() => {
    const doc = createKnowledgeDocument({
      ...validInput,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    return doc.createdAt === "2026-01-01T00:00:00.000Z" && doc.updatedAt === "2026-06-01T00:00:00.000Z";
  })()
);

check(
  "createKnowledgeDocument throws on invalid input",
  (() => {
    try {
      createKnowledgeDocument({ ...validInput, id: "" });
      return false;
    } catch (e) {
      return e instanceof Error && e.message.includes("Invalid knowledge document");
    }
  })()
);

console.log(`\nKnowledgeDocument tests: ${pass} passed`);
