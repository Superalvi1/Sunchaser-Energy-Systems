/**
 * MOCK KNOWLEDGE BACKEND — FRONTEND PROTOTYPE ONLY
 *
 * This module is NOT server/knowledge. It does not call the backend architecture
 * layer, does not enforce real OwnershipResolvers, and must never be treated
 * as a production data source.
 *
 * - Data: in-memory seed + browser session mutations only
 * - Permissions: simulated client-side filters (not server/knowledge)
 * - Replace with real API calls when server/knowledge routes are wired
 *
 * Enable UI: VITE_ENABLE_KNOWLEDGE_MOCK_UI=true (default: false)
 */

import { isKnowledgeMockUiEnabled } from "../lib/knowledgeFeatureFlag";

import type {
  KnowledgeCollection,
  KnowledgeCollectionSummary,
  KnowledgeDocument,
  KnowledgeFolder,
  KnowledgeSearchFilters,
  KnowledgeTag,
  KnowledgeUploadInput,
  KnowledgeVersion,
} from "../lib/knowledgeTypes";
import { KNOWLEDGE_COLLECTIONS } from "../lib/knowledgeTypes";

const MOCK_DELAY_MS = 280;

/** Identifies mock responses — not production CRM or server/knowledge data. */
export const KNOWLEDGE_MOCK_DATA_SOURCE = "prototype-in-memory" as const;

function assertMockUiEnabled(): void {
  if (!isKnowledgeMockUiEnabled()) {
    throw new Error(
      "Knowledge mock API called while VITE_ENABLE_KNOWLEDGE_MOCK_UI is disabled. " +
        "Mock data is not a production source."
    );
  }
}

