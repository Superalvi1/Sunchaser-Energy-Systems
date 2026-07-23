/**
 * Extended metadata for knowledge documents — CRM links, future cloud refs.
 */

import type { KnowledgeDocument } from "./KnowledgeDocument.ts";
import { isNonEmptyString } from "./KnowledgeModels.ts";

/** Optional linkage to CRM entities for ownership-scoped documents. */
export type KnowledgeLinkedResourceType =
  | "lead"
  | "project"
  | "customer"
  | "invoice"
  | "quotation"
  | "purchase_order"
  | "service_request"
  | "support_ticket"
  | "warranty"
  | "delivery";

export const KNOWLEDGE_LINKED_RESOURCE_TYPES: readonly KnowledgeLinkedResourceType[] = [
  "lead",
  "project",
  "customer",
  "invoice",
  "quotation",
  "purchase_order",
  "service_request",
  "support_ticket",
  "warranty",
  "delivery",
] as const;

export interface KnowledgeLinkedResource {
  type: KnowledgeLinkedResourceType;
  id: string;
  customerId?: string;
}

/** Future cloud storage reference — not wired in V5. */
export interface KnowledgeExternalRef {
  provider: "google_drive" | "sharepoint" | "dropbox";
  externalId: string;
  externalPath?: string;
  syncStatus: "pending" | "synced" | "error";
}

export interface KnowledgeDocumentMetadata {
  documentId: string;
  fileName: string;
  fileSizeBytes: number;
  pageCount?: number;
  linkedResource?: KnowledgeLinkedResource;
  externalRef?: KnowledgeExternalRef;
  /** Role names allowed when visibility is role_restricted. */
  allowedRoles?: string[];
  customFields?: Record<string, string>;
}

export type KnowledgeDocumentMetadataInput = KnowledgeDocumentMetadata;

export interface KnowledgeMetadataValidationResult {
  ok: true;
  metadata: KnowledgeDocumentMetadata;
}

export interface KnowledgeMetadataValidationError {
  ok: false;
  errors: string[];
}

export type KnowledgeMetadataValidation = KnowledgeMetadataValidationResult | KnowledgeMetadataValidationError;

export function isKnowledgeLinkedResourceType(value: string): value is KnowledgeLinkedResourceType {
  return (KNOWLEDGE_LINKED_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function validateKnowledgeDocumentMetadata(
  input: KnowledgeDocumentMetadataInput
): KnowledgeMetadataValidation {
  const errors: string[] = [];

  if (!isNonEmptyString(input.documentId)) errors.push("documentId is required");
  if (!isNonEmptyString(input.fileName)) errors.push("fileName is required");
  if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes < 0) {
    errors.push("fileSizeBytes must be a non-negative number");
  }
  if (input.pageCount !== undefined && (!Number.isInteger(input.pageCount) || input.pageCount < 0)) {
    errors.push("pageCount must be a non-negative integer when provided");
  }
  if (input.linkedResource) {
    if (!isKnowledgeLinkedResourceType(input.linkedResource.type)) {
      errors.push("linkedResource.type is invalid");
    }
    if (!isNonEmptyString(input.linkedResource.id)) {
      errors.push("linkedResource.id is required");
    }
  }
  if (input.allowedRoles !== undefined && !Array.isArray(input.allowedRoles)) {
    errors.push("allowedRoles must be an array when provided");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    metadata: {
      documentId: input.documentId.trim(),
      fileName: input.fileName.trim(),
      fileSizeBytes: input.fileSizeBytes,
      pageCount: input.pageCount,
      linkedResource: input.linkedResource
        ? {
            type: input.linkedResource.type,
            id: input.linkedResource.id.trim(),
            customerId: input.linkedResource.customerId?.trim() || undefined,
          }
        : undefined,
      externalRef: input.externalRef,
      allowedRoles: input.allowedRoles?.map((r) => r.trim()).filter(Boolean),
      customFields: input.customFields,
    },
  };
}

export function createKnowledgeDocumentMetadata(input: KnowledgeDocumentMetadataInput): KnowledgeDocumentMetadata {
  const result = validateKnowledgeDocumentMetadata(input);
  if (!result.ok) {
    throw new Error(`Invalid knowledge metadata: ${(result as any).errors.join("; ")}`);
  }
  return result.metadata;
}

/** Bundle document + metadata for repository storage. */
export interface KnowledgeDocumentRecord {
  document: KnowledgeDocument;
  metadata: KnowledgeDocumentMetadata;
}

export function knowledgeDocumentRecordIdsMatch(record: KnowledgeDocumentRecord): boolean {
  return record.document.id === record.metadata.documentId;
}
