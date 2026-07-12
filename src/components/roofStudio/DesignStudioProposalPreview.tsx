/**
 * Draft proposal preview — Design Studio outputs via existing Proposal Studio page model.
 * No save, PDF, or CRM mutation.
 */

import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import {
  buildDesignStudioProposalIntegration,
  type DesignStudioProposalCustomer,
  type DesignStudioProposalRoofPreview,
} from "../../lib/designStudioProposalIntegration";
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

  return (
    <div className="space-y-2" data-testid="design-studio-proposal-preview">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <FileText className="h-3.5 w-3.5 text-violet-400" />
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Proposal Preview</h3>
        <span className="ml-auto rounded-full border border-slate-700 px-2 py-0.5 text-[8px] font-bold uppercase text-slate-400">
          Draft only
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

      <p className="text-[9px] text-slate-500 px-0.5">
        Proposal pages from Design Studio engines. Not saved or exported as PDF.
      </p>
    </div>
  );
}
