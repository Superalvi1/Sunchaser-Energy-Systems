import React, { useMemo, useState } from "react";
import { Download, Minus, Plus, Printer, X } from "lucide-react";
import { API_BASE_URL } from "../../services/api";
import QuotePageLivePreview from "./QuotePageLivePreview";
import type { PageAuthoringState } from "./QuotePageAuthoringFields";

type Props = {
  open: boolean;
  onClose: () => void;
  pageState: PageAuthoringState & { page_type?: string; pageType?: string; bg_image_url?: string; image_url?: string };
  ceoMessages?: any[];
  templateId?: string;
  mode?: "page" | "full";
};

const ZOOM_OPTIONS = [
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "100%", value: 1 },
  { label: "Fit Width", value: -1 },
];

export default function QuoteTemplatePreviewModal({
  open,
  onClose,
  pageState,
  ceoMessages = [],
  templateId = "tmpl-1",
  mode = "page",
}: Props) {
  const [zoom, setZoom] = useState<number>(0.75);

  const signatureBlock = useMemo(
    () => ({
      ceo: {
        enabled: pageState.sigCeoEnabled,
        name: pageState.sigCeoName,
        title: pageState.sigCeoTitle,
        signatureUrl: pageState.sigCeoUrl,
      },
      technicalDirector: {
        enabled: pageState.sigTechEnabled,
        name: pageState.sigTechName,
        title: pageState.sigTechTitle,
        signatureUrl: pageState.sigTechUrl,
      },
      salesAdvisor: {
        enabled: pageState.sigSalesEnabled,
        name: pageState.sigSalesName,
        title: pageState.sigSalesTitle,
        signatureUrl: pageState.sigSalesUrl,
      },
    }),
    [pageState]
  );

  if (!open) return null;

  const openFullTemplate = () => {
    window.open(`${API_BASE_URL}/api/export/pdf/template-preview/${encodeURIComponent(templateId)}`, "_blank");
  };

  const printPreview = () => {
    if (mode === "full") {
      openFullTemplate();
      return;
    }
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 md:p-4">
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "90vw", height: "90vh", maxWidth: "90vw", maxHeight: "90vh" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-white">
              {mode === "full" ? "Full Proposal Preview" : "Preview Full Page"}
            </h3>
            <p className="text-[10px] text-slate-500">{pageState.title || "Template page"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
              <button type="button" className="p-1 text-slate-400 hover:text-white" onClick={() => setZoom((z) => Math.max(0.35, z - 0.1))}>
                <Minus className="h-3.5 w-3.5" />
              </button>
              {ZOOM_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setZoom(opt.value === -1 ? 0.65 : opt.value)}
                  className={`text-[10px] px-2 py-0.5 rounded ${zoom === opt.value || (opt.value === -1 && zoom === 0.65) ? "bg-amber-500/20 text-amber-400" : "text-slate-400 hover:text-white"}`}
                >
                  {opt.label}
                </button>
              ))}
              <button type="button" className="p-1 text-slate-400 hover:text-white" onClick={() => setZoom((z) => Math.min(1.2, z + 0.1))}>
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <button type="button" onClick={printPreview} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1">
              <Printer className="h-3.5 w-3.5" /> Print Preview
            </button>
            <button type="button" onClick={openFullTemplate} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 flex items-center gap-1">
              <Download className="h-3.5 w-3.5" /> Download Test PDF
            </button>
            <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-slate-950 p-6 flex justify-center items-start quote-template-preview-print">
          {mode === "full" ? (
            <div className="text-center text-slate-400 text-sm max-w-md py-12">
              <p className="mb-4">Full proposal deck opens in a new tab with mock lead data, including BOQ styling.</p>
              <button type="button" onClick={openFullTemplate} className="bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-lg">
                Open Full Template Preview
              </button>
            </div>
          ) : (
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
              <QuotePageLivePreview
                title={pageState.title}
                bodyHtml={pageState.body_html}
                bodyText={pageState.body_text}
                imageSections={pageState.imageSections}
                typography={{
                  fontFamily: pageState.fontFamily,
                  fontSize: pageState.fontSize,
                  headingColor: pageState.headingColor,
                  bodyColor: pageState.bodyColor,
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
