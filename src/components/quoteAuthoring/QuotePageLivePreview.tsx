import React, { useMemo } from "react";
import {
  quoteAuthoringPrintCss,
  quoteTemplateBodyCss,
  renderEnhancedSignatureBlockHtml,
  getAuthoringTemplateMeta,
} from "../../lib/quoteAuthoring";
import { quotePdfPrintCss } from "../../lib/quotePdfLayout";
import {
  buildLivePreviewPageStyle,
  pageStateToExtendedSettings,
  renderQuoteTemplatePage,
  resolvePreviewWatermarkStyle,
  type TemplatePageAuthoringState,
} from "../../lib/quoteTemplatePageRender";

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
  densityMode?: string;
  pageWatermark?: { imageUrl?: string; opacity?: number; scale?: number; position?: string };
  globalWatermark?: Record<string, unknown> | null;
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
  densityMode,
  pageWatermark,
  globalWatermark,
}: QuotePageLivePreviewProps) {
  const pageState: TemplatePageAuthoringState = {
    body_text: bodyText,
    body_html: bodyHtml,
    imageSections,
    layoutMode,
    densityMode: densityMode as TemplatePageAuthoringState["densityMode"],
    fontSize: typography?.fontSize as string | undefined,
    lineHeight: typography?.lineHeight as string | undefined,
    fontFamily: typography?.fontFamily as string | undefined,
    headingColor: typography?.headingColor as string | undefined,
    bodyColor: typography?.bodyColor as string | undefined,
    textAlign: typography?.textAlign as string | undefined,
  };

  const { bodyHtml: bodyMarkup, typography: resolvedTypo } = useMemo(() => {
    const ext = pageStateToExtendedSettings(pageState, typography as Record<string, unknown>);
    if (pageWatermark?.imageUrl) {
      ext.watermark = {
        imageUrl: pageWatermark.imageUrl,
        opacity: pageWatermark.opacity,
        scale: pageWatermark.scale,
        position: pageWatermark.position as any,
      };
    }
    return renderQuoteTemplatePage(ext, typography as Record<string, unknown>);
  }, [bodyHtml, bodyText, imageSections, typography, layoutMode, densityMode, pageWatermark]);

  const watermarkStyle = useMemo(
    () =>
      resolvePreviewWatermarkStyle(
        pageWatermark?.imageUrl
          ? {
              imageUrl: pageWatermark.imageUrl,
              opacity: pageWatermark.opacity,
              scale: pageWatermark.scale,
              position: pageWatermark.position as any,
            }
          : {},
        globalWatermark as any
      ),
    [pageWatermark, globalWatermark]
  );

  const signatureHtml = useMemo(() => {
    if (layoutMode !== "ceo_signature_block" && layoutMode !== "signature_block") return "";
    return renderEnhancedSignatureBlockHtml(signatureBlock, ceoMessages);
  }, [layoutMode, signatureBlock, ceoMessages]);

  const templateMeta = pageTypeLabel ? getAuthoringTemplateMeta(pageTypeLabel as any) : null;
  const pageStyle = buildLivePreviewPageStyle(resolvedTypo);

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
        <div className="relative bg-white shadow-lg flex flex-col text-left page authoring-page" style={pageStyle}>
          <style>{quotePdfPrintCss()}</style>
          <style>{quoteAuthoringPrintCss("screen")}</style>
          <style>{quoteTemplateBodyCss()}</style>
          {watermarkStyle ? <div className="page-watermark" aria-hidden style={watermarkStyle as React.CSSProperties} /> : null}
          <div className="flex justify-between items-center border-b-2 border-amber-500 pb-3 mb-4 page-header-logo relative z-[1]">
            <div className="font-extrabold text-sm text-slate-900">SUNCHASER ENERGY</div>
            {templateMeta && (
              <span className="text-[8px] uppercase font-mono text-slate-500">{templateMeta.label}</span>
            )}
          </div>
          <div className="quote-page-shell quote-page-body-flow flex-1 flex flex-col min-h-0 relative z-[1]">
            {title ? <div className="page-title text-lg font-extrabold text-amber-600 mb-3">{title}</div> : null}
            {bodyMarkup ? <div dangerouslySetInnerHTML={{ __html: bodyMarkup }} /> : null}
            {signatureHtml ? (
              <div className="page-footer-slot mt-auto" dangerouslySetInnerHTML={{ __html: signatureHtml }} />
            ) : null}
          </div>
          <div className="page-footer border-t border-slate-200 pt-2 mt-4 text-[8px] text-slate-500 font-mono relative z-[1]">
            Sunchaser Energy Systems Proposal
          </div>
        </div>
      </div>
    </div>
  );
}
