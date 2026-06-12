import React, { useMemo, useState } from "react";
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
  Settings2,
} from "lucide-react";
import {
  appendHtmlToEditor,
  mergeContentLibrary,
  type ContentLibraryBlock,
} from "../../lib/quoteAuthoring";
import {
  getTemplatePageNavLabel,
  TEMPLATE_NAV_BOQ,
  TEMPLATE_NAV_GLOBAL,
} from "../../lib/quoteTemplateNav";
import { API_BASE_URL } from "../../services/api";
import QuotePageLivePreview from "./QuotePageLivePreview";
import QuoteRichTextEditor from "./QuoteRichTextEditor";
import QuoteTemplateGlobalSettingsPanel, {
  type QuoteTemplateGlobalSettingsProps,
} from "./QuoteTemplateGlobalSettingsPanel";
import QuoteTemplatePageSettingsPanel from "./QuoteTemplatePageSettingsPanel";
import QuoteTemplatePreviewModal from "./QuoteTemplatePreviewModal";
import type { PageAuthoringState } from "./QuotePageAuthoringFields";

export type QuoteTemplateStudioProps = {
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

export default function QuoteTemplateStudio({
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
}: QuoteTemplateStudioProps) {
  const sortedPages = useMemo(
    () =>
      [...(quoteTemplatePages || [])]
        .filter(Boolean)
        .sort((a, b) => Number(a.sort_order || a.sortOrder || 0) - Number(b.sort_order || b.sortOrder || 0)),
    [quoteTemplatePages]
  );

  const [activeNav, setActiveNav] = useState<string>(sortedPages[0]?.id || TEMPLATE_NAV_GLOBAL);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"page" | "full">("page");

  const activePage = sortedPages.find((p) => p.id === activeNav) || null;
  const pageState = activePage ? getPageState(activePage) : null;
  const blocks = mergeContentLibrary(contentLibrary);

  const signatureBlock = pageState
    ? {
        ceo: { enabled: pageState.sigCeoEnabled, name: pageState.sigCeoName, title: pageState.sigCeoTitle, signatureUrl: pageState.sigCeoUrl },
        technicalDirector: { enabled: pageState.sigTechEnabled, name: pageState.sigTechName, title: pageState.sigTechTitle, signatureUrl: pageState.sigTechUrl },
        salesAdvisor: { enabled: pageState.sigSalesEnabled, name: pageState.sigSalesName, title: pageState.sigSalesTitle, signatureUrl: pageState.sigSalesUrl },
      }
    : null;

  const openFullPreview = () => {
    setPreviewMode("full");
    setPreviewOpen(true);
  };

  const openPagePreview = () => {
    setPreviewMode("page");
    setPreviewOpen(true);
  };

  const printPreview = () => {
    if (activeNav === TEMPLATE_NAV_BOQ || activeNav === TEMPLATE_NAV_GLOBAL) {
      window.open(`${API_BASE_URL}/api/export/pdf/template-preview/${encodeURIComponent(selectedTemplateId)}`, "_blank");
      return;
    }
    openPagePreview();
  };

  return (
    <div className="bg-slate-900 border border-slate-850 rounded-2xl overflow-hidden flex flex-col min-h-[calc(100vh-12rem)] text-left">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 bg-slate-950 shrink-0">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-amber-500" />
          <div>
            <h3 className="text-sm font-bold text-white">Quote Template Editor</h3>
            <p className="text-[10px] text-slate-500">Full-screen page authoring with live A4 preview</p>
          </div>
        </div>
        {activePage && pageState && (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold ${
                pageState.saveStatus === "Saved"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                  : pageState.saveStatus === "Saving..."
                    ? "bg-blue-500/15 text-blue-400 border border-blue-500/20 animate-pulse"
                    : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
              }`}
            >
              {pageState.saveStatus}
            </span>
            <button type="button" onClick={openPagePreview} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" /> Preview Full Page
            </button>
            <button type="button" onClick={printPreview} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1">
              <Printer className="h-3.5 w-3.5" /> Print Preview
            </button>
            <button type="button" onClick={openFullPreview} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-violet-700 text-white hover:bg-violet-600 flex items-center gap-1">
              <Download className="h-3.5 w-3.5" /> Download Test PDF
            </button>
            <button
              type="button"
              onClick={() => onSavePage(activePage.id)}
              disabled={pageState.saveStatus === "Saved" || pageState.saveStatus === "Saving..."}
              className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1"
            >
              <Save className="h-3.5 w-3.5" /> Save Page
            </button>
          </div>
        )}
        {activeNav === TEMPLATE_NAV_GLOBAL && (
          <button type="button" onClick={globalSettings.onSave} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 flex items-center gap-1">
            <Save className="h-3.5 w-3.5" /> Save Global Settings
          </button>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-950 overflow-y-auto">
          <nav className="p-2 space-y-0.5">
            <button
              type="button"
              onClick={() => setActiveNav(TEMPLATE_NAV_GLOBAL)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
                activeNav === TEMPLATE_NAV_GLOBAL ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              Global PDF Settings
            </button>
            {sortedPages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setActiveNav(page.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs ${
                  activeNav === page.id ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                <span className="font-semibold block truncate">{getTemplatePageNavLabel(page)}</span>
                <span className="text-[9px] text-slate-600 font-mono">#{page.sort_order || page.sortOrder}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveNav(TEMPLATE_NAV_BOQ)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold ${
                activeNav === TEMPLATE_NAV_BOQ ? "bg-violet-500/15 text-violet-300 border border-violet-500/30" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              BOQ Page
            </button>
          </nav>
        </aside>

        {activeNav === TEMPLATE_NAV_GLOBAL ? (
          <QuoteTemplateGlobalSettingsPanel {...globalSettings} />
        ) : activeNav === TEMPLATE_NAV_BOQ ? (
          <div className="flex-1 p-8 flex flex-col items-center justify-center text-center max-w-lg mx-auto">
            <h4 className="text-lg font-bold text-white mb-2">BOQ Page</h4>
            <p className="text-sm text-slate-400 mb-6">
              The Bill of Quantities page is generated automatically from the BOQ Builder when compiling a proposal PDF. Typography inherits global settings.
            </p>
            <button type="button" onClick={openFullPreview} className="bg-violet-600 text-white font-bold px-4 py-2 rounded-lg text-sm">
              Preview Full Proposal Deck (with BOQ)
            </button>
          </div>
        ) : activePage && pageState ? (
          <>
            <div className="w-72 shrink-0 border-r border-slate-800 p-3 overflow-y-auto bg-slate-950/80">
              <QuoteTemplatePageSettingsPanel
                pageId={activePage.id}
                page={activePage}
                pageState={pageState}
                globalFontFamily={globalFontFamily}
                globalHeadingColor={globalHeadingColor}
                globalBodyColor={globalBodyColor}
                onFieldChange={onFieldChange}
                onImageUpload={onImageUpload}
                uploadImageFile={uploadImageFile}
              />
            </div>

            <div className="flex-1 flex flex-col min-w-0 min-h-0 border-r border-slate-800">
              <div className="px-3 py-2 border-b border-slate-800 bg-slate-950 shrink-0">
                <p className="text-[9px] uppercase font-mono text-slate-500 font-bold mb-1.5">Content Library</p>
                <div className="flex flex-wrap gap-1">
                  {blocks.map((block) => (
                    <button
                      key={block.id}
                      type="button"
                      onClick={() => onFieldChange(activePage.id, "body_html", appendHtmlToEditor(pageState.body_html || "", block.html))}
                      className="text-[9px] px-2 py-0.5 rounded-full border border-slate-800 bg-slate-900 hover:border-amber-500/40 text-slate-400 hover:text-amber-400"
                    >
                      + {block.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0 p-3 overflow-hidden flex flex-col">
                <QuoteRichTextEditor
                  value={pageState.body_html || ""}
                  onChange={(html) => onFieldChange(activePage.id, "body_html", html)}
                  minHeight={420}
                  stickyToolbar
                />
              </div>
              <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-slate-800 bg-slate-950 shrink-0">
                <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={pageState.is_enabled} onChange={(e) => onFieldChange(activePage.id, "is_enabled", e.target.checked)} />
                  Enabled
                </label>
                <button type="button" onClick={() => onMovePage(activePage.id, activePage.sort_order || activePage.sortOrder, "up")} className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400" title="Move up">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => onMovePage(activePage.id, activePage.sort_order || activePage.sortOrder, "down")} className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-amber-400" title="Move down">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => onDuplicatePage(activePage.id)} className="text-[10px] font-bold px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white flex items-center gap-1">
                  <Copy className="h-3 w-3" /> Duplicate
                </button>
                <button type="button" onClick={() => onResetPage(activePage.id)} className="text-[10px] font-bold px-2 py-1 rounded bg-slate-900 border border-slate-800 text-rose-400 hover:text-rose-300 flex items-center gap-1 ml-auto">
                  <RotateCcw className="h-3 w-3" /> Reset Page
                </button>
              </div>
            </div>

            <div className="w-[min(420px,38vw)] shrink-0 p-3 flex flex-col min-h-0 bg-slate-950">
              <p className="text-[9px] uppercase font-mono text-slate-500 font-bold mb-2 shrink-0">Live A4 Preview</p>
              <div className="flex-1 min-h-0 overflow-auto">
                {signatureBlock && (
                  <QuotePageLivePreview
                    title={pageState.title}
                    bodyHtml={pageState.body_html}
                    bodyText={pageState.body_text}
                    imageSections={pageState.imageSections}
                    typography={{
                      fontFamily: pageState.fontFamily || globalFontFamily,
                      fontSize: pageState.fontSize,
                      headingColor: pageState.headingColor || globalHeadingColor,
                      bodyColor: pageState.bodyColor || globalBodyColor,
                      lineHeight: pageState.lineHeight,
                      textAlign: pageState.textAlign,
                    }}
                    layoutMode={pageState.layoutMode}
                    signatureBlock={signatureBlock}
                    ceoMessages={ceoMessages}
                    pageTypeLabel={pageState.authoringPageType}
                    embedded
                    large
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Select a page from the sidebar</div>
        )}
      </div>

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
