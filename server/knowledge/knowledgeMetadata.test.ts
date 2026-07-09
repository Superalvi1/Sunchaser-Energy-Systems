import assert from "node:assert/strict";
import {
  createKnowledgeDocumentMetadata,
  isKnowledgeLinkedResourceType,
  knowledgeDocumentRecordIdsMatch,
  validateKnowledgeDocumentMetadata,
} from "./KnowledgeMetadata.ts";
import { createKnowledgeDocument } from "./KnowledgeDocument.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const validMeta = {
  documentId: "doc-1",
  fileName: "invoice.pdf",
  fileSizeBytes: 4096,
  pageCount: 2,
  linkedResource: { type: "invoice" as const, id: "inv-1", customerId: "cust-1" },
};

check("validateKnowledgeDocumentMetadata accepts valid metadata", validateKnowledgeDocumentMetadata(validMeta).ok === true);
check("createKnowledgeDocumentMetadata trims fileName", createKnowledgeDocumentMetadata(validMeta).fileName === "invoice.pdf");
check("isKnowledgeLinkedResourceType accepts invoice", isKnowledgeLinkedResourceType("invoice"));
check("isKnowledgeLinkedResourceType accepts warranty", isKnowledgeLinkedResourceType("warranty"));
check("isKnowledgeLinkedResourceType rejects unknown", !isKnowledgeLinkedResourceType("unknown"));

check("validate rejects negative fileSizeBytes", validateKnowledgeDocumentMetadata({ ...validMeta, fileSizeBytes: -1 }).ok === false);
check("validate rejects empty documentId", validateKnowledgeDocumentMetadata({ ...validMeta, documentId: "" }).ok === false);
check("validate rejects empty fileName", validateKnowledgeDocumentMetadata({ ...validMeta, fileName: "" }).ok === false);
check("validate rejects negative pageCount", validateKnowledgeDocumentMetadata({ ...validMeta, pageCount: -1 }).ok === false);
check("validate rejects invalid linkedResource type", validateKnowledgeDocumentMetadata({ ...validMeta, linkedResource: { type: "bad" as "invoice", id: "x" } }).ok === false);
check("validate rejects empty linkedResource id", validateKnowledgeDocumentMetadata({ ...validMeta, linkedResource: { type: "invoice", id: "" } }).ok === false);
check("validate rejects non-array allowedRoles", validateKnowledgeDocumentMetadata({ ...validMeta, allowedRoles: "Admin" as unknown as string[] }).ok === false);

check(
  "knowledgeDocumentRecordIdsMatch true when ids align",
  (() => {
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
    const meta = createKnowledgeDocumentMetadata({ documentId: "doc-1", fileName: "f.pdf", fileSizeBytes: 100 });
    return knowledgeDocumentRecordIdsMatch({ document: doc, metadata: meta });
  })()
);

check(
  "knowledgeDocumentRecordIdsMatch false when ids differ",
  (() => {
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
    const meta = createKnowledgeDocumentMetadata({ documentId: "doc-2", fileName: "f.pdf", fileSizeBytes: 100 });
    return !knowledgeDocumentRecordIdsMatch({ document: doc, metadata: meta });
  })()
);

console.log(`\nKnowledgeMetadata tests: ${pass} passed`);
