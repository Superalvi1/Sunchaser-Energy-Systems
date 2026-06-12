import React from "react";
import { Loader2, Upload } from "lucide-react";
import { WATERMARK_PLACEMENT_OPTIONS, type WatermarkPlacement } from "../../lib/watermarkStyles";
import type { PdfQualityMode } from "../../lib/quoteAuthoring";

export type QuoteTemplateGlobalSettingsProps = {
  globalHeaderEnabled: boolean;
  setGlobalHeaderEnabled: (v: boolean) => void;
  globalHeaderText: string;
  setGlobalHeaderText: (v: string) => void;
  globalHeaderLogoUrl: string;
  setGlobalHeaderLogoUrl: (v: string) => void;
  globalHeaderLogoSize: string;
  setGlobalHeaderLogoSize: (v: string) => void;
  globalHeaderLineColor: string;
  setGlobalHeaderLineColor: (v: string) => void;
  globalHeaderAlignment: string;
  setGlobalHeaderAlignment: (v: string) => void;
  globalFooterEnabled: boolean;
  setGlobalFooterEnabled: (v: boolean) => void;
  globalFooterText: string;
  setGlobalFooterText: (v: string) => void;
  globalFooterLineColor: string;
  setGlobalFooterLineColor: (v: string) => void;
  globalFooterAlignment: string;
  setGlobalFooterAlignment: (v: string) => void;
  globalWatermarkPreviewUrl: string;
  globalWatermarkUrl: string;
  setGlobalWatermarkUrl: (v: string) => void;
  globalWatermarkFile: string;
  setGlobalWatermarkFile: (v: string) => void;
  setGlobalWatermarkPreviewUrl: (v: string) => void;
  globalWatermarkOpacity: number;
  setGlobalWatermarkOpacity: (v: number) => void;
  globalWatermarkScale: number;
  setGlobalWatermarkScale: (v: number) => void;
  globalWatermarkPosition: WatermarkPlacement;
  setGlobalWatermarkPosition: (v: WatermarkPlacement) => void;
  globalWatermarkUploading: boolean;
  handleGlobalWatermarkUpload: (file: File) => void;
  handleRemoveGlobalWatermark: () => void;
  globalWatermarkPreviewStyle: React.CSSProperties | null;
  globalFontFamily: string;
  setGlobalFontFamily: (v: string) => void;
  globalFontSize: string;
  setGlobalFontSize: (v: string) => void;
  globalHeadingColor: string;
  setGlobalHeadingColor: (v: string) => void;
  globalBodyColor: string;
  setGlobalBodyColor: (v: string) => void;
  globalLineHeight: string;
  setGlobalLineHeight: (v: string) => void;
  pdfQuality: PdfQualityMode;
  setPdfQuality: (v: PdfQualityMode) => void;
  pageMarginTop: string;
  setPageMarginTop: (v: string) => void;
  pageMarginBottom: string;
  setPageMarginBottom: (v: string) => void;
  pageMarginLeft: string;
  setPageMarginLeft: (v: string) => void;
  pageMarginRight: string;
  setPageMarginRight: (v: string) => void;
  onSave: () => void;
  onUploadHeaderLogo: (file: File) => void;
};

const label = "text-[9px] uppercase font-mono text-slate-500 font-bold block mb-1";
const field = "w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-xs text-white";

