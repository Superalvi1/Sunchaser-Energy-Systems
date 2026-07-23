/**
 * Knowledge document entity — the atomic unit of the Enterprise Knowledge Platform.
 */

import {
  isKnowledgeCollection,
  isKnowledgeSource,
  isKnowledgeStatus,
  isKnowledgeVisibility,
  isNonEmptyString,
  isSupportedKnowledgeMimeType,
  KNOWLEDGE_DEFAULT_TIMESTAMP,
  normalizeKnowledgeTags,
  type KnowledgeCollection,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeVisibility,
  type SupportedKnowledgeMimeType,
} from "./KnowledgeModels.ts";

export interface KnowledgeDocument {
  id: string;
  title: string;
  collection: KnowledgeCollection;
  owner: string;
  visibility: KnowledgeVisibility;
  department: string;
  companyId: string;
  tags: string[];
  mimeType: SupportedKnowledgeMimeType;
  createdAt: string;
  updatedAt: string;
  checksum: string;
  language: string;
  source: KnowledgeSource;
  status: KnowledgeStatus;
}

export type KnowledgeDocumentInput = Omit<KnowledgeDocument, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface KnowledgeDocumentValidationResult {
  ok: true;
  document: KnowledgeDocument;
}

export interface KnowledgeDocumentValidationError {
  ok: false;
  errors: string[];
}

export type KnowledgeDocumentValidation =
  | KnowledgeDocumentValidationResult
  | KnowledgeDocumentValidationError;

function pushError(errors: string[], message: string): void {
  errors.push(message);
}

export function validateKnowledgeDocument(input: KnowledgeDocumentInput): KnowledgeDocumentValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(input.id)) pushError(errors, "id is required");
  if (!isNonEmptyString(input.title)) pushError(errors, "title is required");
  if (!isKnowledgeCollection(input.collection)) pushError(errors, "collection is invalid");
  if (!isNonEmptyString(input.owner)) pushError(errors, "owner is required");
  if (!isKnowledgeVisibility(input.visibility)) pushError(errors, "visibility is invalid");
  if (!isNonEmptyString(input.department)) pushError(errors, "department is required");
  if (!isNonEmptyString(input.companyId)) pushError(errors, "companyId is required");
  if (!Array.isArray(input.tags)) pushError(errors, "tags must be an array");
  if (!isSupportedKnowledgeMimeType(input.mimeType)) pushError(errors, "mimeType is not supported");
  if (!isNonEmptyString(input.checksum)) pushError(errors, "checksum is required");
  if (!isNonEmptyString(input.language)) pushError(errors, "language is required");
  if (!isKnowledgeSource(input.source)) pushError(errors, "source is invalid");
  if (!isKnowledgeStatus(input.status)) pushError(errors, "status is invalid");

  if (errors.length > 0) return { ok: false, errors };

  const timestamp = input.createdAt ?? input.updatedAt ?? KNOWLEDGE_DEFAULT_TIMESTAMP;

  return {
    ok: true,
    document: {
      id: input.id.trim(),
      title: input.title.trim(),
      collection: input.collection,
      owner: input.owner.trim(),
      visibility: input.visibility,
      department: input.department.trim(),
      companyId: input.companyId.trim(),
      tags: normalizeKnowledgeTags(input.tags),
      mimeType: input.mimeType,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
      checksum: input.checksum.trim(),
      language: input.language.trim().toLowerCase(),
      source: input.source,
      status: input.status,
    },
  };
}

export function createKnowledgeDocument(input: KnowledgeDocumentInput): KnowledgeDocument {
  const result = validateKnowledgeDocument(input);
  if (!result.ok) {
    throw new Error(`Invalid knowledge document: ${(result as any).errors.join("; ")}`);
  }
  return result.document;
}

export function isActiveKnowledgeDocument(document: KnowledgeDocument): boolean {
  return document.status === "active";
}

export function isKnowledgeDocumentArchived(document: KnowledgeDocument): boolean {
  return document.status === "archived";
}