function delay<T>(value: T, ms = MOCK_DELAY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out.sort();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { formatBytes };

// --- Seed data ---

const foldersFlat: KnowledgeFolder[] = [
  { id: "root", name: "Company Library", parentId: null, documentCount: 0 },
  { id: "fld-policies", name: "Policies", parentId: "root", collection: "Policies", documentCount: 2 },
  { id: "fld-sops", name: "SOPs", parentId: "root", collection: "SOPs", documentCount: 2 },
  { id: "fld-projects", name: "Projects", parentId: "root", collection: "Projects", documentCount: 3 },
  { id: "fld-residential", name: "Residential", parentId: "fld-projects", documentCount: 1 },
  { id: "fld-commercial", name: "Commercial", parentId: "fld-projects", documentCount: 2 },
  { id: "fld-finance", name: "Finance", parentId: "root", collection: "Finance", documentCount: 2 },
  { id: "fld-engineering", name: "Engineering", parentId: "root", collection: "Engineering", documentCount: 2 },
  { id: "fld-products", name: "Products", parentId: "root", collection: "Products", documentCount: 1 },
  { id: "fld-support", name: "Support", parentId: "root", collection: "Support", documentCount: 1 },
];

let documents: KnowledgeDocument[] = [
  {
    id: "doc-1",
    title: "Employee Handbook 2026",
    collection: "HR",
    folderId: "fld-policies",
    owner: "Priya Sharma",
    visibility: "company",
    department: "HR",
    tags: ["hr", "onboarding", "policy"],
    mimeType: "application/pdf",
    fileName: "employee-handbook-2026.pdf",
    fileSizeBytes: 2_450_000,
    pageCount: 48,
    createdAt: "2026-01-15T09:00:00.000Z",
    updatedAt: "2026-03-01T14:30:00.000Z",
    source: "upload",
    status: "active",
    version: 3,
    summary: "Company policies, leave rules, and code of conduct.",
  },
  {
    id: "doc-2",
    title: "Solar Installation SOP — Rooftop",
    collection: "SOPs",
    folderId: "fld-sops",
    owner: "Rahul Mehta",
    visibility: "department",
    department: "Operations",
    tags: ["sop", "installation", "safety"],
    mimeType: "application/pdf",
    fileName: "sop-rooftop-install.pdf",
    fileSizeBytes: 1_120_000,
    pageCount: 22,
    createdAt: "2025-11-20T08:00:00.000Z",
    updatedAt: "2026-02-10T11:00:00.000Z",
    source: "upload",
    status: "active",
    version: 2,
    summary: "Step-by-step rooftop installation checklist and safety protocol.",
  },
  {
    id: "doc-3",
    title: "Net Metering Application Guide",
    collection: "SOPs",
    folderId: "fld-sops",
    owner: "Anita Desai",
    visibility: "company",
    department: "Sales",
    tags: ["net-metering", "discom", "sales"],
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "net-metering-guide.docx",
    fileSizeBytes: 890_000,
    pageCount: 12,
    createdAt: "2026-02-01T10:00:00.000Z",
    updatedAt: "2026-02-28T16:00:00.000Z",
    source: "crm_generated",
    status: "active",
    version: 1,
    summary: "State-wise net metering application process for sales teams.",
  },
  {
    id: "doc-4",
    title: "Green Valley — 10kW Commercial Proposal",
    collection: "Projects",
    folderId: "fld-commercial",
    owner: "Vikram Singh",
    visibility: "department",
    department: "Sales",
    tags: ["proposal", "commercial", "10kw"],
    mimeType: "application/pdf",
    fileName: "green-valley-10kw-proposal.pdf",
    fileSizeBytes: 3_200_000,
    pageCount: 18,
    createdAt: "2026-03-05T07:30:00.000Z",
    updatedAt: "2026-03-05T07:30:00.000Z",
    source: "crm_generated",
    status: "active",
    version: 1,
    summary: "Signed commercial proposal for Green Valley business park.",
  },
  {
    id: "doc-5",
    title: "Sunrise Homes — Site Survey Report",
    collection: "Projects",
    folderId: "fld-residential",
    owner: "Kavita Nair",
    visibility: "department",
    department: "Engineering",
    tags: ["survey", "residential", "shadow-analysis"],
    mimeType: "application/pdf",
    fileName: "sunrise-homes-survey.pdf",
    fileSizeBytes: 4_500_000,
    pageCount: 24,
    createdAt: "2026-03-08T12:00:00.000Z",
    updatedAt: "2026-03-10T09:15:00.000Z",
    source: "upload",
    status: "active",
    version: 2,
    summary: "Roof measurements, shading analysis, and structural notes.",
  },
  {
    id: "doc-6",
    title: "FY26 Budget & Forecast",
    collection: "Finance",
    folderId: "fld-finance",
    owner: "Arjun Patel",
    visibility: "role_restricted",
    department: "Finance",
    tags: ["budget", "forecast", "confidential"],
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName: "fy26-budget-forecast.xlsx",
    fileSizeBytes: 520_000,
    pageCount: 8,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    source: "upload",
    status: "active",
    version: 4,
    summary: "Annual budget projections and quarterly forecasts.",
  },
  {
    id: "doc-7",
    title: "Invoice Collection Playbook",
    collection: "Finance",
    folderId: "fld-finance",
    owner: "Arjun Patel",
    visibility: "department",
    department: "Finance",
    tags: ["collections", "ar", "playbook"],
    mimeType: "application/pdf",
    fileName: "collections-playbook.pdf",
    fileSizeBytes: 780_000,
    pageCount: 14,
    createdAt: "2025-12-10T08:00:00.000Z",
    updatedAt: "2026-01-20T10:00:00.000Z",
    source: "upload",
    status: "active",
    version: 1,
    summary: "AR aging follow-up scripts and escalation matrix.",
  },
  {
    id: "doc-8",
    title: "Inverter Sizing Calculator — v2",
    collection: "Engineering",
    folderId: "fld-engineering",
    owner: "Rahul Mehta",
    visibility: "company",
    department: "Engineering",
    tags: ["engineering", "inverter", "calculator"],
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName: "inverter-sizing-v2.xlsx",
    fileSizeBytes: 340_000,
    createdAt: "2026-02-15T14:00:00.000Z",
    updatedAt: "2026-03-12T11:30:00.000Z",
    source: "upload",
    status: "active",
    version: 2,
    summary: "Updated sizing tool with hybrid inverter support.",
  },
  {
    id: "doc-9",
    title: "Panel Datasheet — SunMax 550W",
    collection: "Products",
    folderId: "fld-products",
    owner: "Priya Sharma",
    visibility: "company",
    department: "Procurement",
    tags: ["datasheet", "panels", "sunmax"],
    mimeType: "application/pdf",
    fileName: "sunmax-550w-datasheet.pdf",
    fileSizeBytes: 1_800_000,
    pageCount: 6,
    createdAt: "2025-10-01T00:00:00.000Z",
    updatedAt: "2025-10-01T00:00:00.000Z",
    source: "upload",
    status: "active",
    version: 1,
    summary: "Manufacturer specs for SunMax 550W mono PERC panels.",
  },
  {
    id: "doc-10",
    title: "Warranty Claim Process",
    collection: "Support",
    folderId: "fld-support",
    owner: "Anita Desai",
    visibility: "company",
    department: "Support",
    tags: ["warranty", "support", "claims"],
    mimeType: "application/pdf",
    fileName: "warranty-claim-process.pdf",
    fileSizeBytes: 650_000,
    pageCount: 10,
    createdAt: "2026-01-10T09:00:00.000Z",
    updatedAt: "2026-02-05T15:00:00.000Z",
    source: "upload",
    status: "active",
    version: 1,
    summary: "Customer warranty claim intake and OEM escalation flow.",
  },
  {
    id: "doc-11",
    title: "Draft — Q2 Marketing Campaign",
    collection: "Sales",
    folderId: "root",
    owner: "Vikram Singh",
    visibility: "private",
    department: "Sales",
    tags: ["marketing", "draft", "q2"],
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "q2-marketing-draft.docx",
    fileSizeBytes: 420_000,
    createdAt: "2026-03-14T08:00:00.000Z",
    updatedAt: "2026-03-14T08:00:00.000Z",
    source: "upload",
    status: "draft",
    version: 1,
    summary: "Early draft for Q2 residential campaign messaging.",
  },
  {
    id: "doc-12",
    title: "Archived — Old Pricing Sheet 2024",
    collection: "Sales",
    folderId: "root",
    owner: "Vikram Singh",
    visibility: "company",
    department: "Sales",
    tags: ["pricing", "archived"],
    mimeType: "application/pdf",
    fileName: "pricing-2024.pdf",
    fileSizeBytes: 290_000,
    pageCount: 4,
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    source: "upload",
    status: "archived",
    version: 1,
    summary: "Superseded pricing sheet — kept for reference.",
  },
];

const versionsByDoc: Record<string, KnowledgeVersion[]> = {
  "doc-1": [
    { id: "v-1-3", documentId: "doc-1", version: 3, title: "Employee Handbook 2026", fileName: "employee-handbook-2026.pdf", fileSizeBytes: 2_450_000, uploadedBy: "Priya Sharma", uploadedAt: "2026-03-01T14:30:00.000Z", changeNote: "Added remote work policy section", checksum: "sha256:abc123" },
    { id: "v-1-2", documentId: "doc-1", version: 2, title: "Employee Handbook 2026", fileName: "employee-handbook-2026-v2.pdf", fileSizeBytes: 2_300_000, uploadedBy: "Priya Sharma", uploadedAt: "2026-02-01T10:00:00.000Z", changeNote: "Updated leave policy", checksum: "sha256:def456" },
    { id: "v-1-1", documentId: "doc-1", version: 1, title: "Employee Handbook 2025", fileName: "employee-handbook-2025.pdf", fileSizeBytes: 2_100_000, uploadedBy: "Priya Sharma", uploadedAt: "2026-01-15T09:00:00.000Z", changeNote: "Initial upload", checksum: "sha256:ghi789" },
  ],
  "doc-2": [
    { id: "v-2-2", documentId: "doc-2", version: 2, title: "Solar Installation SOP — Rooftop", fileName: "sop-rooftop-install.pdf", fileSizeBytes: 1_120_000, uploadedBy: "Rahul Mehta", uploadedAt: "2026-02-10T11:00:00.000Z", changeNote: "Added harness inspection step", checksum: "sha256:jkl012" },
    { id: "v-2-1", documentId: "doc-2", version: 1, title: "Solar Installation SOP — Rooftop", fileName: "sop-rooftop-install-v1.pdf", fileSizeBytes: 980_000, uploadedBy: "Rahul Mehta", uploadedAt: "2025-11-20T08:00:00.000Z", changeNote: "Initial upload", checksum: "sha256:mno345" },
  ],
  "doc-5": [
    { id: "v-5-2", documentId: "doc-5", version: 2, title: "Sunrise Homes — Site Survey Report", fileName: "sunrise-homes-survey.pdf", fileSizeBytes: 4_500_000, uploadedBy: "Kavita Nair", uploadedAt: "2026-03-10T09:15:00.000Z", changeNote: "Added drone imagery appendix", checksum: "sha256:pqr678" },
    { id: "v-5-1", documentId: "doc-5", version: 1, title: "Sunrise Homes — Site Survey Report", fileName: "sunrise-homes-survey-v1.pdf", fileSizeBytes: 3_800_000, uploadedBy: "Kavita Nair", uploadedAt: "2026-03-08T12:00:00.000Z", changeNote: "Initial survey upload", checksum: "sha256:stu901" },
  ],
  "doc-6": [
    { id: "v-6-4", documentId: "doc-6", version: 4, title: "FY26 Budget & Forecast", fileName: "fy26-budget-forecast.xlsx", fileSizeBytes: 520_000, uploadedBy: "Arjun Patel", uploadedAt: "2026-03-01T00:00:00.000Z", changeNote: "Q1 actuals incorporated", checksum: "sha256:vwx234" },
    { id: "v-6-3", documentId: "doc-6", version: 3, title: "FY26 Budget & Forecast", fileName: "fy26-budget-v3.xlsx", fileSizeBytes: 480_000, uploadedBy: "Arjun Patel", uploadedAt: "2026-02-01T00:00:00.000Z", changeNote: "Revised capex assumptions", checksum: "sha256:yza567" },
    { id: "v-6-2", documentId: "doc-6", version: 2, title: "FY26 Budget & Forecast", fileName: "fy26-budget-v2.xlsx", fileSizeBytes: 450_000, uploadedBy: "Arjun Patel", uploadedAt: "2026-01-15T00:00:00.000Z", changeNote: "Board review edits", checksum: "sha256:bcd890" },
    { id: "v-6-1", documentId: "doc-6", version: 1, title: "FY26 Budget & Forecast", fileName: "fy26-budget-v1.xlsx", fileSizeBytes: 400_000, uploadedBy: "Arjun Patel", uploadedAt: "2026-01-01T00:00:00.000Z", changeNote: "Initial draft", checksum: "sha256:efg123" },
  ],
  "doc-8": [
    { id: "v-8-2", documentId: "doc-8", version: 2, title: "Inverter Sizing Calculator — v2", fileName: "inverter-sizing-v2.xlsx", fileSizeBytes: 340_000, uploadedBy: "Rahul Mehta", uploadedAt: "2026-03-12T11:30:00.000Z", changeNote: "Hybrid inverter tab added", checksum: "sha256:hij456" },
    { id: "v-8-1", documentId: "doc-8", version: 1, title: "Inverter Sizing Calculator", fileName: "inverter-sizing-v1.xlsx", fileSizeBytes: 280_000, uploadedBy: "Rahul Mehta", uploadedAt: "2026-02-15T14:00:00.000Z", changeNote: "Initial upload", checksum: "sha256:klm789" },
  ],
};

function buildFolderTree(): KnowledgeFolder[] {
  const byParent = new Map<string | null, KnowledgeFolder[]>();
  for (const f of foldersFlat) {
    const list = byParent.get(f.parentId) ?? [];
    list.push({ ...f });
    byParent.set(f.parentId, list);
  }

  function attach(parentId: string | null): KnowledgeFolder[] {
    const nodes = byParent.get(parentId) ?? [];
    return nodes.map((node) => {
      const children = attach(node.id);
      const docCount = documents.filter(
        (d) => d.folderId === node.id || children.some((c) => isDescendant(d.folderId, node.id, children))
      ).length;
      return { ...node, documentCount: docCount, children: children.length ? children : undefined };
    });
  }

  function isDescendant(folderId: string, ancestorId: string, children: KnowledgeFolder[]): boolean {
    if (folderId === ancestorId) return true;
    for (const child of children) {
      if (folderId === child.id) return true;
      if (child.children && isDescendant(folderId, ancestorId, child.children)) return true;
    }
    return false;
  }

  return attach(null);
}

function folderDescendantIds(folderId: string): string[] {
  const ids = [folderId];
  const children = foldersFlat.filter((f) => f.parentId === folderId);
  for (const child of children) {
    ids.push(...folderDescendantIds(child.id));
  }
  return ids;
}

function matchesFilters(doc: KnowledgeDocument, filters: KnowledgeSearchFilters): boolean {
  const q = (filters.query ?? "").trim().toLowerCase();
  if (q) {
    const haystack = [doc.title, doc.fileName, doc.summary ?? "", doc.owner, doc.department, ...doc.tags]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  if (filters.collection && filters.collection !== "all" && doc.collection !== filters.collection) {
    return false;
  }

  if (filters.folderId && filters.folderId !== "all") {
    const allowed = folderDescendantIds(filters.folderId);
    if (!allowed.includes(doc.folderId)) return false;
  }

  if (filters.status && filters.status !== "all" && doc.status !== filters.status) return false;
  if (filters.visibility && filters.visibility !== "all" && doc.visibility !== filters.visibility) return false;
  if (filters.source && filters.source !== "all" && doc.source !== filters.source) return false;

  if (filters.tags && filters.tags.length > 0) {
    const docTags = new Set(doc.tags);
    if (!filters.tags.every((t) => docTags.has(t))) return false;
  }

  return true;
}

// --- Public API ---

export async function fetchKnowledgeFolders(): Promise<KnowledgeFolder[]> {
  assertMockUiEnabled();
  return delay(buildFolderTree());
}

export async function fetchKnowledgeCollections(): Promise<KnowledgeCollectionSummary[]> {
  assertMockUiEnabled();
  const summaries: KnowledgeCollectionSummary[] = KNOWLEDGE_COLLECTIONS.map((name) => {
    const docs = documents.filter((d) => d.collection === name);
    const folderIds = new Set(foldersFlat.filter((f) => f.collection === name).map((f) => f.id));
    return {
      name,
      documentCount: docs.length,
      folderCount: folderIds.size,
    };
  });
  return delay(summaries.filter((s) => s.documentCount > 0 || s.folderCount > 0));
}

export async function searchKnowledgeDocuments(
  filters: KnowledgeSearchFilters = {}
): Promise<KnowledgeDocument[]> {
  assertMockUiEnabled();
  const results = documents
    .filter((d) => d.status !== "deleted")
    .filter((d) => matchesFilters(d, filters))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return delay(results);
}

export async function fetchKnowledgeDocument(id: string): Promise<KnowledgeDocument | null> {
  assertMockUiEnabled();
  return delay(documents.find((d) => d.id === id) ?? null);
}

export async function fetchKnowledgeVersionHistory(documentId: string): Promise<KnowledgeVersion[]> {
  assertMockUiEnabled();
  const versions = versionsByDoc[documentId] ?? [];
  const doc = documents.find((d) => d.id === documentId);
  if (versions.length > 0) {
    return delay([...versions].sort((a, b) => b.version - a.version));
  }
  if (!doc) return delay([]);
  const fallback: KnowledgeVersion = {
    id: `v-${doc.id}-1`,
    documentId: doc.id,
    version: doc.version,
    title: doc.title,
    fileName: doc.fileName,
    fileSizeBytes: doc.fileSizeBytes,
    uploadedBy: doc.owner,
    uploadedAt: doc.createdAt,
    changeNote: "Initial upload",
    checksum: `sha256:${doc.id}`,
  };
  return delay([fallback]);
}

export async function fetchKnowledgeTags(): Promise<KnowledgeTag[]> {
  assertMockUiEnabled();
  const counts = new Map<string, number>();
  for (const doc of documents) {
    for (const tag of doc.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const tags: KnowledgeTag[] = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return delay(tags);
}

export async function uploadKnowledgeDocument(
  input: KnowledgeUploadInput,
  uploadedBy: string
): Promise<KnowledgeDocument> {
  assertMockUiEnabled();
  const id = nextId("doc");
  const mimeType = input.file.type || "application/octet-stream";
  const doc: KnowledgeDocument = {
    id,
    title: input.title.trim() || input.file.name,
    collection: input.collection,
    folderId: input.folderId,
    owner: uploadedBy,
    visibility: input.visibility,
    department: "General",
    tags: normalizeTags(input.tags),
    mimeType,
    fileName: input.file.name,
    fileSizeBytes: input.file.size,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "upload",
    status: "pending_index",
    version: 1,
    summary: `Uploaded ${input.file.name} (${formatBytes(input.file.size)})`,
  };

  documents = [doc, ...documents];

  versionsByDoc[id] = [
    {
      id: nextId("v"),
      documentId: id,
      version: 1,
      title: doc.title,
      fileName: doc.fileName,
      fileSizeBytes: doc.fileSizeBytes,
      uploadedBy,
      uploadedAt: doc.createdAt,
      changeNote: input.changeNote?.trim() || "Initial upload",
      checksum: `sha256:${id}`,
    },
  ];

  return delay(doc, 450);
}

export async function fetchAllKnowledgeCollections(): Promise<KnowledgeCollection[]> {
  assertMockUiEnabled();
  return delay([...KNOWLEDGE_COLLECTIONS]);
}

export function getFolderById(id: string): KnowledgeFolder | undefined {
  assertMockUiEnabled();
  return foldersFlat.find((f) => f.id === id);
}
