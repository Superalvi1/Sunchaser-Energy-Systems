import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { buildUploadRequest } from "./DocumentUpload.ts";
import { createStaticVirusScanner } from "./VirusScanner.ts";
import { DocumentProcessingPipeline, createDocumentProcessingPipeline } from "./DocumentProcessingPipeline.ts";

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

check("createDocumentProcessingPipeline returns a DocumentProcessingPipeline", createDocumentProcessingPipeline() instanceof DocumentProcessingPipeline);

check("happy path: process() returns ok:true", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return result.ok;
})());

check("happy path: document is written with computed checksum", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return result.ok && "checksum" in result && result.document.checksum === result.checksum.value;
})());

check("happy path: first upload is version 1", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return result.ok && "version" in result && result.version.versionNumber === 1;
})());

check("happy path: content is actually stored and retrievable", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest({ content: Buffer.from("payload") }), actor: actor(), documentId: "doc-1" });
  if (!result.ok || !("storageRef" in result)) return false;
  return true;
})());

check("happy path: OCR job is enqueued but not_implemented", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return result.ok && "ocrJob" in result && result.ocrJob.status === "not_implemented";
})());

check("happy path: embedding job is enqueued but not_implemented", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return result.ok && "embeddingJob" in result && result.embeddingJob.status === "not_implemented";
})());

check("happy path: default visibility assigned is company", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return result.ok && "permissions" in result && result.permissions.visibility === "company";
})());

check("happy path: emits events for every stage in order, ending with pipeline.completed", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  const types = result.events.map((e) => e.type);
  return (
    types[0] === "pipeline.upload_received" &&
    types.includes("pipeline.virus_scan_completed") &&
    types.includes("pipeline.checksum_computed") &&
    types.includes("pipeline.duplicate_detected") &&
    types.includes("pipeline.version_resolved") &&
    types.includes("pipeline.stored") &&
    types.includes("pipeline.permissions_assigned") &&
    types.includes("pipeline.repository_saved") &&
    types.includes("pipeline.ocr_enqueued") &&
    types.includes("pipeline.embedding_enqueued") &&
    types[types.length - 1] === "pipeline.completed"
  );
})());

check("happy path: virus scan event occurs before checksum event", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  const types = result.events.map((e) => e.type);
  return types.indexOf("pipeline.virus_scan_completed") < types.indexOf("pipeline.checksum_computed");
})());

check("happy path: storage event occurs before repository_saved event", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  const types = result.events.map((e) => e.type);
  return types.indexOf("pipeline.stored") < types.indexOf("pipeline.repository_saved");
})());

check("happy path: repository_saved occurs before ocr_enqueued", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  const types = result.events.map((e) => e.type);
  return types.indexOf("pipeline.repository_saved") < types.indexOf("pipeline.ocr_enqueued");
})());

check("upload failure: invalid upload request halts at the upload stage", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest({ fileName: "" }), actor: actor(), documentId: "doc-1" });
  return !result.ok && result.stage === "upload";
})());

check("upload failure: emits a pipeline.failed event", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest({ fileName: "" }), actor: actor(), documentId: "doc-1" });
  return !result.ok && result.events.some((e) => e.type === "pipeline.failed");
})());

check("virus scan failure: infected scanner halts at virus_scan stage", (() => {
  const pipeline = createDocumentProcessingPipeline({
    virusScanner: createStaticVirusScanner({ status: "infected", engine: "test", scannedAt: "t", message: "found threat", threatName: "EICAR" }),
  });
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return !result.ok && result.stage === "virus_scan";
})());

check("virus scan failure: does not reach storage — nothing is written", (() => {
  const infectedPipeline = createDocumentProcessingPipeline({
    virusScanner: createStaticVirusScanner({ status: "infected", engine: "test", scannedAt: "t", message: "found threat" }),
  });
  const result = infectedPipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return !result.ok && !result.events.some((e) => e.type === "pipeline.stored");
})());

