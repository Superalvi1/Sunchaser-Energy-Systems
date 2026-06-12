import React, { useMemo } from "react";
import {
  quoteAuthoringPrintCss,
  renderPageBodyHtml,
  renderEnhancedSignatureBlockHtml,
  getAuthoringTemplateMeta,
} from "../../lib/quoteAuthoring";
import { quotePdfPrintCss } from "../../lib/quotePdfLayout";

type QuotePageLivePreviewProps = {
  title?: string;
  bodyHtml?: string;
  bodyText?: string;
  imageSections?: any[];
  typography?: Record<string, unknown>;
  layoutMode?: string;
  signatureBlock?: any;
  ceoMessages?: any[];
  pageTypeLabel?: string;
  embedded?: boolean;
  large?: boolean;
};

export default function QuotePageLivePreview({
  title,
  bodyHtml,
  bodyText,
  imageSections,
  typography,
  layoutMode,
  signatureBlock,
  ceoMessages = [],
  pageTypeLabel,
  embedded = false,
  large = false,
}: QuotePageLivePreviewProps) {
  const bodyMarkup = useMemo(
    () =>
      renderPageBodyHtml(
        { bodyHtml, bodyText, imageSections },
        {
          align: String(typography?.textAlign || "left"),
          typography: typography as any,
        }
      ),
    [bodyHtml, bodyText, imageSections, typography]
  );

  const signatureHtml = useMemo(() => {
    if (layoutMode !== "ceo_signature_block" && layoutMode !== "signature_block") return "";
    return renderEnhancedSignatureBlockHtml(signatureBlock, ceoMessages);
  }, [layoutMode, signatureBlock, ceoMessages]);

  const templateMeta = pageTypeLabel ? getAuthoringTemplateMeta(pageTypeLabel as any) : null;

  return (
    <div className={embedded ? "h-full" : "space-y-2"}>
      {!embedded && (
        <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Live A4 Preview</label>
      )}
      <div
        className={`flex justify-center bg-slate-950 rounded-xl border border-slate-850 overflow-auto ${
          embedded ? "h-full p-2" : large ? "p-4 max-h-[min(72vh,900px)]" : "p-3 max-h-[420px]"
        }`}
      >
        <div
          className="relative bg-white shadow-lg flex flex-col text-left"
          style={{
            width: "210mm",
            minHeight: "297mm",
            maxWidth: "100%",
            padding: "16mm",
            boxSizing: "border-box",
            fontFamily: String(typography?.fontFamily || "Inter, sans-serif"),
            fontSize: String(typography?.fontSize || "11px"),
            lineHeight: String(typography?.lineHeight || "1.6"),
            color: String(typography?.bodyColor || "#475569"),
          }}
        >
          <style>{quotePdfPrintCss()}</style>
          <style>{quoteAuthoringPrintCss("screen")}</style>
          <div className="flex justify-between items-center border-b-2 border-amber-500 pb-3 mb-4">
            <div className="font-extrabold text-sm text-slate-900">SUNCHASER ENERGY</div>
            {templateMeta && (
              <span className="text-[8px] uppercase font-mono text-slate-500">{templateMeta.label}</span>
            )}
          </div>
          <div className="quote-page-body-flow flex-1 flex flex-col min-h-0">
            {title ? <div className="page-title text-lg font-extrabold text-amber-600 mb-3">{title}</div> : null}
            {bodyMarkup ? <div dangerouslySetInnerHTML={{ __html: bodyMarkup }} /> : null}
            {signatureHtml ? (
              <div className="page-footer-slot mt-auto" dangerouslySetInnerHTML={{ __html: signatureHtml }} />
            ) : null}
          </div>
          <div className="border-t border-slate-200 pt-2 mt-4 text-[8px] text-slate-500 font-mono">
            Sunchaser Energy Systems Proposal
          </div>
        </div>
      </div>
    </div>
  );
}
