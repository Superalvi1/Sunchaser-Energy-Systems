/**
 * Design Studio proposal preview + RC-1.1 Generate → Download PDF.
 * Ephemeral export via existing Playwright PDF generator. No CRM save / AI.
 */

import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, Sparkles } from "lucide-react";
import {
  buildDesignStudioProposalIntegration,
  type DesignStudioProposalCustomer,
  type DesignStudioProposalRoofPreview,
} from "../../lib/designStudioProposalIntegration";
import {
  assertExportPayloadReady,
  buildDesignStudioProposalExportPayload,
  buildProposalExportFilename,
  compileDesignStudioProposalHtml,
  payloadHasRequiredSections,
  resolveRoofImageDataUrl,
  type DesignStudioProposalExportPayload,
  type ProposalExportProgress,
} from "../../lib/designStudioProposalExport";
import { downloadDesignStudioProposalPdf } from "../../lib/quotePdfExport";
import type { DesignStudioControls, DesignStudioLiveResults } from "../../lib/sunchaserDesignStudioClient";

export interface DesignStudioProposalPreviewProps {
  live: DesignStudioLiveResults;
  controls: DesignStudioControls;
  customer: DesignStudioProposalCustomer;
  roofPreview: DesignStudioProposalRoofPreview;
}

export default function DesignStudioProposalPreview({
  live,
  controls,
  customer,
  roofPreview,
}: DesignStudioProposalPreviewProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [progress, setProgress] = useState<ProposalExportProgress>("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportPayload, setExportPayload] = useState<DesignStudioProposalExportPayload | null>(null);

  const integration = useMemo(
    () =>
      buildDesignStudioProposalIntegration({
        live,
        controls,
        customer,
        roofPreview,
      }),
    [live, controls, customer, roofPreview]
  );

  const pages = integration.pages;
  const activePage = pages[pageIndex] ?? null;
  const showRoofImage =
    integration.ready &&
    integration.roofImageUrl &&
    (activePage?.id === "site-design" || activePage?.id === "cover");

  const busy = progress === "generating" || progress === "downloading";

  const handleGenerateProposal = async () => {
    if (!integration.ready) {
      setExportError(integration.gatedReason || "Complete design steps before generating a proposal.");
      setProgress("error");
      return;
    }
    setExportError(null);
    setProgress("generating");
    try {
      const roofImageDataUrl = await resolveRoofImageDataUrl(integration.roofImageUrl);
      const payload = buildDesignStudioProposalExportPayload(integration, { roofImageDataUrl });
      const required = payloadHasRequiredSections(payload);
      if (!required.boq || !required.electrical) {
        throw new Error("Generated proposal is missing BOQ or electrical summary sections.");
      }
      // Compile once so Download is one click and PDF content is frozen at generate time.
      compileDesignStudioProposalHtml(payload);
      setExportPayload(payload);
      setProgress("ready");
    } catch (err: any) {
      setExportPayload(null);
      setExportError(err?.message || "Failed to generate proposal.");
      setProgress("error");
    }
  };

  const handleDownloadPdf = async () => {
    setExportError(null);
    try {
      assertExportPayloadReady(exportPayload);
      setProgress("downloading");
      await downloadDesignStudioProposalPdf({
        payload: exportPayload,
        filename: buildProposalExportFilename(exportPayload.customer),
      });
      setProgress("done");
    } catch (err: any) {
      setExportError(err?.message || "PDF download failed.");
      setProgress("error");
    }
  };

  return (
    <div className="space-y-2" data-testid="design-studio-proposal-preview">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <FileText className="h-3.5 w-3.5 text-violet-400" />
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Proposal Preview</h3>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase ${
            progress === "ready" || progress === "done"
              ? "border-emerald-500/40 text-emerald-300"
              : "border-slate-700 text-slate-400"
          }`}
          data-testid="proposal-export-status"
        >
          {progress === "ready" || progress === "done" ? "Generated" : "Draft"}
        </span>
      </div>

      {!integration.ready && (
        <p className="text-[10px] text-amber-300/90" data-testid="proposal-preview-gated">
          {integration.gatedReason ?? "Complete design steps to preview proposal."}
        </p>
      )}

      {pages.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              disabled={pageIndex <= 0}
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
              className="rounded-lg border border-slate-800 p-1.5 text-slate-400 disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="flex flex-wrap justify-center gap-1">
              {pages.map((page, idx) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => setPageIndex(idx)}
                  className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                    idx === pageIndex
                      ? "bg-violet-500/20 text-violet-200 border border-violet-500/40"
                      : "text-slate-500 border border-transparent hover:text-slate-300"
                  }`}
                >
                  {page.title}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={pageIndex >= pages.length - 1}
              onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
              className="rounded-lg border border-slate-800 p-1.5 text-slate-400 disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {activePage && (
            <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-slate-950 to-violet-950/20 p-3 min-h-[160px]">
              <p className="text-[9px] font-bold uppercase tracking-wider text-violet-400/80">
                {activePage.subtitle}
              </p>
              <h4 className="mt-0.5 text-sm font-bold text-white">{activePage.title}</h4>

              {showRoofImage && integration.roofImageUrl && (
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                  <img
                    src={integration.roofImageUrl}
                    alt="Roof layout preview"
                    className="max-h-32 w-full object-contain"
                    data-testid="proposal-roof-layout-image"
                  />
                  <p className="px-2 py-1 text-[9px] text-slate-500">
                    {integration.roofImageFileName ?? "Roof image"} · {live.panelCount} panels
                  </p>
                </div>
              )}

              <div className="mt-2 space-y-2">
                {activePage.sections.map((section) => (
                  <div key={section.heading}>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      {section.heading}
                    </p>
                    <ul className="mt-0.5 space-y-0.5">
                      {section.lines.map((line) => (
                        <li key={line} className="text-[10px] text-slate-300 leading-relaxed">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2" data-testid="proposal-export-actions">
        <p className="px-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
          Proposal export
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!integration.ready || busy}
            onClick={() => void handleGenerateProposal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 hover:bg-violet-400"
            data-testid="proposal-generate-btn"
          >
            {progress === "generating" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Generate Proposal
          </button>
          <button
            type="button"
            disabled={!exportPayload || busy}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-cyan-500/20"
            data-testid="proposal-download-pdf-btn"
          >
            {progress === "downloading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download PDF
          </button>
        </div>
        <div className="px-0.5 text-[9px] text-slate-500" data-testid="proposal-export-progress">
          {progress === "idle" && "Preview → Generate Proposal → Download PDF (not saved to CRM)."}
          {progress === "generating" && "Generating proposal pages…"}
          {progress === "ready" && "Proposal ready. Download PDF when you need the branded file."}
          {progress === "downloading" && "Rendering PDF with Sunchaser branding…"}
          {progress === "done" && "PDF downloaded."}
          {progress === "error" && (exportError || "Export failed.")}
        </div>
        {exportError && progress === "error" && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-200" data-testid="proposal-export-error">
            {exportError}
          </p>
        )}
      </div>
    </div>
  );
}
