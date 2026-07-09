/**
 * Document Processing Pipeline — shared types and constants.
 *
 * Architecture only: this module defines the stage taxonomy and the error
 * shape every stage reports through. No storage, scanning, OCR, or embedding
 * engines are implemented here.
 */

/** Fixed deterministic timestamp for pure constructors and tests. */
export const DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

/** Ordered pipeline stages, matching the fixed processing order. */
export const DOCUMENT_PIPELINE_STAGES = [
  "upload",
  "virus_scan",
  "checksum",
  "duplicate_detection",
  "versioning",
  "storage",
  "permission_assignment",
  "knowledge_repository",
  "event_bus",
  "ocr_queue",
  "embedding_queue",
] as const;

export type DocumentPipelineStage = (typeof DOCUMENT_PIPELINE_STAGES)[number];

export const DOCUMENT_PIPELINE_STAGE_SET = new Set<string>(DOCUMENT_PIPELINE_STAGES);

export function isDocumentPipelineStage(value: string): value is DocumentPipelineStage {
  return DOCUMENT_PIPELINE_STAGE_SET.has(value);
}

/** Returns true when `a` occurs before `b` in the fixed stage order. */
export function stageIsBefore(a: DocumentPipelineStage, b: DocumentPipelineStage): boolean {
  return DOCUMENT_PIPELINE_STAGES.indexOf(a) < DOCUMENT_PIPELINE_STAGES.indexOf(b);
}

/** Structured failure raised by any pipeline stage. */
export class DocumentPipelineError extends Error {
  readonly stage: DocumentPipelineStage;
  readonly reason: string;
  readonly details?: Record<string, unknown>;

  constructor(stage: DocumentPipelineStage, reason: string, details?: Record<string, unknown>) {
    super(`[${stage}] ${reason}`);
    this.name = "DocumentPipelineError";
    this.stage = stage;
    this.reason = reason;
    this.details = details;
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
