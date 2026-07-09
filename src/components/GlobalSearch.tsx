import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Command,
  FileText,
  FolderOpen,
  Loader2,
  Package,
  Receipt,
  Search,
  Sparkles,
  Ticket,
  User,
  Users,
} from "lucide-react";
import { isKnowledgeMockUiEnabled } from "../lib/knowledgeFeatureFlag";
import type { AppState, User as AppUser } from "../types";
import {
  buildGlobalSearchShellModel,
  clearLegacyRecentSearchStorage,
  flattenSearchGroups,
  GLOBAL_SEARCH_CATEGORY_LABELS,
  runGlobalSearch,
  type GlobalSearchCategory,
  type GlobalSearchResult,
} from "../lib/globalSearch";

export interface GlobalSearchProps {
  appState: AppState | null;
  currentUser: AppUser;
  allowedTabIds: readonly string[];
  onNavigate: (tabId: string) => void;
}

const CATEGORY_ICONS: Record<GlobalSearchCategory, React.ComponentType<{ className?: string }>> = {
  customers: Users,
  leads: User,
  quotations: FileText,
  projects: Briefcase,
  invoices: Receipt,
  tickets: Ticket,
  inventory: Package,
  documents: BookOpen,
};

const glassShell =
  "relative overflow-hidden border border-white/[0.08] bg-neutral-950/95 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/5";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function GlobalSearch({
  appState,
  currentUser: _currentUser,
  allowedTabIds,
  onNavigate,
}: GlobalSearchProps) {
  void _currentUser;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewResult, setPreviewResult] = useState<GlobalSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const documentsEnabled = isKnowledgeMockUiEnabled();
  const shell = buildGlobalSearchShellModel();

  const debouncedQuery = useDebouncedValue(query, 160);

  useEffect(() => {
    clearLegacyRecentSearchStorage();
  }, []);

  useEffect(() => {
    if (open) {
      clearLegacyRecentSearchStorage();
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    setQuery("");
    setPreviewResult(null);
    setActiveIndex(0);
    return undefined;
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(() => setSearching(false), 220);
    return () => window.clearTimeout(t);
  }, [debouncedQuery]);

  const groups = useMemo(
    () =>
      runGlobalSearch({
        appState,
        query: debouncedQuery,
        allowedTabIds,
        documentsEnabled,
      }),
    [appState, debouncedQuery, allowedTabIds, documentsEnabled]
  );

  const flatResults = useMemo(() => flattenSearchGroups(groups), [groups]);

  useEffect(() => {
    setActiveIndex(0);
    setPreviewResult(null);
  }, [debouncedQuery]);

  useEffect(() => {
    if (flatResults.length === 0) {
      setPreviewResult(null);
      return;
    }
    if (activeIndex >= flatResults.length) {
      setActiveIndex(0);
    }
  }, [flatResults, activeIndex]);

  const activeResult = flatResults[activeIndex] ?? null;
  const displayPreview = previewResult ?? activeResult;

  const activateResult = useCallback(
    (result: GlobalSearchResult) => {
      if (result.routeTab) {
        onNavigate(result.routeTab);
        setOpen(false);
        return;
      }

      setPreviewResult(result);
    },
    [onNavigate]
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (previewResult) {
        setPreviewResult(null);
        return;
      }
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatResults.length === 0) return;
      setActiveIndex((i) => (i + 1) % flatResults.length);
      setPreviewResult(null);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatResults.length === 0) return;
      setActiveIndex((i) => (i - 1 + flatResults.length) % flatResults.length);
      setPreviewResult(null);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (activeResult) {
        activateResult(activeResult);
      }
    }
  };

  useEffect(() => {
    if (!open || !listRef.current || !activeResult) return;
    const el = listRef.current.querySelector(`[data-result-id="${activeResult.id}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, activeResult]);

  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "");

  const panel = (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="global-search"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[9999] flex items-start justify-center p-0 sm:p-6 sm:pt-[10vh]"
          role="presentation"
        >
          <button
            type="button"
            aria-label="Close search"
            className="absolute inset-0 border-0 bg-black/75 backdrop-blur-md cursor-default"
            onClick={() => setOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={`${glassShell} relative flex h-full w-full max-w-4xl flex-col sm:h-auto sm:max-h-[min(680px,88vh)] sm:rounded-2xl`}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-violet-500/[0.08] via-indigo-500/[0.04] to-transparent" />

            <div className="relative flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5">
              <Search className="h-5 w-5 shrink-0 text-violet-400/80" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search leads, quotes, tickets, inventory, documents…"
                className="min-w-0 flex-1 bg-transparent text-base text-white placeholder:text-neutral-600 focus:outline-none sm:text-[15px]"
                autoComplete="off"
                spellCheck={false}
              />
              {searching && debouncedQuery.trim() ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-400" />
              ) : (
                <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-neutral-500">
                  <Command className="h-3 w-3" />
                  J
                </kbd>
              )}
              <kbd className="hidden sm:inline rounded-md border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">
                esc
              </kbd>
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col sm:flex-row">
              <div
                ref={listRef}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:max-w-[58%] sm:border-r sm:border-white/[0.06]"
              >
                {!debouncedQuery.trim() ? (
                  <div className="px-3 py-6">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">
                      <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                      {shell.introHeading}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-neutral-400">{shell.introBody}</p>
                    <div className="mt-6 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center">
                      <FolderOpen className="mx-auto mb-2 h-8 w-8 text-neutral-700" />
                      <p className="text-sm font-medium text-neutral-400">Search your workspace</p>
                      <p className="mt-1 text-xs text-neutral-600">
                        Try lead status, SKU, ticket priority, or document title
                      </p>
                    </div>
                  </div>
                ) : searching ? (
                  <div className="space-y-2 px-2 py-3 animate-pulse">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-12 rounded-xl bg-white/[0.03]" />
                    ))}
                  </div>
                ) : flatResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                    <Search className="mb-3 h-9 w-9 text-neutral-700" />
                    <p className="text-sm font-medium text-neutral-300">{shell.noResultsMessage}</p>
                    <p className="mt-1 max-w-xs text-xs text-neutral-600">
                      Try a different keyword — status, SKU, priority, or document title.
                    </p>
                  </div>
                ) : (
                  groups.map((group) => {
                    const Icon = CATEGORY_ICONS[group.category];
                    return (
                      <div key={group.category} className="mb-3">
                        <div className="sticky top-0 z-10 flex items-center gap-2 bg-neutral-950/95 px-2 py-1.5 backdrop-blur-sm">
                          <Icon className="h-3.5 w-3.5 text-violet-400" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                            {group.label}
                          </span>
                          <span className="text-[10px] tabular-nums text-neutral-700">{group.results.length}</span>
                        </div>
                        <ul className="space-y-0.5">
                          {group.results.map((result) => {
                            const flatIdx = flatResults.findIndex((r) => r.id === result.id);
                            const selected = flatIdx === activeIndex;
                            const CatIcon = CATEGORY_ICONS[result.category];
                            return (
                              <li key={result.id}>
                                <button
                                  type="button"
                                  data-result-id={result.id}
                                  onClick={() => {
                                    setActiveIndex(flatIdx);
                                    activateResult(result);
                                  }}
                                  onMouseEnter={() => {
                                    setActiveIndex(flatIdx);
                                    setPreviewResult(null);
                                  }}
                                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                                    selected
                                      ? "bg-violet-500/15 ring-1 ring-violet-500/30"
                                      : "hover:bg-white/[0.04]"
                                  }`}
                                >
                                  <span
                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                      selected
                                        ? "bg-violet-500/20 text-violet-300"
                                        : "bg-white/[0.04] text-neutral-500"
                                    }`}
                                  >
                                    <CatIcon className="h-4 w-4" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-neutral-100">
                                      {result.title}
                                    </span>
                                    <span className="block truncate text-[11px] text-neutral-500">
                                      {result.subtitle}
                                    </span>
                                  </span>
                                  {result.routeTab ? (
                                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-600 opacity-0 transition group-hover:opacity-100" />
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })
                )}
              </div>

              <div
                className={`min-h-0 shrink-0 overflow-y-auto border-t border-white/[0.06] bg-white/[0.02] px-4 py-4 sm:w-[42%] sm:border-t-0 ${
                  displayPreview ? "flex flex-col" : "hidden sm:flex sm:flex-col"
                }`}
              >
                {displayPreview ? (
                  <>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-violet-400/80">
                      {GLOBAL_SEARCH_CATEGORY_LABELS[displayPreview.category]}
                    </p>
                    <h3 className="text-sm font-bold leading-snug text-white">{displayPreview.preview.heading}</h3>
                    {displayPreview.routeTab ? (
                      <p className="mt-1 text-[10px] text-neutral-500">
                        Enter opens <span className="text-neutral-400">{displayPreview.routeTab}</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] text-neutral-500">Preview only — no direct route</p>
                    )}
                    <dl className="mt-4 space-y-2.5">
                      {displayPreview.preview.lines.map((line) => (
                        <div key={line.label}>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                            {line.label}
                          </dt>
                          <dd className="mt-0.5 break-words text-xs leading-relaxed text-neutral-300">
                            {line.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center">
                    <Sparkles className="mb-3 h-8 w-8 text-neutral-800" />
                    <p className="text-xs text-neutral-600">Select a result to preview safe details</p>
                  </div>
                )}
              </div>
            </div>

            <div className="relative hidden shrink-0 items-center justify-between border-t border-white/[0.06] bg-white/[0.02] px-4 py-2 text-[10px] text-neutral-600 sm:flex">
              <div className="flex gap-3">
                <span>
                  <kbd className="rounded border border-neutral-800 px-1 font-mono">↑↓</kbd> navigate
                </span>
                <span>
                  <kbd className="rounded border border-neutral-800 px-1 font-mono">↵</kbd> open
                </span>
                <span>
                  <kbd className="rounded border border-neutral-800 px-1 font-mono">esc</kbd> close
                </span>
              </div>
              <span>
                {isMac ? "⌘" : "Ctrl"}+J · safe labels · local state only
              </span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <>
      {typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </>
  );
}
