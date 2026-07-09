import assert from "node:assert/strict";
import { createKnowledgeChunk, sortKnowledgeChunks, validateKnowledgeChunk } from "./KnowledgeChunk.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const validChunk = {
  id: "chunk-1",
  documentId: "doc-1",
  sequence: 0,
  contentRef: "",
  byteOffset: 0,
  byteLength: 1024,
  checksum: "sha256:chunk",
};

check("validateKnowledgeChunk accepts valid chunk", validateKnowledgeChunk(validChunk).ok === true);
check("createKnowledgeChunk returns validated chunk", createKnowledgeChunk(validChunk).id === "chunk-1");
check("sortKnowledgeChunks orders by sequence", sortKnowledgeChunks([
  createKnowledgeChunk({ ...validChunk, id: "b", sequence: 2 }),
  createKnowledgeChunk({ ...validChunk, id: "a", sequence: 0 }),
  createKnowledgeChunk({ ...validChunk, id: "c", sequence: 1 }),
]).map((c) => c.sequence).join(",") === "0,1,2");
check("sortKnowledgeChunks breaks ties by id", sortKnowledgeChunks([
  createKnowledgeChunk({ ...validChunk, id: "b", sequence: 0 }),
  createKnowledgeChunk({ ...validChunk, id: "a", sequence: 0 }),
]).map((c) => c.id).join(",") === "a,b");

check("validateKnowledgeChunk rejects negative sequence", validateKnowledgeChunk({ ...validChunk, sequence: -1 }).ok === false);
check("validateKnowledgeChunk rejects negative byteOffset", validateKnowledgeChunk({ ...validChunk, byteOffset: -1 }).ok === false);
check("validateKnowledgeChunk rejects negative byteLength", validateKnowledgeChunk({ ...validChunk, byteLength: -1 }).ok === false);
check("validateKnowledgeChunk rejects empty documentId", validateKnowledgeChunk({ ...validChunk, documentId: "" }).ok === false);
check("validateKnowledgeChunk rejects empty checksum", validateKnowledgeChunk({ ...validChunk, checksum: "  " }).ok === false);
check("validateKnowledgeChunk rejects non-integer sequence", validateKnowledgeChunk({ ...validChunk, sequence: 1.5 }).ok === false);

check(
  "createKnowledgeChunk throws on invalid input",
  (() => {
    try {
      createKnowledgeChunk({ ...validChunk, id: "" });
      return false;
    } catch (e) {
      return e instanceof Error;
    }
  })()
);

console.log(`\nKnowledgeChunk tests: ${pass} passed`);
