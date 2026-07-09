/**
 * Document Processing Pipeline — orchestrator.
 *
 * Runs every stage in the fixed order:
 *
 *   upload → virus_scan → checksum → duplicate_detection → versioning →
 *   storage → permission_assignment → knowledge_repository → event_bus →
 *   ocr_queue → embedding_queue
 *
 * Every dependency is injected; all defaults are the architecture-only
 * implementations defined alongside each stage (Null/InMemory/Stub). Nothing
 * here performs real virus scanning, cloud storage, OCR, or embeddings.
 *
 * On failure, the pipeline stops at the failing stage, best-effort rolls back
 * any storage write already made for this attempt, publishes a
 * "pipeline.failed" event, and returns a structured failure — it never
 * throws out of process().
 */

import type { RequestActor } from "../middleware/actor.ts";
import type { KnowledgeDocumentInput } from "../knowledge/KnowledgeDocument.ts";
import type { KnowledgeDocumentMetadata } from "../knowledge/KnowledgeMetadata.ts";
import type { KnowledgeRepository, KnowledgeSaveResult } from "../knowledge/KnowledgeRepository.ts";
import { InMemoryKnowledgeRepository } from "../knowledge/KnowledgeRepository.ts";

import { DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP, DocumentPipelineError, type DocumentPipelineStage } from "./DocumentModels.ts";
import { intakeUpload, type UploadRequest, type UploadedFile } from "./DocumentUpload.ts";
import { NULL_VIRUS_SCANNER, assertScanClean, type VirusScanner, type VirusScanResult } from "./VirusScanner.ts";
import { computeChecksumResult, type ChecksumResult } from "./Checksum.ts";
import {
  createInMemoryDuplicateIndex,
  detectDuplicate,
  type DuplicateDetectionResult,
  type DuplicateIndex,
} from "./DuplicateDetector.ts";
import {
  createInMemoryVersionRegistry,
  resolveNextVersion,
  type VersionChainEntry,
  type VersionRegistry,
} from "./DocumentVersioning.ts";
import {
  buildStorageKey,
  createInMemoryStorageProvider,
  type StorageProvider,
  type StorageRef,
} from "./StorageProvider.ts";
import { assignPermissions, type PermissionAssignmentResult } from "./PermissionAssignment.ts";
import { saveToKnowledgeRepository } from "./KnowledgeRepositoryStage.ts";
import {
  createDocumentPipelineEvent,
  createInMemoryDocumentEventBus,
  type DocumentEventBus,
  type DocumentPipelineEvent,
  type DocumentPipelineEventType,
} from "./DocumentEventBus.ts";
import { createStubOcrQueue, type OcrJob, type OcrQueue } from "./OcrQueue.ts";
import { createStubEmbeddingQueue, type EmbeddingJob, type EmbeddingQueue } from "./EmbeddingQueue.ts";

export interface DocumentProcessingPipelineOptions {
  virusScanner?: VirusScanner;
  duplicateIndex?: DuplicateIndex;
  versionRegistry?: VersionRegistry;
  storageProvider?: StorageProvider;
  repository?: KnowledgeRepository;
  eventBus?: DocumentEventBus;
  ocrQueue?: OcrQueue;
  embeddingQueue?: EmbeddingQueue;
  /** Injected clock for deterministic tests; defaults to a fixed epoch string. */
  now?: () => string;
  /** Injected id generator for new families; defaults to an internal counter. */
  familyIdGenerator?: () => string;
}

export interface DocumentPipelineSuccess {
  ok: true;
  familyId: string;
  document: KnowledgeDocumentInput;
  metadata: KnowledgeDocumentMetadata;
  saveResult: KnowledgeSaveResult;
  checksum: ChecksumResult;
  scan: VirusScanResult;
  duplicate: DuplicateDetectionResult;
  version: VersionChainEntry;
  storageRef: StorageRef;
  permissions: PermissionAssignmentResult;
  ocrJob: OcrJob;
  embeddingJob: EmbeddingJob;
  events: DocumentPipelineEvent[];
}

/** Short-circuit success: an unchanged re-upload of the same family+checksum. */
export interface DocumentPipelineDuplicateShortCircuit {
  ok: true;
  familyId: string;
  duplicate: DuplicateDetectionResult;
  shortCircuited: true;
  events: DocumentPipelineEvent[];
}

