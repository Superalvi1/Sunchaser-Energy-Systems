/** Frontend knowledge domain types — aligned with server/knowledge models.
 *
 * PROTOTYPE UI ONLY: used by KnowledgeStaff + knowledgeMock when
 * VITE_ENABLE_KNOWLEDGE_MOCK_UI=true. Not a production data contract until
 * real API routes are wired to server/knowledge.
 */

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

export type KnowledgeVisibility =
  | "private"
  | "department"
  | "company"
  | "role_restricted"
  | "customer_scoped";

export type KnowledgeStatus = "draft" | "active" | "archived" | "deleted" | "pending_index";

export type KnowledgeSource =
  | "upload"
  | "crm_generated"
  | "email_ingest"
  | "google_drive"
  | "sharepoint"
  | "dropbox";

export interface KnowledgeFolder {
  id: string;
  name: string;
  parentId: string | null;
  collection?: KnowledgeCollection;
  documentCount: number;
  children?: KnowledgeFolder[];
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  collection: KnowledgeCollection;
  folderId: string;
  owner: string;
  visibility: KnowledgeVisibility;
  department: string;
  tags: string[];
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
  pageCount?: number;
  createdAt: string;
  updatedAt: string;
  source: KnowledgeSource;
  status: KnowledgeStatus;
  version: number;
  summary?: string;
}

export interface KnowledgeVersion {
  id: string;
  documentId: string;
  version: number;
  title: string;
  fileName: string;
  fileSizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  changeNote: string;
  checksum: string;
}

export interface KnowledgeTag {
  name: string;
  count: number;
}

export interface KnowledgeSearchFilters {
  query?: string;
  collection?: KnowledgeCollection | "all";
  folderId?: string | "all";
  status?: KnowledgeStatus | "all";
  visibility?: KnowledgeVisibility | "all";
  tags?: string[];
  source?: KnowledgeSource | "all";
}

export interface KnowledgeUploadInput {
  file: File;
  title: string;
  collection: KnowledgeCollection;
  folderId: string;
  tags: string[];
  visibility: KnowledgeVisibility;
  changeNote?: string;
}

export interface KnowledgeCollectionSummary {
  name: KnowledgeCollection;
  documentCount: number;
  folderCount: number;
}
