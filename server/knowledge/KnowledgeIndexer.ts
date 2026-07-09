/**
 * Knowledge indexer interface — architecture stub.
 *
 * No embeddings, vectors, OCR, or parsing in V5.
 */

import type { KnowledgeChunk } from "./KnowledgeChunk.ts";
import type { KnowledgeDocument } from "./KnowledgeDocument.ts";
import { createKnowledgeEvent } from "./KnowledgeEvents.ts";

export type KnowledgeIndexStatus = "not_implemented" | "queued" | "completed" | "failed";

export interface KnowledgeIndexJob {
  jobId: string;
  documentId: string;
  status: KnowledgeIndexStatus;
  chunkCount: number;
  message: string;
}

export interface KnowledgeIndexer {
  /** Queue a document for indexing. V5 returns not_implemented. */
  index(
    document: KnowledgeDocument,
    chunks: KnowledgeChunk[],
    actorId: string
  ): KnowledgeIndexJob;
}

export const KNOWLEDGE_INDEXER_NOT_IMPLEMENTED_MESSAGE =
  "Knowledge indexing is not implemented in V5 architecture.";

/** Deterministic stub indexer — records intent, performs no work. */
export class StubKnowledgeIndexer implements KnowledgeIndexer {
  private jobCounter = 0;

  index(document: KnowledgeDocument, chunks: KnowledgeChunk[], actorId: string): KnowledgeIndexJob {
    this.jobCounter += 1;
    const jobId = `kidx-${this.jobCounter}`;
    createKnowledgeEvent({
      id: `kevt-idx-${this.jobCounter}`,
      type: "index.requested",
      documentId: document.id,
      actorId,
      companyId: document.companyId,
      payload: { chunkCount: chunks.length, implemented: false },
    });
    return {
      jobId,
      documentId: document.id,
      status: "not_implemented",
      chunkCount: chunks.length,
      message: KNOWLEDGE_INDEXER_NOT_IMPLEMENTED_MESSAGE,
    };
  }
}

export function createStubKnowledgeIndexer(): StubKnowledgeIndexer {
  return new StubKnowledgeIndexer();
}

export const STUB_KNOWLEDGE_INDEXER: KnowledgeIndexer = createStubKnowledgeIndexer();
