/**
 * Document Processing Pipeline — public surface.
 *
 * Pure architecture: Upload → Virus Scan → Checksum → Duplicate Detection →
 * Versioning → Storage Provider → Permission Assignment → Knowledge
 * Repository → Event Bus → (future) OCR Queue → (future) Embedding Queue.
 *
 * No virus-scanning engine, cloud storage, OCR, or embedding model is wired.
 * Every stage is dependency-injected; swap defaults for real implementations
 * without touching the orchestrator.
 */

export * from "./DocumentModels.ts";
export * from "./DocumentUpload.ts";
export * from "./VirusScanner.ts";
export * from "./Checksum.ts";
export * from "./DuplicateDetector.ts";
export * from "./DocumentVersioning.ts";
export * from "./StorageProvider.ts";
export * from "./PermissionAssignment.ts";
export * from "./KnowledgeRepositoryStage.ts";
export * from "./DocumentEventBus.ts";
export * from "./OcrQueue.ts";
export * from "./EmbeddingQueue.ts";
export * from "./DocumentProcessingPipeline.ts";
