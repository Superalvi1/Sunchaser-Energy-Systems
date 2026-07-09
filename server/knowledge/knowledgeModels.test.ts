import assert from "node:assert/strict";
import {
  isKnowledgeCollection,
  isKnowledgeSource,
  isKnowledgeStatus,
  isKnowledgeVisibility,
  isNonEmptyString,
  isSupportedKnowledgeMimeType,
  KNOWLEDGE_COLLECTIONS,
  KNOWLEDGE_DEFAULT_TIMESTAMP,
  KNOWLEDGE_SOURCES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_VISIBILITIES,
  normalizeKnowledgeTags,
  SUPPORTED_KNOWLEDGE_MIME_TYPES,
} from "./KnowledgeModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("KNOWLEDGE_COLLECTIONS has exactly 14 entries", KNOWLEDGE_COLLECTIONS.length === 14);
check("KNOWLEDGE_COLLECTIONS includes Policies", KNOWLEDGE_COLLECTIONS.includes("Policies"));
check("KNOWLEDGE_COLLECTIONS includes SOPs", KNOWLEDGE_COLLECTIONS.includes("SOPs"));
check("KNOWLEDGE_COLLECTIONS includes Finance", KNOWLEDGE_COLLECTIONS.includes("Finance"));
check("KNOWLEDGE_COLLECTIONS includes Legal", KNOWLEDGE_COLLECTIONS.includes("Legal"));
check("KNOWLEDGE_COLLECTIONS includes General", KNOWLEDGE_COLLECTIONS.includes("General"));

check("isKnowledgeCollection accepts valid collection", isKnowledgeCollection("Sales"));
check("isKnowledgeCollection rejects invalid collection", !isKnowledgeCollection("Invalid"));
check("isKnowledgeVisibility accepts all defined visibilities", KNOWLEDGE_VISIBILITIES.every(isKnowledgeVisibility));
check("isKnowledgeVisibility rejects unknown", !isKnowledgeVisibility("public"));
check("isKnowledgeSource accepts upload", isKnowledgeSource("upload"));
check("isKnowledgeSource accepts future google_drive", isKnowledgeSource("google_drive"));
check("isKnowledgeSource rejects unknown", !isKnowledgeSource("ftp"));
check("isKnowledgeStatus accepts all statuses", KNOWLEDGE_STATUSES.every(isKnowledgeStatus));
check("isKnowledgeStatus rejects unknown", !isKnowledgeStatus("processing"));
check("isSupportedKnowledgeMimeType accepts application/pdf", isSupportedKnowledgeMimeType("application/pdf"));
check("isSupportedKnowledgeMimeType accepts docx mime", isSupportedKnowledgeMimeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
check("isSupportedKnowledgeMimeType rejects unknown", !isSupportedKnowledgeMimeType("application/x-unknown"));

check("SUPPORTED_KNOWLEDGE_MIME_TYPES includes image/jpeg and message/rfc822", SUPPORTED_KNOWLEDGE_MIME_TYPES.includes("image/jpeg") && SUPPORTED_KNOWLEDGE_MIME_TYPES.includes("message/rfc822"));
check("KNOWLEDGE_SOURCES includes sharepoint and dropbox future sources", KNOWLEDGE_SOURCES.includes("sharepoint") && KNOWLEDGE_SOURCES.includes("dropbox"));
check("KNOWLEDGE_DEFAULT_TIMESTAMP is deterministic ISO string", KNOWLEDGE_DEFAULT_TIMESTAMP === "1970-01-01T00:00:00.000Z");

check("normalizeKnowledgeTags deduplicates and lowercases", normalizeKnowledgeTags(["SOP", "sop", " HR "]).join(",") === "hr,sop");
check("normalizeKnowledgeTags sorts alphabetically", normalizeKnowledgeTags(["zebra", "alpha"]).join(",") === "alpha,zebra");
check("normalizeKnowledgeTags skips empty strings", normalizeKnowledgeTags(["", "  ", "valid"]).join(",") === "valid");
check("isNonEmptyString accepts trimmed text", isNonEmptyString("hello"));
check("isNonEmptyString rejects whitespace", !isNonEmptyString("   "));
check("isNonEmptyString rejects non-string", !isNonEmptyString(42));

console.log(`\nKnowledgeModels tests: ${pass} passed`);
