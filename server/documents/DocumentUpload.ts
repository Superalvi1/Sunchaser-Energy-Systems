/**
 * Stage 1 — Upload intake.
 *
 * Validates and normalizes an incoming upload request into an UploadedFile
 * before it enters the rest of the pipeline. No storage happens here.
 */

import {
  isKnowledgeCollection,
  isSupportedKnowledgeMimeType,
  type KnowledgeCollection,
  type SupportedKnowledgeMimeType,
} from "../knowledge/KnowledgeModels.ts";
import type { KnowledgeLinkedResource } from "../knowledge/KnowledgeMetadata.ts";
import { DocumentPipelineError, isNonEmptyString, isPositiveInteger } from "./DocumentModels.ts";

/** Default cap for a single upload. Override per deployment. */
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB

export interface UploadRequest {
  fileName: string;
  mimeType: string;
  content: Buffer;
  collection: string;
  ownerId: string;
  companyId: string;
  department: string;
  tags?: string[];
  language?: string;
  /** Existing document family to version into. Omit to start a new family. */
  familyId?: string;
  linkedResource?: KnowledgeLinkedResource;
  /** Explicit visibility request; PermissionAssignment may still override it. */
  requestedVisibility?: string;
  allowedRoles?: string[];
}

export interface UploadedFile {
  fileName: string;
  mimeType: SupportedKnowledgeMimeType;
  content: Buffer;
  sizeBytes: number;
  collection: KnowledgeCollection;
  ownerId: string;
  companyId: string;
  department: string;
  tags: string[];
  language: string;
  familyId?: string;
  linkedResource?: KnowledgeLinkedResource;
  requestedVisibility?: string;
  allowedRoles?: string[];
}

export interface UploadValidationResult {
  ok: true;
  file: UploadedFile;
}

export interface UploadValidationError {
  ok: false;
  errors: string[];
}

export type UploadValidation = UploadValidationResult | UploadValidationError;

export function validateUploadRequest(
  input: UploadRequest,
  maxSizeBytes: number = MAX_UPLOAD_SIZE_BYTES
): UploadValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(input.fileName)) errors.push("fileName is required");
  if (!isNonEmptyString(input.mimeType) || !isSupportedKnowledgeMimeType(input.mimeType)) {
    errors.push("mimeType is not supported");
  }
  if (!Buffer.isBuffer(input.content)) errors.push("content must be a Buffer");
  if (!isNonEmptyString(input.collection) || !isKnowledgeCollection(input.collection)) {
    errors.push("collection is invalid");
  }
  if (!isNonEmptyString(input.ownerId)) errors.push("ownerId is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.department)) errors.push("department is required");
  if (input.tags !== undefined && !Array.isArray(input.tags)) errors.push("tags must be an array when provided");
  if (input.familyId !== undefined && !isNonEmptyString(input.familyId)) {
    errors.push("familyId must be a non-empty string when provided");
  }
  if (input.allowedRoles !== undefined && !Array.isArray(input.allowedRoles)) {
    errors.push("allowedRoles must be an array when provided");
  }

  if (Buffer.isBuffer(input.content)) {
    if (input.content.byteLength === 0) errors.push("content must not be empty");
    if (input.content.byteLength > maxSizeBytes) {
      errors.push(`content exceeds max upload size of ${maxSizeBytes} bytes`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    file: {
      fileName: input.fileName.trim(),
      mimeType: input.mimeType as SupportedKnowledgeMimeType,
      content: input.content,
      sizeBytes: input.content.byteLength,
      collection: input.collection as KnowledgeCollection,
      ownerId: input.ownerId.trim(),
      companyId: input.companyId.trim(),
      department: input.department.trim(),
      tags: (input.tags ?? []).map((t) => String(t).trim()).filter(Boolean),
      language: (input.language ?? "en").trim().toLowerCase(),
      familyId: input.familyId?.trim() || undefined,
      linkedResource: input.linkedResource,
      requestedVisibility: input.requestedVisibility,
      allowedRoles: input.allowedRoles,
    },
  };
}

/** Throws DocumentPipelineError("upload", ...) on invalid input. */
export function intakeUpload(input: UploadRequest, maxSizeBytes?: number): UploadedFile {
  const result = validateUploadRequest(input, maxSizeBytes);
  if (!result.ok) {
    throw new DocumentPipelineError("upload", result.errors.join("; "), { errors: result.errors });
  }
  return result.file;
}

/** Convenience builder for tests. */
export function buildUploadRequest(overrides: Partial<UploadRequest> = {}): UploadRequest {
  return {
    fileName: "manual.pdf",
    mimeType: "application/pdf",
    content: Buffer.from("test-content"),
    collection: "General",
    ownerId: "user-1",
    companyId: "company-1",
    department: "Operations",
    tags: [],
    language: "en",
    ...overrides,
  };
}