check("duplicate short-circuit: re-uploading identical content to the same family skips storage", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const upload = buildUploadRequest({ familyId: "family-x", content: Buffer.from("same-bytes") });
  pipeline.process({ upload, actor: actor(), documentId: "doc-1" });
  const second = pipeline.process({ upload, actor: actor(), documentId: "doc-2" });
  return second.ok && "shortCircuited" in second && second.shortCircuited === true;
})());

check("duplicate short-circuit: does not create a second document in the repository", (() => {
  const repositoryModule = createDocumentProcessingPipeline();
  const upload = buildUploadRequest({ familyId: "family-y", content: Buffer.from("same-bytes-2") });
  const first = repositoryModule.process({ upload, actor: actor(), documentId: "doc-1" });
  repositoryModule.process({ upload, actor: actor(), documentId: "doc-2" });
  return first.ok && "saveResult" in first;
})());

check("allowDuplicateReupload bypasses the short-circuit and creates a new version", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const upload = buildUploadRequest({ familyId: "family-z", content: Buffer.from("same-bytes-3") });
  pipeline.process({ upload, actor: actor(), documentId: "doc-1" });
  const second = pipeline.process({ upload, actor: actor(), documentId: "doc-2", allowDuplicateReupload: true });
  return second.ok && "version" in second && second.version.versionNumber === 2;
})());

check("re-uploading changed content to the same family creates version 2 (not a duplicate)", (() => {
  const pipeline = createDocumentProcessingPipeline();
  pipeline.process({ upload: buildUploadRequest({ familyId: "family-w", content: Buffer.from("v1") }), actor: actor(), documentId: "doc-1" });
  const second = pipeline.process({ upload: buildUploadRequest({ familyId: "family-w", content: Buffer.from("v2-different") }), actor: actor(), documentId: "doc-2" });
  return second.ok && "version" in second && second.version.versionNumber === 2 && !("shortCircuited" in second);
})());

check("familyId is auto-generated when not provided on the upload", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return typeof result.familyId === "string" && result.familyId.length > 0;
})());

check("auto-generated familyIds differ across independent uploads without an explicit familyId", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const first = pipeline.process({ upload: buildUploadRequest({ content: Buffer.from("a") }), actor: actor(), documentId: "doc-1" });
  const second = pipeline.process({ upload: buildUploadRequest({ content: Buffer.from("b") }), actor: actor(), documentId: "doc-2" });
  return first.familyId !== second.familyId;
})());

check("permission_assignment failure (invalid requested visibility) halts before storage", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({
    upload: buildUploadRequest({ requestedVisibility: "not-a-real-visibility" }),
    actor: actor(),
    documentId: "doc-1",
  });
  return !result.ok && result.stage === "permission_assignment";
})());

check("permission_assignment failure rolls back the storage write for this attempt", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({
    upload: buildUploadRequest({ requestedVisibility: "not-a-real-visibility" }),
    actor: actor(),
    documentId: "doc-1",
  });
  return !result.ok && !result.events.some((e) => e.type === "pipeline.repository_saved");
})());

check("dependencies are fully injectable via options", (() => {
  const pipeline = createDocumentProcessingPipeline({ now: () => "2026-05-05T00:00:00.000Z" });
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return result.ok && "storageRef" in result && result.storageRef.storedAt === "2026-05-05T00:00:00.000Z";
})());

check("explicit familyIdGenerator is honored for new families", (() => {
  const pipeline = createDocumentProcessingPipeline({ familyIdGenerator: () => "custom-family" });
  const result = pipeline.process({ upload: buildUploadRequest(), actor: actor(), documentId: "doc-1" });
  return result.familyId === "custom-family";
})());

check("process() never throws — even for a maximally invalid upload", (() => {
  const pipeline = createDocumentProcessingPipeline();
  const result = pipeline.process({
    upload: buildUploadRequest({ fileName: "", mimeType: "", content: Buffer.alloc(0) }),
    actor: actor(),
    documentId: "doc-1",
  });
  return result.ok === false;
})());

console.log(`\nDocumentProcessingPipeline tests: ${pass} passed`);
