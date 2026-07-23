/**
 * Knowledge Center — FRONTEND MOCK PROTOTYPE ONLY
 *
 * NOT server/knowledge. This UI reads from `src/services/knowledgeMock.ts` (in-memory
 * seed data). It does not enforce real OwnershipResolvers and must not be treated
 * as a production knowledge source.
 *
 * Gated by VITE_ENABLE_KNOWLEDGE_MOCK_UI=true (default: off). See
 * `src/lib/knowledgeFeatureFlag.ts` and `server/knowledge/README.md`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  File,
  FileSpreadsheet,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  Grid3X3,
  History,
  LayoutList,
  Loader2,
  Search,
  Tag,
  Upload,
  User,
  X,
  Eye,
  Lock,
  Building2,
  Sparkles,
} from "lucide-react";
import AppModal from "./ui/AppModal";
import { useToast } from "../lib/toast";
import type {
  KnowledgeCollection,
  KnowledgeDocument,
  KnowledgeFolder,
  KnowledgeSearchFilters,
  KnowledgeTag,
  KnowledgeVersion,
  KnowledgeVisibility,
} from "../lib/knowledgeTypes";
import { KNOWLEDGE_COLLECTIONS } from "../lib/knowledgeTypes";
import {
  fetchAllKnowledgeCollections,
  fetchKnowledgeCollections,
  fetchKnowledgeDocument,
  fetchKnowledgeFolders,
  fetchKnowledgeTags,
  fetchKnowledgeVersionHistory,
  formatBytes,
  KNOWLEDGE_MOCK_DATA_SOURCE,
  searchKnowledgeDocuments,
  uploadKnowledgeDocument,
} from "../services/knowledgeMock";
import { isKnowledgeMockUiEnabled } from "../lib/knowledgeFeatureFlag";

interface KnowledgeStaffProps {
  staffUser?: { name?: string; username?: string };
}

type ViewMode = "grid" | "list";

const STATUS_OPTIONS = ["all", "active", "draft", "archived", "pending_index"] as const;
const VISIBILITY_OPTIONS = ["all", "company", "department", "private", "role_restricted"] as const;

const COLLECTION_COLORS: Record<string, string> = {
  Policies: "from-violet-500/20 to-violet-600/5 border-violet-500/30 text-violet-300",
  SOPs: "from-sky-500/20 to-sky-600/5 border-sky-500/30 text-sky-300",
  Projects: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 text-emerald-300",
  Finance: "from-amber-500/20 to-amber-600/5 border-amber-500/30 text-amber-300",
  Engineering: "from-cyan-500/20 to-cyan-600/5 border-cyan-500/30 text-cyan-300",
  Products: "from-rose-500/20 to-rose-600/5 border-rose-500/30 text-rose-300",
  Support: "from-indigo-500/20 to-indigo-600/5 border-indigo-500/30 text-indigo-300",
  Sales: "from-orange-500/20 to-orange-600/5 border-orange-500/30 text-orange-300",
  HR: "from-pink-500/20 to-pink-600/5 border-pink-500/30 text-pink-300",
  General: "from-neutral-500/20 to-neutral-600/5 border-neutral-500/30 text-neutral-300",
};

function docIcon(mimeType: string) {
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return FileSpreadsheet;
  if (mimeType.includes("pdf") || mimeType.includes("word")) return FileText;
  return File;
}

function visibilityIcon(v: KnowledgeVisibility) {
  if (v === "private") return Lock;
  if (v === "role_restricted") return Eye;
  if (v === "department") return Building2;
  return User;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function FolderTreeItem({
  folder,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: {
  key?: React.Key;
  folder: KnowledgeFolder;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = folder.children && folder.children.length > 0;
  const isExpanded = expanded.has(folder.id);
  const isSelected = selectedId === folder.id;
  const Icon = isSelected ? FolderOpen : Folder;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(folder.id)}
        className={`group flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left transition ${
          isSelected
            ? "bg-teal-500/15 text-teal-100"
            : "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(folder.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onToggle(folder.id);
              }
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-neutral-700/50"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Icon className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-teal-400" : ""}`} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{folder.name}</span>
        <span className="text-[10px] text-neutral-600 tabular-nums">{folder.documentCount}</span>
      </button>
      {hasChildren && isExpanded && (
        <div>
          {folder.children!.map((child) => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentCard({
  doc,
  selected,
  onClick,
}: {
  key?: React.Key;
  doc: KnowledgeDocument;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = docIcon(doc.mimeType);
  const colorClass = COLLECTION_COLORS[doc.collection] ?? COLLECTION_COLORS.General;
  const VisIcon = visibilityIcon(doc.visibility);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col rounded-2xl border bg-gradient-to-br p-4 text-left transition hover:scale-[1.01] hover:shadow-lg ${
        selected
          ? "border-teal-500/50 shadow-[0_0_0_1px_rgba(20,184,166,0.3)] ring-1 ring-teal-500/20"
          : `border-neutral-800/80 hover:border-neutral-600 ${colorClass.split(" ").slice(2).join(" ")}`
      } ${colorClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/20 backdrop-blur-sm">
          <Icon className="h-5 w-5" />
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
            doc.status === "active"
              ? "bg-emerald-500/20 text-emerald-300"
              : doc.status === "draft"
                ? "bg-amber-500/20 text-amber-300"
                : doc.status === "archived"
                  ? "bg-neutral-500/20 text-neutral-400"
                  : "bg-sky-500/20 text-sky-300"
          }`}
        >
          {doc.status.replace("_", " ")}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-sm font-bold text-white leading-snug">{doc.title}</h3>
      {doc.summary && (
        <p className="mt-1.5 line-clamp-2 text-[11px] text-neutral-400 leading-relaxed">{doc.summary}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {doc.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-black/20 px-1.5 py-0.5 text-[9px] font-medium text-neutral-300"
          >
            #{tag}
          </span>
        ))}
        {doc.tags.length > 3 && (
          <span className="text-[9px] text-neutral-500">+{doc.tags.length - 3}</span>
        )}
      </div>
      <div className="mt-auto pt-3 flex items-center justify-between text-[10px] text-neutral-500">
        <span className="flex items-center gap-1">
          <VisIcon className="h-3 w-3" />
          {formatBytes(doc.fileSizeBytes)}
        </span>
        <span className="flex items-center gap-1">
          <History className="h-3 w-3" />v{doc.version}
        </span>
      </div>
    </button>
  );
}

function VersionTimeline({ versions, loading }: { versions: KnowledgeVersion[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-teal-400" />
      </div>
    );
  }
  if (versions.length === 0) {
    return <p className="py-4 text-center text-xs text-neutral-500">No version history.</p>;
  }

  return (
    <div className="relative space-y-0">
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-teal-500/50 via-neutral-700 to-transparent" />
      {versions.map((v, i) => (
        <div key={v.id} className="relative flex gap-3 pb-4">
          <div
            className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
              i === 0
                ? "border-teal-400 bg-teal-500/20 text-teal-300"
                : "border-neutral-700 bg-neutral-900 text-neutral-500"
            }`}
          >
            <span className="text-[9px] font-bold">{v.version}</span>
          </div>
          <div className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-neutral-200">{v.changeNote}</p>
              {i === 0 && (
                <span className="shrink-0 rounded-full bg-teal-500/15 px-2 py-0.5 text-[9px] font-bold text-teal-400">
                  Current
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-[10px] text-neutral-500 font-mono">{v.fileName}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-500">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {v.uploadedBy}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(v.uploadedAt)}
              </span>
              <span>{formatBytes(v.fileSizeBytes)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function UploadModal({
  open,
  onClose,
  folders,
  collections,
  defaultFolderId,
  defaultCollection,
  uploadedBy,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  folders: KnowledgeFolder[];
  collections: KnowledgeCollection[];
  defaultFolderId: string;
  defaultCollection: KnowledgeCollection;
  uploadedBy: string;
  onUploaded: (doc: KnowledgeDocument) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [collection, setCollection] = useState<KnowledgeCollection>(defaultCollection);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<KnowledgeVisibility>("company");
  const [changeNote, setChangeNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const flatFolders = useMemo(() => {
    const out: KnowledgeFolder[] = [];
    function walk(nodes: KnowledgeFolder[]) {
      for (const n of nodes) {
        out.push(n);
        if (n.children) walk(n.children);
      }
    }
    walk(folders);
    return out;
  }, [folders]);

  useEffect(() => {
    if (open) {
      setCollection(defaultCollection);
      setFolderId(defaultFolderId);
    }
  }, [open, defaultCollection, defaultFolderId]);

  const reset = () => {
    setFile(null);
    setTitle("");
    setTags("");
    setChangeNote("");
    setVisibility("company");
    setDragOver(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (f: File) => {
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    if (!file) {
      toast.error("Select a file to upload.");
      return;
    }
    setUploading(true);
    try {
      const doc = await uploadKnowledgeDocument(
        {
          file,
          title: title.trim() || file.name,
          collection,
          folderId,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          visibility,
          changeNote,
        },
        uploadedBy
      );
      toast.success(`Uploaded "${doc.title}"`);
      onUploaded(doc);
      handleClose();
    } catch {
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={handleClose}
      panelClassName="max-w-lg w-full mx-4 bg-neutral-950 border border-neutral-800 rounded-2xl p-0 overflow-hidden shadow-2xl"
    >
      <div className="border-b border-neutral-800 bg-gradient-to-r from-teal-950/50 to-neutral-950 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 border border-teal-500/30">
              <Upload className="h-5 w-5 text-teal-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Upload Document</h3>
              <p className="text-[10px] text-neutral-500">Mock upload — stored in browser memory</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
        <div
          role="button"
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
          }}
          className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 transition cursor-pointer ${
            dragOver
              ? "border-teal-400 bg-teal-500/10"
              : file
                ? "border-teal-500/40 bg-teal-500/5"
                : "border-neutral-700 bg-neutral-900/50 hover:border-neutral-600"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {file ? (
            <>
              <FileText className="h-8 w-8 text-teal-400 mb-2" />
              <p className="text-sm font-semibold text-white">{file.name}</p>
              <p className="text-xs text-neutral-500 mt-1">{formatBytes(file.size)}</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-neutral-600 mb-2" />
              <p className="text-sm text-neutral-400">Drop file here or click to browse</p>
              <p className="text-[10px] text-neutral-600 mt-1">PDF, Word, Excel, images, text</p>
            </>
          )}
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            placeholder="Document title"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Collection</label>
            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value as KnowledgeCollection)}
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            >
              {collections.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Folder</label>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            >
              {flatFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as KnowledgeVisibility)}
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            >
              <option value="company">Company</option>
              <option value="department">Department</option>
              <option value="private">Private</option>
              <option value="role_restricted">Role restricted</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Tags</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              placeholder="sop, safety, solar"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Version note</label>
          <input
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            placeholder="What changed in this version?"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-neutral-800 px-6 py-4 bg-neutral-900/50">
        <button
          type="button"
          onClick={handleClose}
          className="rounded-xl px-4 py-2 text-xs font-semibold text-neutral-400 hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={uploading || !file}
          className="flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-xs font-bold text-neutral-950 hover:bg-teal-400 disabled:opacity-40"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload
        </button>
      </div>
    </AppModal>
  );
}

export default function KnowledgeStaff({ staffUser }: KnowledgeStaffProps) {
  const mockUiEnabled = isKnowledgeMockUiEnabled();
  const uploadedBy = staffUser?.name || staffUser?.username || "Staff User";

  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [collectionSummaries, setCollectionSummaries] = useState<{ name: KnowledgeCollection; documentCount: number }[]>([]);
  const [allCollections, setAllCollections] = useState<KnowledgeCollection[]>([]);
  const [tags, setTags] = useState<KnowledgeTag[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(null);
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | "all">("all");
  const [selectedCollection, setSelectedCollection] = useState<KnowledgeCollection | "all">("all");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<(typeof VISIBILITY_OPTIONS)[number]>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["root", "fld-projects"]));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"info" | "versions">("info");

  const filters: KnowledgeSearchFilters = useMemo(
    () => ({
      query: searchQuery,
      collection: selectedCollection,
      folderId: selectedFolderId,
      status: statusFilter,
      visibility: visibilityFilter,
      tags: selectedTags.length ? selectedTags : undefined,
    }),
    [searchQuery, selectedCollection, selectedFolderId, statusFilter, visibilityFilter, selectedTags]
  );

  const loadDocuments = useCallback(async () => {
    if (!mockUiEnabled) return;
    const docs = await searchKnowledgeDocuments(filters);
    setDocuments(docs);
  }, [filters, mockUiEnabled]);

  const loadAll = useCallback(async () => {
    if (!mockUiEnabled) return;
    setLoading(true);
    try {
      const [folderTree, summaries, tagList, cols] = await Promise.all([
        fetchKnowledgeFolders(),
        fetchKnowledgeCollections(),
        fetchKnowledgeTags(),
        fetchAllKnowledgeCollections(),
      ]);
      setFolders(folderTree);
      setCollectionSummaries(summaries);
      setTags(tagList);
      setAllCollections(cols);
    } finally {
      setLoading(false);
    }
  }, [mockUiEnabled]);

  useEffect(() => {
    if (!mockUiEnabled) return;
    void loadAll();
  }, [loadAll, mockUiEnabled]);

  useEffect(() => {
    if (!mockUiEnabled) return;
    void loadDocuments();
  }, [loadDocuments, mockUiEnabled]);

  useEffect(() => {
    if (!mockUiEnabled || !selectedDoc) {
      setVersions([]);
      return;
    }
    setVersionsLoading(true);
    void fetchKnowledgeVersionHistory(selectedDoc.id).then((v) => {
      setVersions(v);
      setVersionsLoading(false);
    });
  }, [selectedDoc, mockUiEnabled]);

  const selectDocument = async (doc: KnowledgeDocument) => {
    const fresh = await fetchKnowledgeDocument(doc.id);
    setSelectedDoc(fresh ?? doc);
    setDetailTab("info");
  };

  const toggleFolderExpand = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const activeFilterCount = [
    selectedCollection !== "all",
    selectedFolderId !== "all",
    statusFilter !== "all",
    visibilityFilter !== "all",
    selectedTags.length > 0,
  ].filter(Boolean).length;

  const totalDocs = documents.length;

  if (!mockUiEnabled) {
    return null;
  }

  return (
    <div className="fade-in-entry space-y-4">
      <div
        role="status"
        className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100/90"
      >
        <strong className="font-semibold text-amber-200">Prototype mock UI</strong> — data source:{" "}
        <code className="text-amber-300/90">{KNOWLEDGE_MOCK_DATA_SOURCE}</code>. Not connected to{" "}
        <code className="text-amber-300/90">server/knowledge</code> or production permissions. For
        internal preview only.
      </div>
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-950 to-teal-950/30 p-6 shadow-xl">
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400/20 to-teal-600/10 border border-teal-500/30 shadow-lg shadow-teal-500/10">
              <BookOpen className="h-7 w-7 text-teal-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-white tracking-tight">Knowledge Center</h1>
                <span className="rounded-full bg-teal-500/15 border border-teal-500/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-teal-400">
                  Mock prototype
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-400 max-w-lg">
                Company documents, SOPs, and project files — organized by folders, collections, and tags.
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-neutral-500">
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-teal-400" />
                  {totalDocs} documents
                </span>
                <span className="flex items-center gap-1">
                  <Folder className="h-3 w-3" />
                  {collectionSummaries.length} collections
                </span>
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {tags.length} tags
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-teal-400 px-5 py-2.5 text-xs font-bold text-neutral-950 shadow-lg shadow-teal-500/25 hover:from-teal-400 hover:to-teal-300 transition"
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* Left sidebar — Folders & Collections */}
        <aside className="w-full shrink-0 xl:w-56 space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3">
            <h2 className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              Folders
            </h2>
            <button
              type="button"
              onClick={() => setSelectedFolderId("all")}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                selectedFolderId === "all"
                  ? "bg-teal-500/15 text-teal-100"
                  : "text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              All folders
            </button>
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-neutral-600" />
              </div>
            ) : (
              folders.map((folder) => (
                <FolderTreeItem
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  selectedId={selectedFolderId === "all" ? null : selectedFolderId}
                  expanded={expandedFolders}
                  onToggle={toggleFolderExpand}
                  onSelect={setSelectedFolderId}
                />
              ))
            )}
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3">
            <h2 className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              Collections
            </h2>
            <button
              type="button"
              onClick={() => setSelectedCollection("all")}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                selectedCollection === "all"
                  ? "bg-violet-500/15 text-violet-100"
                  : "text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              <span>All collections</span>
            </button>
            {collectionSummaries.map((col) => (
              <button
                key={col.name}
                type="button"
                onClick={() => setSelectedCollection(col.name)}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition ${
                  selectedCollection === col.name
                    ? "bg-violet-500/15 text-violet-100 font-semibold"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                }`}
              >
                <span className="truncate">{col.name}</span>
                <span className="text-[10px] tabular-nums text-neutral-600">{col.documentCount}</span>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3">
            <h2 className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              Popular tags
            </h2>
            <div className="flex flex-wrap gap-1.5 px-1">
              {tags.slice(0, 12).map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => toggleTag(t.name)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition border ${
                    selectedTags.includes(t.name)
                      ? "bg-teal-500/20 border-teal-500/40 text-teal-300"
                      : "bg-neutral-800/80 border-neutral-700 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  #{t.name}
                  <span className="ml-1 text-neutral-600">{t.count}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 space-y-3">
          {/* Search & toolbar */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search documents, tags, owners…"
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 py-2.5 pl-10 pr-4 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowFilters((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    showFilters || activeFilterCount > 0
                      ? "border-teal-500/40 bg-teal-500/10 text-teal-300"
                      : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-teal-500 px-1.5 text-[9px] font-bold text-neutral-950">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                <div className="flex rounded-xl border border-neutral-700 bg-neutral-900 p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    className={`rounded-lg p-2 transition ${
                      viewMode === "grid" ? "bg-neutral-800 text-teal-400" : "text-neutral-500 hover:text-neutral-300"
                    }`}
                    aria-label="Grid view"
                  >
                    <Grid3X3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className={`rounded-lg p-2 transition ${
                      viewMode === "list" ? "bg-neutral-800 text-teal-400" : "text-neutral-500 hover:text-neutral-300"
                    }`}
                    aria-label="List view"
                  >
                    <LayoutList className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {showFilters && (
              <div className="flex flex-wrap gap-2 border-t border-neutral-800 pt-3">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  className="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-[11px] text-neutral-300"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      Status: {s === "all" ? "All" : s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <select
                  value={visibilityFilter}
                  onChange={(e) => setVisibilityFilter(e.target.value as typeof visibilityFilter)}
                  className="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-[11px] text-neutral-300"
                >
                  {VISIBILITY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      Visibility: {v === "all" ? "All" : v.replace("_", " ")}
                    </option>
                  ))}
                </select>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCollection("all");
                      setSelectedFolderId("all");
                      setStatusFilter("all");
                      setVisibilityFilter("all");
                      setSelectedTags([]);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/10"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {selectedTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-neutral-500">Active tags:</span>
                {selectedTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className="flex items-center gap-1 rounded-full bg-teal-500/15 border border-teal-500/30 px-2 py-0.5 text-[10px] text-teal-300"
                  >
                    #{t}
                    <X className="h-2.5 w-2.5" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Document grid/list */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 min-h-[320px]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
                <p className="text-xs text-neutral-500">Loading knowledge base…</p>
              </div>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <Archive className="h-10 w-10 text-neutral-700" />
                <p className="text-sm text-neutral-400">No documents match your filters.</p>
                <button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  className="text-xs font-semibold text-teal-400 hover:text-teal-300"
                >
                  Upload the first document →
                </button>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-3">
                {documents.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    selected={selectedDoc?.id === doc.id}
                    onClick={() => void selectDocument(doc)}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-neutral-800 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                      <th className="pb-2 pr-4 font-bold">Title</th>
                      <th className="pb-2 pr-4 font-bold">Collection</th>
                      <th className="pb-2 pr-4 font-bold">Status</th>
                      <th className="pb-2 pr-4 font-bold">Owner</th>
                      <th className="pb-2 pr-4 font-bold">Updated</th>
                      <th className="pb-2 font-bold">Ver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr
                        key={doc.id}
                        onClick={() => void selectDocument(doc)}
                        className={`cursor-pointer border-b border-neutral-800/60 transition hover:bg-neutral-800/40 ${
                          selectedDoc?.id === doc.id ? "bg-teal-500/5" : ""
                        }`}
                      >
                        <td className="py-2.5 pr-4 font-medium text-neutral-200 max-w-[200px] truncate">
                          {doc.title}
                        </td>
                        <td className="py-2.5 pr-4 text-neutral-400">{doc.collection}</td>
                        <td className="py-2.5 pr-4">
                          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px]">{doc.status}</span>
                        </td>
                        <td className="py-2.5 pr-4 text-neutral-400">{doc.owner}</td>
                        <td className="py-2.5 pr-4 text-neutral-500">{formatDate(doc.updatedAt)}</td>
                        <td className="py-2.5 text-neutral-500">v{doc.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>

        {/* Right detail panel */}
        {selectedDoc && (
          <aside className="w-full shrink-0 xl:w-80">
            <div className="sticky top-4 rounded-2xl border border-neutral-800 bg-neutral-900/80 backdrop-blur-sm overflow-hidden">
              <div className="border-b border-neutral-800 bg-gradient-to-r from-neutral-900 to-teal-950/20 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">{selectedDoc.title}</h3>
                  <button
                    type="button"
                    onClick={() => setSelectedDoc(null)}
                    className="shrink-0 rounded-lg p-1 text-neutral-500 hover:bg-neutral-800 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setDetailTab("info")}
                    className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition ${
                      detailTab === "info"
                        ? "bg-teal-500/20 text-teal-300"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab("versions")}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold transition ${
                      detailTab === "versions"
                        ? "bg-teal-500/20 text-teal-300"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    <History className="h-3 w-3" />
                    Version History
                  </button>
                </div>
              </div>

              <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-4">
                {detailTab === "info" ? (
                  <dl className="space-y-3 text-xs">
                    {selectedDoc.summary && (
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Summary</dt>
                        <dd className="mt-1 text-neutral-300 leading-relaxed">{selectedDoc.summary}</dd>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Collection</dt>
                        <dd className="mt-1 text-neutral-200">{selectedDoc.collection}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Status</dt>
                        <dd className="mt-1 capitalize text-neutral-200">{selectedDoc.status.replace("_", " ")}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Owner</dt>
                        <dd className="mt-1 text-neutral-200">{selectedDoc.owner}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Department</dt>
                        <dd className="mt-1 text-neutral-200">{selectedDoc.department}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">File</dt>
                        <dd className="mt-1 truncate font-mono text-[10px] text-neutral-400">{selectedDoc.fileName}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Size</dt>
                        <dd className="mt-1 text-neutral-200">{formatBytes(selectedDoc.fileSizeBytes)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Created</dt>
                        <dd className="mt-1 text-neutral-400">{formatDate(selectedDoc.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Updated</dt>
                        <dd className="mt-1 text-neutral-400">{formatDate(selectedDoc.updatedAt)}</dd>
                      </div>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Tags</dt>
                      <dd className="mt-1.5 flex flex-wrap gap-1">
                        {selectedDoc.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-md bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300"
                          >
                            #{t}
                          </span>
                        ))}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <VersionTimeline versions={versions} loading={versionsLoading} />
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        folders={folders}
        collections={allCollections.length ? allCollections : [...KNOWLEDGE_COLLECTIONS]}
        defaultFolderId={selectedFolderId === "all" ? "root" : selectedFolderId}
        defaultCollection={selectedCollection === "all" ? "General" : selectedCollection}
        uploadedBy={uploadedBy}
        onUploaded={(doc) => {
          void loadAll();
          void loadDocuments();
          setSelectedDoc(doc);
        }}
      />
    </div>
  );
}
