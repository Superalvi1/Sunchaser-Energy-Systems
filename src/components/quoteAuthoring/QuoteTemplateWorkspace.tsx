import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  Layers,
  Printer,
  RotateCcw,
  Save,
} from "lucide-react";
import type { ContentLibraryBlock } from "../../lib/quoteAuthoring";
import {
  TEMPLATE_NAV_BOQ,
  TEMPLATE_NAV_GLOBAL,
  buildTemplateSidebarItems,
  isTemplateSpecialNav,
} from "../../lib/quoteTemplateNav";
import { API_BASE_URL } from "../../services/api";
import QuoteTemplateGlobalSettingsPanel, {
  type QuoteTemplateGlobalSettingsProps,
} from "./QuoteTemplateGlobalSettingsPanel";
import QuoteTemplatePreviewModal from "./QuoteTemplatePreviewModal";
import TemplateA4Preview from "./TemplateA4Preview";
import TemplatePageEditor from "./TemplatePageEditor";
import TemplatePageSidebar from "./TemplatePageSidebar";
import type { PageAuthoringState } from "./QuotePageAuthoringFields";

export type QuoteTemplateWorkspaceProps = {
  quoteTemplatePages: any[];
  selectedTemplateId: string;
  contentLibrary: ContentLibraryBlock[];
  ceoMessages?: any[];
  getPageState: (page: any) => PageAuthoringState & Record<string, any>;
  onFieldChange: (pageId: string, field: string, value: any) => void;
  onSavePage: (pageId: string) => void;
  onResetPage: (pageId: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onMovePage: (pageId: string, currentOrder: number, direction: "up" | "down") => void;
  onImageUpload: (pageId: string, file: File, type: "image" | "bg") => void;
  uploadImageFile: (file: File, isBg: boolean) => Promise<string>;
  globalFontFamily: string;
  globalHeadingColor: string;
  globalBodyColor: string;
  globalSettings: QuoteTemplateGlobalSettingsProps;
};

export default function QuoteTemplateWorkspace(props: QuoteTemplateWorkspaceProps) {
  const {
    quoteTemplatePages,
    selectedTemplateId,
    contentLibrary,
    ceoMessages = [],
    getPageState,
    onFieldChange,
    onSavePage,
    onResetPage,
    onDuplicatePage,
    onMovePage,
    onImageUpload,
    uploadImageFile,
    globalFontFamily,
    globalHeadingColor,
    globalBodyColor,
    globalSettings,
  } = props;

  const sidebarItems = useMemo(() => buildTemplateSidebarItems(quoteTemplatePages), [quoteTemplatePages]);
  const firstPageId = sidebarItems.find((i) => !isTemplateSpecialNav(i.id))?.id || TEMPLATE_NAV_GLOBAL;

  const [selectedTemplatePageId, setSelectedTemplatePageId] = useState<string>(firstPageId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"page" | "full">("page");

  useEffect(() => {
    if (!sidebarItems.some((i) => i.id === selectedTemplatePageId)) {
      setSelectedTemplatePageId(firstPageId);
    }
  }, [sidebarItems, selectedTemplatePageId, firstPageId]);

  const activePage =
    !isTemplateSpecialNav(selectedTemplatePageId)
      ? quoteTemplatePages.find((p) => p.id === selectedTemplatePageId) || null
      : null;
  const pageState = activePage ? getPageState(activePage) : null;

  const openTemplatePreview = () => {
    window.open(`${API_BASE_URL}/api/export/pdf/template-preview/${encodeURIComponent(selectedTemplateId)}`, "_blank");
  };

  const printTest = () => {
    if (selectedTemplatePageId === TEMPLATE_NAV_GLOBAL || selectedTemplatePageId === TEMPLATE_NAV_BOQ) {
      openTemplatePreview();
      return;
    }
    setPreviewMode("page");
    setPreviewOpen(true);
  };

  const showPageActions = !!activePage && !!pageState;

  return (
    <div className="w-full min-h-[calc(100vh-11rem)] flex flex-col bg-slate-950 text-left rounded-2xl border border-slate-850 overflow-hidden shadow-2xl">
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="h-5 w-5 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate">Quote Template Workspace</h2>
            <p className="text-[10px] text-slate-500 truncate">One page at a time — large editor + live preview</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showPageActions && (
            <>
              <span
                className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold ${
                  pageState!.saveStatus === "Saved"
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                    : pageState!.saveStatus === "Saving..."
                      ? "bg-blue-500/15 text-blue-400 border border-blue-500/20 animate-pulse"
                      : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                }`}
              >
                {pageState!.saveStatus}
              </span>
              <button
                type="button"
                onClick={() => {
                  setPreviewMode("page");
                  setPreviewOpen(true);
                }}
                className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5"
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
              <button
                type="button"
                onClick={printTest}
                className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5"
              >
                <Printer className="h-3.5 w-3.5" /> Print Test
              </button>
              <button
                type="button"
                onClick={openTemplatePreview}
                className="text-xs font-bold px-3 py-2 rounded-lg bg-violet-700 text-white hover:bg-violet-600 flex items-center gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> Download Test PDF
              </button>
              <button
                type="button"
                onClick={() => onSavePage(activePage!.id)}
                className="text-xs font-bold px-4 py-2 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 flex items-center gap-1.5"
              >
                <Save className="h-3.5 w-3.5" /> Save Page
              </button>
            </>
          )}
          {selectedTemplatePageId === TEMPLATE_NAV_GLOBAL && (
            <button
              type="button"
              onClick={globalSettings.onSave}
              className="text-xs font-bold px-4 py-2 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 flex items-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5" /> Save Global Settings
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <TemplatePageSidebar
          pages={quoteTemplatePages}
          selectedTemplatePageId={selectedTemplatePageId}
          onSelect={setSelectedTemplatePageId}
        />

        {selectedTemplatePageId === TEMPLATE_NAV_GLOBAL ? (
          <QuoteTemplateGlobalSettingsPanel {...globalSettings} />
        ) : selectedTemplatePageId === TEMPLATE_NAV_BOQ ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <h3 className="text-xl font-bold text-white mb-2">BOQ Page</h3>
            <p className="text-sm text-slate-400 max-w-md mb-6">
              Generated automatically from Manual BOQ Builder when you compile a proposal PDF. Use Download Test PDF to
              preview the full deck including BOQ styling.
            </p>
            <button type="button" onClick={openTemplatePreview} className="bg-violet-600 text-white font-bold px-5 py-2.5 rounded-lg">
              Open Full Proposal Preview
            </button>
          </div>
        ) : activePage && pageState ? (
          <>
            <TemplatePageEditor
              page={activePage}
              pageState={pageState}
              contentLibrary={contentLibrary}
              globalFontFamily={globalFontFamily}
              globalHeadingColor={globalHeadingColor}
              globalBodyColor={globalBodyColor}
              onFieldChange={onFieldChange}
              onImageUpload={onImageUpload}
              uploadImageFile={uploadImageFile}
            />
            <TemplateA4Preview
              pageState={pageState}
              globalFontFamily={globalFontFamily}
              globalHeadingColor={globalHeadingColor}
              globalBodyColor={globalBodyColor}
              ceoMessages={ceoMessages}
              onFullscreen={() => {
                setPreviewMode("page");
                setPreviewOpen(true);
              }}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">Select a page from the sidebar</div>
        )}
      </div>

      {showPageActions && (
        <footer className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={pageState!.is_enabled}
              onChange={(e) => onFieldChange(activePage!.id, "is_enabled", e.target.checked)}
            />
            Page enabled
          </label>
          <button
            type="button"
            onClick={() => onMovePage(activePage!.id, activePage!.sort_order || activePage!.sortOrder, "up")}
            className="p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-amber-400"
            title="Move up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMovePage(activePage!.id, activePage!.sort_order || activePage!.sortOrder, "down")}
            className="p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-amber-400"
            title="Move down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDuplicatePage(activePage!.id)}
            className="text-[10px] font-bold px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Duplicate Page
          </button>
          <button
            type="button"
            onClick={() => onResetPage(activePage!.id)}
            className="text-[10px] font-bold px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-rose-400 flex items-center gap-1 ml-auto"
          >
            <RotateCcw className="h-3 w-3" /> Reset Page
          </button>
        </footer>
      )}

      {pageState && (
        <QuoteTemplatePreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          pageState={pageState}
          ceoMessages={ceoMessages}
          templateId={selectedTemplateId}
          mode={previewMode}
        />
      )}
    </div>
  );
}
