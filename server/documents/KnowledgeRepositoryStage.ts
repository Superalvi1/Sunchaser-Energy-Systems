/**
 * Stage 8 — Knowledge repository.
 *
 * Thin wrapper around the existing KnowledgeRepository (server/knowledge).
 * No new persistence logic — this stage only builds the KnowledgeDocumentInput
 * and metadata the pipeline assembled, then delegates to the repository, and
 * normalizes any thrown error into a DocumentPipelineError.
 */

import type { RequestActor } from "../middleware/actor.ts";
import { createKnowledgeDocument, type KnowledgeDocumentInput } from "../knowledge/KnowledgeDocument.ts";
import { createKnowledgeDocumentMetadata, type KnowledgeDocumentMetadata } from "../knowledge/KnowledgeMetadata.ts";
import type { KnowledgeRepository, KnowledgeSaveResult } from "../knowledge/KnowledgeRepository.ts";
import { DocumentPipelineError } from "./DocumentModels.ts";

export interface KnowledgeRepositoryStageInput {
  documentInput: KnowledgeDocumentInput;
  metadata: KnowledgeDocumentMetadata;
  actor: RequestActor;
}

const KNOWLEDGE_REPOSITORY_STAGE = "knowledge_repository" as const;

/** Map stage failures to a safe message — never echo raw document field values. */
function knowledgeRepositorySafeMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return "Knowledge repository stage failed.";
  }

  const message = err.message;
  if (message.startsWith("Invalid knowledge document:") || message.startsWith("Cannot save invalid document:")) {
    return "Invalid knowledge document input.";
  }
  if (message.startsWith("Invalid knowledge metadata:")) {
    return "Invalid knowledge metadata.";
  }
  if (message === "metadata.documentId must match document.id") {
    return "Document and metadata identifiers do not match.";
  }
  if (message.startsWith("Write denied:")) {
    return "Knowledge document write denied.";
  }

  return "Knowledge repository stage failed.";
}

function toKnowledgeRepositoryPipelineError(err: unknown): DocumentPipelineError {
  if (err instanceof DocumentPipelineError && err.stage === KNOWLEDGE_REPOSITORY_STAGE) {
    return err;
  }

  const cause = err instanceof Error ? err : new Error(String(err));
  return new DocumentPipelineError(KNOWLEDGE_REPOSITORY_STAGE, knowledgeRepositorySafeMessage(cause), {
    cause,
  });
}

export function saveToKnowledgeRepository(
  repository: KnowledgeRepository,
  input: KnowledgeRepositoryStageInput
): KnowledgeSaveResult {
  try {
    // Re-validate here (rather than trusting upstream stages blindly) so a
    // malformed document never reaches the repository's own validation with an
    // unclear error origin.
    createKnowledgeDocument(input.documentInput);
    createKnowledgeDocumentMetadata(input.metadata);
    return repository.save(input.documentInput, input.metadata, input.actor);
  } catch (err) {
    throw toKnowledgeRepositoryPipelineError(err);
  }
}
