/**
 * Stage 10 — Future OCR queue.
 *
 * Architecture stub, matching KnowledgeIndexer's pattern exactly: no OCR
 * engine, no text extraction. Enqueuing always reports not_implemented.
 */

export type OcrJobStatus = "not_implemented" | "queued" | "completed" | "failed";

export interface OcrJob {
  jobId: string;
  documentId: string;
  status: OcrJobStatus;
  message: string;
}

export interface OcrQueue {
  enqueue(documentId: string, actorId: string): OcrJob;
}

export const OCR_QUEUE_NOT_IMPLEMENTED_MESSAGE =
  "OCR is not implemented in this architecture. Wire a real OCR engine before relying on extracted text.";

/** Deterministic stub — records intent, performs no work. */
export class StubOcrQueue implements OcrQueue {
  private jobCounter = 0;

  enqueue(documentId: string, actorId: string): OcrJob {
    this.jobCounter += 1;
    return {
      jobId: `ocr-${this.jobCounter}`,
      documentId,
      status: "not_implemented",
      message: OCR_QUEUE_NOT_IMPLEMENTED_MESSAGE,
    };
  }

  /** Test helper. */
  jobCount(): number {
    return this.jobCounter;
  }
}

export function createStubOcrQueue(): StubOcrQueue {
  return new StubOcrQueue();
}
