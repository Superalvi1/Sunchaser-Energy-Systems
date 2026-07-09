/**
 * Enterprise Knowledge Platform (V5) — core domain models.
 *
 * Architecture only: no embeddings, vectors, LLM, OCR, parsing, or search.
 * Pure TypeScript types and validation helpers.
 */

/** Supported knowledge collections — the company's document taxonomy. */
export const KNOWLEDGE_COLLECTIONS = [
  "Policies",
  "SOPs",
  "Projects",
  "Customers",
  "Finance",
  "Engineering",
  "Products",
  "Inventory",
  "Sales",
  "Support",
  "Procurement",
  "HR",
  "Legal",
  "General",
] as const;

export type KnowledgeCollection = (typeof KNOWLEDGE_COLLECTIONS)[number];

export const KNOWLEDGE_COLLECTION_SET = new Set<string>(KNOWLEDGE_COLLECTIONS);

/** Who may see a document within the company. */
export type KnowledgeVisibility =
  | "private"
  | "department"
  | "company"
  | "role_restricted"
  | "customer_scoped";

export const KNOWLEDGE_VISIBILITIES: readonly KnowledgeVisibility[] = [
  "private",
  "department",
  "company",
  "role_restricted",
  "customer_scoped",
] as const;

/** Where the document originated. Future cloud sources are reserved but not wired. */
export type KnowledgeSource =
  | "upload"
  | "crm_generated"
  | "email_ingest"
  | "google_drive"
  | "sharepoint"
  | "dropbox";

export const KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = [
  "upload",
  "crm_generated",
  "email_ingest",
  "google_drive",
  "sharepoint",
  "dropbox",
] as const;

/** Document lifecycle status. `pending_index` reserved for future indexer wiring. */
export type KnowledgeStatus =
  | "draft"
  | "active"
  | "archived"
  | "deleted"
  | "pending_index";

export const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = [
  "draft",
  "active",
  "archived",
  "deleted",
  "pending_index",
] as const;

/** Known MIME types the platform will eventually support. */
export const SUPPORTED_KNOWLEDGE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
  "message/rfc822",
  "text/plain",
  "application/octet-stream",
] as const;

export type SupportedKnowledgeMimeType = (typeof SUPPORTED_KNOWLEDGE_MIME_TYPES)[number];

export const SUPPORTED_KNOWLEDGE_MIME_TYPE_SET = new Set<string>(SUPPORTED_KNOWLEDGE_MIME_TYPES);

/** Fixed deterministic timestamp for tests and pure constructors. */
export const KNOWLEDGE_DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export function isKnowledgeCollection(value: string): value is KnowledgeCollection {
  return KNOWLEDGE_COLLECTION_SET.has(value);
}

export function isKnowledgeVisibility(value: string): value is KnowledgeVisibility {
  return (KNOWLEDGE_VISIBILITIES as readonly string[]).includes(value);
}

export function isKnowledgeSource(value: string): value is KnowledgeSource {
  return (KNOWLEDGE_SOURCES as readonly string[]).includes(value);
}

export function isKnowledgeStatus(value: string): value is KnowledgeStatus {
  return (KNOWLEDGE_STATUSES as readonly string[]).includes(value);
}

export function isSupportedKnowledgeMimeType(value: string): value is SupportedKnowledgeMimeType {
  return SUPPORTED_KNOWLEDGE_MIME_TYPE_SET.has(value);
}

export function normalizeKnowledgeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const tag = String(raw || "").trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized.sort();
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