export interface DocumentPipelineFailure {
  ok: false;
  stage: DocumentPipelineStage;
  reason: string;
  events: DocumentPipelineEvent[];
}

export type DocumentPipelineResult =
  | DocumentPipelineSuccess
  | DocumentPipelineDuplicateShortCircuit
  | DocumentPipelineFailure;

export interface DocumentPipelineProcessInput {
  upload: UploadRequest;
  actor: RequestActor;
  /** When true, proceed through storage/versioning even if unchanged from the same family. */
  allowDuplicateReupload?: boolean;
  /** Deterministic id for the new document/version. Required — pipelines do not invent ids. */
  documentId: string;
}

export class DocumentProcessingPipeline {
  private readonly virusScanner: VirusScanner;
  private readonly duplicateIndex: DuplicateIndex;
  private readonly versionRegistry: VersionRegistry;
  private readonly storageProvider: StorageProvider;
  private readonly repository: KnowledgeRepository;
  private readonly eventBus: DocumentEventBus;
  private readonly ocrQueue: OcrQueue;
  private readonly embeddingQueue: EmbeddingQueue;
  private readonly now: () => string;
  private readonly familyIdGenerator: () => string;
  private familyCounter = 0;
  private eventCounter = 0;

  constructor(options: DocumentProcessingPipelineOptions = {}) {
    this.virusScanner = options.virusScanner ?? NULL_VIRUS_SCANNER;
    this.duplicateIndex = options.duplicateIndex ?? createInMemoryDuplicateIndex();
    this.versionRegistry = options.versionRegistry ?? createInMemoryVersionRegistry();
    this.storageProvider = options.storageProvider ?? createInMemoryStorageProvider();
    this.repository = options.repository ?? new InMemoryKnowledgeRepository();
    this.eventBus = options.eventBus ?? createInMemoryDocumentEventBus();
    this.ocrQueue = options.ocrQueue ?? createStubOcrQueue();
    this.embeddingQueue = options.embeddingQueue ?? createStubEmbeddingQueue();
    this.now = options.now ?? (() => DOCUMENT_PIPELINE_DEFAULT_TIMESTAMP);
    this.familyIdGenerator = options.familyIdGenerator ?? (() => this.nextFamilyId());
  }

  private nextFamilyId(): string {
    this.familyCounter += 1;
    return `family-${this.familyCounter}`;
  }

  private nextEventId(): string {
    this.eventCounter += 1;
    return `pevt-${this.eventCounter}`;
  }

  private emit(
    type: DocumentPipelineEventType,
    familyId: string,
    actorId: string,
    companyId: string,
    payload: Record<string, string | number | boolean> = {}
  ): DocumentPipelineEvent {
    const event = createDocumentPipelineEvent({
      id: this.nextEventId(),
      type,
      familyId,
      actorId,
      companyId,
      occurredAt: this.now(),
      payload,
    });
    this.eventBus.publish(event);
    return event;
  }

