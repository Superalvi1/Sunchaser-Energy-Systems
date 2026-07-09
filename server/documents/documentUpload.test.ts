import assert from "node:assert/strict";
import { DocumentPipelineError } from "./DocumentModels.ts";
import {
  buildUploadRequest,
  intakeUpload,
  MAX_UPLOAD_SIZE_BYTES,
  validateUploadRequest,
} from "./DocumentUpload.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("valid upload request passes", validateUploadRequest(buildUploadRequest()).ok);
check("valid upload normalizes fileName", (() => {
  const r = validateUploadRequest(buildUploadRequest({ fileName: "  padded.pdf  " }));
  return r.ok && r.file.fileName === "padded.pdf";
})());
check("valid upload computes sizeBytes from content", (() => {
  const content = Buffer.from("hello world");
  const r = validateUploadRequest(buildUploadRequest({ content }));
  return r.ok && r.file.sizeBytes === content.byteLength;
})());
check("valid upload defaults language to en", (() => {
  const r = validateUploadRequest(buildUploadRequest({ language: undefined }));
  return r.ok && r.file.language === "en";
})());
check("valid upload lowercases language", (() => {
  const r = validateUploadRequest(buildUploadRequest({ language: "EN-us" }));
  return r.ok && r.file.language === "en-us";
})());
check("valid upload trims/dedupes empty tags", (() => {
  const r = validateUploadRequest(buildUploadRequest({ tags: [" a ", "", "b"] }));
  return r.ok && r.file.tags.length === 2 && r.file.tags[0] === "a";
})());
check("valid upload preserves familyId", (() => {
  const r = validateUploadRequest(buildUploadRequest({ familyId: "family-1" }));
  return r.ok && r.file.familyId === "family-1";
})());
check("valid upload omits familyId when not provided", (() => {
  const r = validateUploadRequest(buildUploadRequest());
  return r.ok && r.file.familyId === undefined;
})());
check("valid upload preserves linkedResource", (() => {
  const r = validateUploadRequest(buildUploadRequest({ linkedResource: { type: "customer", id: "c1", customerId: "c1" } }));
  return r.ok && r.file.linkedResource?.id === "c1";
})());
check("valid upload preserves allowedRoles", (() => {
  const r = validateUploadRequest(buildUploadRequest({ allowedRoles: ["Admin"] }));
  return r.ok && r.file.allowedRoles?.[0] === "Admin";
})());

check("missing fileName rejected", !validateUploadRequest(buildUploadRequest({ fileName: "" })).ok);
check("whitespace fileName rejected", !validateUploadRequest(buildUploadRequest({ fileName: "   " })).ok);
check("unsupported mimeType rejected", !validateUploadRequest(buildUploadRequest({ mimeType: "application/x-evil" })).ok);
check("empty mimeType rejected", !validateUploadRequest(buildUploadRequest({ mimeType: "" })).ok);
check("non-buffer content rejected", !validateUploadRequest(buildUploadRequest({ content: "not a buffer" as unknown as Buffer })).ok);
check("empty buffer rejected", !validateUploadRequest(buildUploadRequest({ content: Buffer.alloc(0) })).ok);
check("oversized content rejected", !validateUploadRequest(buildUploadRequest({ content: Buffer.alloc(10) }), 5).ok);
check("content exactly at max size is accepted", validateUploadRequest(buildUploadRequest({ content: Buffer.alloc(5) }), 5).ok);
check("invalid collection rejected", !validateUploadRequest(buildUploadRequest({ collection: "NotACollection" })).ok);
check("empty collection rejected", !validateUploadRequest(buildUploadRequest({ collection: "" })).ok);
check("missing ownerId rejected", !validateUploadRequest(buildUploadRequest({ ownerId: "" })).ok);
check("missing companyId rejected", !validateUploadRequest(buildUploadRequest({ companyId: "" })).ok);
check("missing department rejected", !validateUploadRequest(buildUploadRequest({ department: "" })).ok);
check("non-array tags rejected", !validateUploadRequest(buildUploadRequest({ tags: "not-array" as unknown as string[] })).ok);
check("whitespace-only familyId rejected", !validateUploadRequest(buildUploadRequest({ familyId: "   " })).ok);
check("non-array allowedRoles rejected", !validateUploadRequest(buildUploadRequest({ allowedRoles: "x" as unknown as string[] })).ok);

check("multiple validation errors are all collected", (() => {
  const r = validateUploadRequest(buildUploadRequest({ fileName: "", ownerId: "" }));
  return !r.ok && r.errors.length >= 2;
})());

check("MAX_UPLOAD_SIZE_BYTES is 25 MiB", MAX_UPLOAD_SIZE_BYTES === 25 * 1024 * 1024);

check("intakeUpload returns UploadedFile for valid input", intakeUpload(buildUploadRequest()).fileName === "manual.pdf");
check(
  "intakeUpload throws DocumentPipelineError for invalid input",
  (() => {
    try {
      intakeUpload(buildUploadRequest({ fileName: "" }));
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && e.stage === "upload";
    }
  })()
);
check(
  "intakeUpload error includes collected errors in details",
  (() => {
    try {
      intakeUpload(buildUploadRequest({ fileName: "" }));
      return false;
    } catch (e) {
      return e instanceof DocumentPipelineError && Array.isArray(e.details?.errors);
    }
  })()
);

console.log(`\nDocumentUpload tests: ${pass} passed`);