export default function QuoteTemplateGlobalSettingsPanel(props: QuoteTemplateGlobalSettingsProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">
      <div className="flex justify-between items-center border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-lg font-bold text-white">Global PDF Settings</h3>
          <p className="text-xs text-slate-500">Logo, header, footer, watermark, typography, margins, and PDF quality.</p>
        </div>
        <button type="button" onClick={props.onSave} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2 text-sm rounded-lg">
          Save Global Settings
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-bold text-amber-500 uppercase">Header</h4>
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <input type="checkbox" checked={props.globalHeaderEnabled} onChange={(e) => props.setGlobalHeaderEnabled(e.target.checked)} />
              Enabled
            </label>
          </div>
          <input className={field} value={props.globalHeaderText} onChange={(e) => props.setGlobalHeaderText(e.target.value)} placeholder="Header text" />
          <div className="grid grid-cols-2 gap-2">
            <select className={field} value={props.globalHeaderAlignment} onChange={(e) => props.setGlobalHeaderAlignment(e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <input className={field} value={props.globalHeaderLineColor} onChange={(e) => props.setGlobalHeaderLineColor(e.target.value)} placeholder="#f59e0b" />
          </div>
          <input className={field} value={props.globalHeaderLogoSize} onChange={(e) => props.setGlobalHeaderLogoSize(e.target.value)} placeholder="Logo max height" />
          {props.globalHeaderLogoUrl ? (
            <div className="relative h-12 flex items-center justify-center border border-slate-800 rounded-lg bg-slate-900">
              <img src={props.globalHeaderLogoUrl} style={{ maxHeight: props.globalHeaderLogoSize }} alt="Logo" className="object-contain" />
              <button type="button" onClick={() => props.setGlobalHeaderLogoUrl("")} className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 text-rose-400 text-[10px] font-bold">
                Remove
              </button>
            </div>
          ) : (
            <label className="border border-dashed border-slate-800 rounded-lg h-12 flex items-center justify-center text-slate-500 cursor-pointer text-[10px] gap-1">
              <Upload className="h-3.5 w-3.5" /> Upload logo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onUploadHeaderLogo(f); e.target.value = ""; }} />
            </label>
          )}
        </section>

        <section className="bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-bold text-amber-500 uppercase">Footer</h4>
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <input type="checkbox" checked={props.globalFooterEnabled} onChange={(e) => props.setGlobalFooterEnabled(e.target.checked)} />
              Enabled
            </label>
          </div>
          <input className={field} value={props.globalFooterText} onChange={(e) => props.setGlobalFooterText(e.target.value)} placeholder="Footer text" />
          <div className="grid grid-cols-2 gap-2">
            <select className={field} value={props.globalFooterAlignment} onChange={(e) => props.setGlobalFooterAlignment(e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <input className={field} value={props.globalFooterLineColor} onChange={(e) => props.setGlobalFooterLineColor(e.target.value)} placeholder="#cbd5e1" />
          </div>
        </section>

        <section className="bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-3 lg:col-span-2">
          <h4 className="text-xs font-bold text-amber-500 uppercase">Global Watermark</h4>
          {props.globalWatermarkPreviewUrl ? (
            <div className="flex items-center gap-3 border border-slate-850 rounded-lg p-3">
              <img src={props.globalWatermarkPreviewUrl} alt="" className="h-16 w-16 object-contain bg-white rounded" />
              <button type="button" onClick={props.handleRemoveGlobalWatermark} className="text-rose-400 text-[10px] font-bold uppercase">
                Remove
              </button>
            </div>
          ) : (
            <label className="border border-dashed border-slate-850 rounded-lg h-20 flex flex-col items-center justify-center text-slate-500 cursor-pointer text-[10px]">
              {props.globalWatermarkUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4 mb-1" /> Upload watermark</>}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={props.globalWatermarkUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) props.handleGlobalWatermarkUpload(f); e.target.value = ""; }} />
            </label>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={label}>Scale ({props.globalWatermarkScale}%)</label>
              <input type="range" min={10} max={100} value={props.globalWatermarkScale} onChange={(e) => props.setGlobalWatermarkScale(parseInt(e.target.value, 10))} className="w-full accent-amber-500" />
            </div>
            <div>
              <label className={label}>Opacity</label>
              <input type="range" min={0} max={0.2} step={0.01} value={props.globalWatermarkOpacity} onChange={(e) => props.setGlobalWatermarkOpacity(parseFloat(e.target.value))} className="w-full accent-amber-500" />
            </div>
            <div>
              <label className={label}>Position</label>
              <select className={field} value={props.globalWatermarkPosition} onChange={(e) => props.setGlobalWatermarkPosition(e.target.value as WatermarkPlacement)}>
                {WATERMARK_PLACEMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="relative rounded-lg border border-slate-800 bg-white aspect-[210/297] max-w-[120px]">
              {props.globalWatermarkPreviewStyle && <div aria-hidden style={props.globalWatermarkPreviewStyle} />}
            </div>
          </div>
        </section>

        <section className="bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-3 lg:col-span-2">
          <h4 className="text-xs font-bold text-amber-500 uppercase">Font Defaults & PDF Quality</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className={label}>Font Family</label><input className={field} value={props.globalFontFamily} onChange={(e) => props.setGlobalFontFamily(e.target.value)} /></div>
            <div><label className={label}>Font Size</label><input className={field} value={props.globalFontSize} onChange={(e) => props.setGlobalFontSize(e.target.value)} /></div>
            <div><label className={label}>Line Height</label><input className={field} value={props.globalLineHeight} onChange={(e) => props.setGlobalLineHeight(e.target.value)} /></div>
            <div><label className={label}>Heading Color</label><input type="color" className="w-full h-9 rounded border border-slate-850" value={props.globalHeadingColor} onChange={(e) => props.setGlobalHeadingColor(e.target.value)} /></div>
            <div><label className={label}>Body Color</label><input type="color" className="w-full h-9 rounded border border-slate-850" value={props.globalBodyColor} onChange={(e) => props.setGlobalBodyColor(e.target.value)} /></div>
            <div>
              <label className={label}>PDF Quality</label>
              <select className={field} value={props.pdfQuality} onChange={(e) => props.setPdfQuality(e.target.value as PdfQualityMode)}>
                <option value="print">Print (high)</option>
                <option value="screen">Screen (fast)</option>
              </select>
            </div>
          </div>
        </section>

        <section className="bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-3 lg:col-span-2">
          <h4 className="text-xs font-bold text-amber-500 uppercase">Page Margins (mm)</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className={label}>Top</label><input className={field} placeholder="20" value={props.pageMarginTop} onChange={(e) => props.setPageMarginTop(e.target.value)} /></div>
            <div><label className={label}>Bottom</label><input className={field} placeholder="20" value={props.pageMarginBottom} onChange={(e) => props.setPageMarginBottom(e.target.value)} /></div>
            <div><label className={label}>Left</label><input className={field} placeholder="20" value={props.pageMarginLeft} onChange={(e) => props.setPageMarginLeft(e.target.value)} /></div>
            <div><label className={label}>Right</label><input className={field} placeholder="20" value={props.pageMarginRight} onChange={(e) => props.setPageMarginRight(e.target.value)} /></div>
          </div>
        </section>
      </div>
    </div>
  );
}
