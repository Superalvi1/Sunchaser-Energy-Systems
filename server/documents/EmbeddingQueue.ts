/**
 * Stage 11 — Future embedding queue.
 *
 * Architecture stub, matching KnowledgeSearch/KnowledgeIndexer's pattern
 * exactly: no vectors, no embedding model. Enqueuing always reports
 * not_implemented.
 */

export type EmbeddingJobStatus = "not_implemented" | "queued" | "completed" | "failed";

export interface EmbeddingJob {
  jobId: string;
  documentId: string;
  status: EmbeddingJobStatus;
  message: string;
}

export interface EmbeddingQueue {
  enqueue(documentId: string, actorId: string): EmbeddingJob;
}

export const EMBEDDING_QUEUE_NOT_IMPLEMENTED_MESSAGE =
  "Embedding generation is not implemented in this architecture. Wire a real embedding model before relying on semantic search.";

/** Deterministic stub — records intent, performs no work. */
export class StubEmbeddingQueue implements EmbeddingQueue {
  private jobCounter = 0;

  enqueue(documentId: string, actorId: string): EmbeddingJob {
    this.jobCounter += 1;
    return {
      jobId: `emb-${this.jobCounter}`,
      documentId,
      status: "not_implemented",
      message: EMBEDDING_QUEUE_NOT_IMPLEMENTED_MESSAGE,
    };
  }

  /** Test helper. */
  jobCount(): number {
    return this.jobCounter;
  }
}

export function createStubEmbeddingQueue(): StubEmbeddingQueue {
  return new StubEmbeddingQueue();
}
