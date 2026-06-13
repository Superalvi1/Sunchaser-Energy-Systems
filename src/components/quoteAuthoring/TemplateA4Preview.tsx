import React, { useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import QuotePageLivePreview from "./QuotePageLivePreview";
import type { PageAuthoringState } from "./QuotePageAuthoringFields";

type Props = {
  pageState: PageAuthoringState & Record<string, any>;
  globalFontFamily: string;
  globalFontSize: string;
  globalLineHeight: string;
  globalHeadingColor: string;
  globalBodyColor: string;
  ceoMessages?: any[];
  onFullscreen: () => void;
};

const ZOOM_PRESETS = [
  { id: "fit", label: "Fit", scale: 0.55 },
  { id: "75", label: "75%", scale: 0.75 },
  { id: "100", label: "100%", scale: 1 },
] as const;

export default function TemplateA4Preview({
  pageState,
  globalFontFamily,
  globalFontSize,
  globalLineHeight,
  globalHeadingColor,
  globalBodyColor,
  ceoMessages = [],
  onFullscreen,
}: Props) {
  const [zoomId, setZoomId] = useState<(typeof ZOOM_PRESETS)[number]["id"]>("fit");
  const [customScale, setCustomScale] = useState(0.55);

  const scale = zoomId === "fit" ? customScale : ZOOM_PRESETS.find((z) => z.id === zoomId)?.scale ?? 0.75;

  const signatureBlock = {
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
  };

  return (
    <aside className="w-[min(480px,42vw)] min-w-[420px] shrink-0 flex flex-col border-l border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
        <p className="text-[10px] uppercase font-mono text-slate-500 font-bold">Live A4 Preview</p>
        <div className="flex items-center gap-1">
          {ZOOM_PRESETS.map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() => {
                setZoomId(z.id);
                if (z.id === "fit") setCustomScale(0.55);
              }}
              className={`text-[9px] px-2 py-0.5 rounded font-bold ${
                zoomId === z.id ? "bg-amber-500/20 text-amber-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {z.label}
            </button>
          ))}
          <button type="button" onClick={() => setCustomScale((s) => Math.max(0.35, s - 0.05))} className="p-0.5 text-slate-500 hover:text-white">
            <Minus className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => setCustomScale((s) => Math.min(1.15, s + 0.05))} className="p-0.5 text-slate-500 hover:text-white">
            <Plus className="h-3 w-3" />
          </button>
          <button type="button" onClick={onFullscreen} className="p-1 text-slate-400 hover:text-amber-400" title="Fullscreen Preview">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 flex justify-center items-start min-h-0">
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}>
          <QuotePageLivePreview
            title={pageState.title}
            bodyHtml={pageState.body_html}
            bodyText={pageState.body_text}
            imageSections={pageState.imageSections}
            typography={{
              fontFamily: pageState.fontFamily || globalFontFamily,
              fontSize: pageState.fontSize || globalFontSize,
              headingColor: pageState.headingColor || globalHeadingColor,
              bodyColor: pageState.bodyColor || globalBodyColor,
              lineHeight: pageState.lineHeight || globalLineHeight,
              textAlign: pageState.textAlign,
              densityMode: pageState.densityMode,
            }}
            densityMode={pageState.densityMode}
            layoutMode={pageState.layoutMode}
            signatureBlock={signatureBlock}
            ceoMessages={ceoMessages}
            pageTypeLabel={pageState.authoringPageType}
            embedded
            large
          />
        </div>
      </div>
    </aside>
  );
}
