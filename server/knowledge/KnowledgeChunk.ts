/**
 * Knowledge chunk — future indexing unit. Architecture only; no parsing or embeddings.
 */

import { isNonEmptyString, KNOWLEDGE_DEFAULT_TIMESTAMP } from "./KnowledgeModels.ts";

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  /** Zero-based sequence within the parent document. */
  sequence: number;
  /** Reserved for future text extraction — empty in V5 architecture. */
  contentRef: string;
  byteOffset: number;
  byteLength: number;
  checksum: string;
  createdAt: string;
}

export type KnowledgeChunkInput = Omit<KnowledgeChunk, "createdAt"> & {
  createdAt?: string;
};

export interface KnowledgeChunkValidationResult {
  ok: true;
  chunk: KnowledgeChunk;
}

export interface KnowledgeChunkValidationError {
  ok: false;
  errors: string[];
}

export type KnowledgeChunkValidation = KnowledgeChunkValidationResult | KnowledgeChunkValidationError;

export function validateKnowledgeChunk(input: KnowledgeChunkInput): KnowledgeChunkValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.documentId)) errors.push("documentId is required");
  if (!Number.isInteger(input.sequence) || input.sequence < 0) errors.push("sequence must be a non-negative integer");
  if (typeof input.contentRef !== "string") errors.push("contentRef must be a string");
  if (!Number.isInteger(input.byteOffset) || input.byteOffset < 0) errors.push("byteOffset must be a non-negative integer");
  if (!Number.isInteger(input.byteLength) || input.byteLength < 0) errors.push("byteLength must be a non-negative integer");
  if (!isNonEmptyString(input.checksum)) errors.push("checksum is required");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    chunk: {
      id: input.id.trim(),
      documentId: input.documentId.trim(),
      sequence: input.sequence,
      contentRef: input.contentRef,
      byteOffset: input.byteOffset,
      byteLength: input.byteLength,
      checksum: input.checksum.trim(),
      createdAt: input.createdAt ?? KNOWLEDGE_DEFAULT_TIMESTAMP,
    },
  };
}

export function createKnowledgeChunk(input: KnowledgeChunkInput): KnowledgeChunk {
  const result = validateKnowledgeChunk(input);
  if (!result.ok) {
    throw new Error(`Invalid knowledge chunk: ${(result as any).errors.join("; ")}`);
  }
  return result.chunk;
}

/** Sort chunks deterministically by sequence then id. */
export function sortKnowledgeChunks(chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  return [...chunks].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.id.localeCompare(b.id);
  });
}
