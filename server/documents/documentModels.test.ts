import assert from "node:assert/strict";
import {
  DOCUMENT_PIPELINE_STAGES,
  DocumentPipelineError,
  isDocumentPipelineStage,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  stageIsBefore,
} from "./DocumentModels.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("pipeline has 11 stages", DOCUMENT_PIPELINE_STAGES.length === 11);
check("stage order starts with upload", DOCUMENT_PIPELINE_STAGES[0] === "upload");
check("stage order ends with embedding_queue", DOCUMENT_PIPELINE_STAGES[DOCUMENT_PIPELINE_STAGES.length - 1] === "embedding_queue");
check("stage order: virus_scan before checksum", DOCUMENT_PIPELINE_STAGES.indexOf("virus_scan") < DOCUMENT_PIPELINE_STAGES.indexOf("checksum"));
check("stage order: checksum before duplicate_detection", DOCUMENT_PIPELINE_STAGES.indexOf("checksum") < DOCUMENT_PIPELINE_STAGES.indexOf("duplicate_detection"));
check("stage order: duplicate_detection before versioning", DOCUMENT_PIPELINE_STAGES.indexOf("duplicate_detection") < DOCUMENT_PIPELINE_STAGES.indexOf("versioning"));
check("stage order: versioning before storage", DOCUMENT_PIPELINE_STAGES.indexOf("versioning") < DOCUMENT_PIPELINE_STAGES.indexOf("storage"));
check("stage order: storage before permission_assignment", DOCUMENT_PIPELINE_STAGES.indexOf("storage") < DOCUMENT_PIPELINE_STAGES.indexOf("permission_assignment"));
check("stage order: permission_assignment before knowledge_repository", DOCUMENT_PIPELINE_STAGES.indexOf("permission_assignment") < DOCUMENT_PIPELINE_STAGES.indexOf("knowledge_repository"));
check("stage order: knowledge_repository before event_bus", DOCUMENT_PIPELINE_STAGES.indexOf("knowledge_repository") < DOCUMENT_PIPELINE_STAGES.indexOf("event_bus"));
check("stage order: event_bus before ocr_queue", DOCUMENT_PIPELINE_STAGES.indexOf("event_bus") < DOCUMENT_PIPELINE_STAGES.indexOf("ocr_queue"));
check("stage order: ocr_queue before embedding_queue", DOCUMENT_PIPELINE_STAGES.indexOf("ocr_queue") < DOCUMENT_PIPELINE_STAGES.indexOf("embedding_queue"));

check("isDocumentPipelineStage accepts valid stage", isDocumentPipelineStage("checksum"));
check("isDocumentPipelineStage rejects unknown", !isDocumentPipelineStage("teleportation"));
check("isDocumentPipelineStage rejects empty string", !isDocumentPipelineStage(""));

check("stageIsBefore true for correct order", stageIsBefore("upload", "checksum"));
check("stageIsBefore false for reverse order", !stageIsBefore("checksum", "upload"));
check("stageIsBefore false for same stage", !stageIsBefore("checksum", "checksum"));

check("DocumentPipelineError carries stage", new DocumentPipelineError("checksum", "bad").stage === "checksum");
check("DocumentPipelineError carries reason", new DocumentPipelineError("checksum", "bad").reason === "bad");
check("DocumentPipelineError message includes stage tag", new DocumentPipelineError("storage", "oops").message === "[storage] oops");
check("DocumentPipelineError carries details", new DocumentPipelineError("upload", "x", { a: 1 }).details?.a === 1);
check("DocumentPipelineError details optional", new DocumentPipelineError("upload", "x").details === undefined);
check("DocumentPipelineError is an Error instance", new DocumentPipelineError("upload", "x") instanceof Error);
check("DocumentPipelineError name is set", new DocumentPipelineError("upload", "x").name === "DocumentPipelineError");

check("isNonEmptyString true for text", isNonEmptyString("hello"));
check("isNonEmptyString false for empty", !isNonEmptyString(""));
check("isNonEmptyString false for whitespace-only", !isNonEmptyString("   "));
check("isNonEmptyString false for number", !isNonEmptyString(42));
check("isNonEmptyString false for undefined", !isNonEmptyString(undefined));
check("isNonEmptyString false for null", !isNonEmptyString(null));

check("isPositiveInteger true for 1", isPositiveInteger(1));
check("isPositiveInteger false for 0", !isPositiveInteger(0));
check("isPositiveInteger false for negative", !isPositiveInteger(-1));
check("isPositiveInteger false for float", !isPositiveInteger(1.5));
check("isPositiveInteger false for string", !isPositiveInteger("1"));

check("isNonNegativeInteger true for 0", isNonNegativeInteger(0));
check("isNonNegativeInteger true for 5", isNonNegativeInteger(5));
check("isNonNegativeInteger false for negative", !isNonNegativeInteger(-1));
check("isNonNegativeInteger false for float", !isNonNegativeInteger(2.2));

console.log(`\nDocumentModels tests: ${pass} passed`);