  process(input: DocumentPipelineProcessInput): DocumentPipelineResult {
    const events: DocumentPipelineEvent[] = [];
    let familyId = input.upload.familyId ?? this.familyIdGenerator();
    let companyId = input.upload.companyId;
    let storedKey: string | null = null;

    try {
      // Stage 1: upload
      const file: UploadedFile = intakeUpload(input.upload);
      familyId = file.familyId ?? familyId;
      companyId = file.companyId;
      events.push(this.emit("pipeline.upload_received", familyId, input.actor.id, companyId, {
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
      }));

      // Stage 2: virus scan
      const scan = this.virusScanner.scan(file);
      assertScanClean(scan);
      events.push(this.emit("pipeline.virus_scan_completed", familyId, input.actor.id, companyId, {
        status: scan.status,
        engine: scan.engine,
      }));

      // Stage 3: checksum
      const checksum = computeChecksumResult(file.content);
      events.push(this.emit("pipeline.checksum_computed", familyId, input.actor.id, companyId, {
        value: checksum.value,
      }));

      // Stage 4: duplicate detection
      const duplicate = detectDuplicate(this.duplicateIndex, companyId, checksum.value, familyId);
      events.push(this.emit("pipeline.duplicate_detected", familyId, input.actor.id, companyId, {
        isDuplicate: duplicate.isDuplicate,
        crossFamilyMatchCount: duplicate.crossFamilyMatches.length,
      }));
      if (duplicate.isDuplicate && !input.allowDuplicateReupload) {
        events.push(this.emit("pipeline.completed", familyId, input.actor.id, companyId, { shortCircuited: true }));
        return { ok: true, familyId, duplicate, shortCircuited: true, events };
      }

      // Stage 5: versioning
      const version = resolveNextVersion({
        registry: this.versionRegistry,
        familyId,
        versionId: input.documentId,
        checksum: checksum.value,
        now: this.now(),
      });
      events.push(this.emit("pipeline.version_resolved", familyId, input.actor.id, companyId, {
        versionNumber: version.versionNumber,
      }));

      // Stage 6: storage
      const key = buildStorageKey(companyId, familyId, version.versionNumber);
      const storageRef = this.storageProvider.store(key, file.content, this.now());
      storedKey = key;
      events.push(this.emit("pipeline.stored", familyId, input.actor.id, companyId, {
        key: storageRef.key,
        sizeBytes: storageRef.sizeBytes,
      }));

      // Stage 7: permission assignment
      const permissions = assignPermissions({
        requestedVisibility: file.requestedVisibility,
        linkedResource: file.linkedResource,
        allowedRoles: file.allowedRoles,
      });
      events.push(this.emit("pipeline.permissions_assigned", familyId, input.actor.id, companyId, {
        visibility: permissions.visibility,
      }));

      // Stage 8: knowledge repository
      const documentInput: KnowledgeDocumentInput = {
        id: input.documentId,
        title: file.fileName,
        collection: file.collection,
        owner: file.ownerId,
        visibility: permissions.visibility,
        department: file.department,
        companyId,
        tags: file.tags,
        mimeType: file.mimeType,
        checksum: checksum.value,
        language: file.language,
        source: "upload",
        status: "active",
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      const metadata: KnowledgeDocumentMetadata = {
        documentId: input.documentId,
        fileName: file.fileName,
        fileSizeBytes: file.sizeBytes,
        linkedResource: file.linkedResource,
        allowedRoles: permissions.allowedRoles,
      };
      const saveResult = saveToKnowledgeRepository(this.repository, {
        documentInput,
        metadata,
        actor: input.actor,
      });
      events.push(this.emit("pipeline.repository_saved", familyId, input.actor.id, companyId, {
        documentId: saveResult.document.id,
      }));

      // Commit duplicate index + version registry now that the write succeeded.
      this.duplicateIndex.register({ documentId: input.documentId, familyId, checksum: checksum.value, companyId });
      this.versionRegistry.record(version);

      // Stage 9: event bus already used throughout; nothing further to publish
      // beyond the completion event below.

      // Stage 10: OCR queue (future — stub only)
      const ocrJob = this.ocrQueue.enqueue(saveResult.document.id, input.actor.id);
      events.push(this.emit("pipeline.ocr_enqueued", familyId, input.actor.id, companyId, {
        jobId: ocrJob.jobId,
        status: ocrJob.status,
      }));

      // Stage 11: embedding queue (future — stub only)
      const embeddingJob = this.embeddingQueue.enqueue(saveResult.document.id, input.actor.id);
      events.push(this.emit("pipeline.embedding_enqueued", familyId, input.actor.id, companyId, {
        jobId: embeddingJob.jobId,
        status: embeddingJob.status,
      }));

      events.push(this.emit("pipeline.completed", familyId, input.actor.id, companyId, {
        documentId: saveResult.document.id,
        versionNumber: version.versionNumber,
      }));

      return {
        ok: true,
        familyId,
        document: documentInput,
        metadata,
        saveResult,
        checksum,
        scan,
        duplicate,
        version,
        storageRef,
        permissions,
        ocrJob,
        embeddingJob,
        events,
      };
    } catch (err) {
      // Best-effort rollback: never leave orphaned bytes for this attempt.
      if (storedKey) {
        this.storageProvider.delete(storedKey);
      }
      const stage: DocumentPipelineStage = err instanceof DocumentPipelineError ? err.stage : "upload";
      const reason = err instanceof Error ? err.message : String(err);
      events.push(this.emit("pipeline.failed", familyId, input.actor.id, companyId, { stage, reason }));
      return { ok: false, stage, reason, events };
    }
  }
}

export function createDocumentProcessingPipeline(
  options?: DocumentProcessingPipelineOptions
): DocumentProcessingPipeline {
  return new DocumentProcessingPipeline(options);
}
