import React from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import {
  AUTHORING_PAGE_TYPES,
  createDefaultImageSection,
  getDefaultBodyHtmlForPageType,
  type AuthoringPageType,
  type ContentLibraryBlock,
} from "../../lib/quoteAuthoring";
import type { QuoteImageSection } from "../../lib/quotePdfLayout";
import type { PageAuthoringState } from "./QuotePageAuthoringFields";

type Props = {
  pageId: string;
  page: any;
  pageState: PageAuthoringState;
  globalFontFamily: string;
  globalHeadingColor: string;
  globalBodyColor: string;
  onFieldChange: (pageId: string, field: string, value: any) => void;
  onImageUpload: (pageId: string, file: File, type: "image" | "bg") => void;
  uploadImageFile: (file: File, isBg: boolean) => Promise<string>;
};

const label = "text-[9px] uppercase font-mono text-slate-500 font-bold block mb-1";
const field = "w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-xs text-white";

export default function QuoteTemplatePageSettingsPanel({
  pageId,
  page,
  pageState,
  globalFontFamily,
  globalHeadingColor,
  globalBodyColor,
  onFieldChange,
  onImageUpload,
  uploadImageFile,
}: Props) {
  const pageType = page.page_type || page.pageType || "";

  const updateImageSection = (idx: number, patch: Partial<QuoteImageSection>) => {
    const next = [...(pageState.imageSections || [])];
    next[idx] = { ...next[idx], ...patch };
    onFieldChange(pageId, "imageSections", next);
  };

  return (
    <div className="space-y-4 text-left overflow-y-auto pr-1">
      <div>
        <label className={label}>Page Title</label>
        <input className={field} value={pageState.title} onChange={(e) => onFieldChange(pageId, "title", e.target.value)} />
      </div>

      <div>
        <label className={label}>Page Type</label>
        <select
          className={field}
          value={pageState.authoringPageType}
          onChange={(e) => {
            const nextType = e.target.value as AuthoringPageType;
            onFieldChange(pageId, "authoringPageType", nextType);
            if (!pageState.body_html?.trim()) {
              onFieldChange(pageId, "body_html", getDefaultBodyHtmlForPageType(nextType));
            }
          }}
        >
          {AUTHORING_PAGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>Layout Mode</label>
        <select className={field} value={pageState.layoutMode} onChange={(e) => onFieldChange(pageId, "layoutMode", e.target.value)}>
          <option value="standard">Standard</option>
          <option value="signature_block">Signature Block</option>
          <option value="ceo_signature_block">CEO Signature (legacy)</option>
          <option value="image_only">Image Only</option>
          <option value="full_page_image">Full Page Image</option>
        </select>
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Typography</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Density</label>
            <select className={field} value={pageState.densityMode} onChange={(e) => onFieldChange(pageId, "densityMode", e.target.value)}>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="spacious">Spacious</option>
            </select>
          </div>
          <div>
            <label className={label}>Align</label>
            <select className={field} value={pageState.textAlign} onChange={(e) => onFieldChange(pageId, "textAlign", e.target.value)}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div>
            <label className={label}>Font Size</label>
            <input className={field} placeholder="11px" value={pageState.fontSize} onChange={(e) => onFieldChange(pageId, "fontSize", e.target.value)} />
          </div>
          <div>
            <label className={label}>Line Height</label>
            <input className={field} placeholder="1.6" value={pageState.lineHeight} onChange={(e) => onFieldChange(pageId, "lineHeight", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={label}>Font Family</label>
            <input className={field} placeholder={globalFontFamily} value={pageState.fontFamily} onChange={(e) => onFieldChange(pageId, "fontFamily", e.target.value)} />
          </div>
          <div>
            <label className={label}>Heading Color</label>
            <input type="color" className="w-full h-9 rounded border border-slate-850" value={pageState.headingColor || globalHeadingColor} onChange={(e) => onFieldChange(pageId, "headingColor", e.target.value)} />
          </div>
          <div>
            <label className={label}>Body Color</label>
            <input type="color" className="w-full h-9 rounded border border-slate-850" value={pageState.bodyColor || globalBodyColor} onChange={(e) => onFieldChange(pageId, "bodyColor", e.target.value)} />
          </div>
        </div>
        {pageType === "cover" && (
          <div>
            <label className={label}>Cover Layout</label>
            <select className={field} value={pageState.coverLayoutMode} onChange={(e) => onFieldChange(pageId, "coverLayoutMode", e.target.value)}>
              <option value="classic">Classic Word Style</option>
              <option value="modern">Modern CRM Style</option>
            </select>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Header & Footer</p>
        <div>
          <label className={label}>Header</label>
          <select className={field} value={pageState.headerMode} onChange={(e) => onFieldChange(pageId, "headerMode", e.target.value)}>
            <option value="inherit">Inherit Global</option>
            <option value="custom">Custom Header</option>
            <option value="disabled">Hide Header</option>
          </select>
        </div>
        {pageState.headerMode === "custom" && (
          <div className="space-y-2 pl-1">
            <input className={field} placeholder="Header text" value={pageState.headerText} onChange={(e) => onFieldChange(pageId, "headerText", e.target.value)} />
            <input className={field} placeholder="Header logo URL" value={pageState.headerLogoUrl} onChange={(e) => onFieldChange(pageId, "headerLogoUrl", e.target.value)} />
          </div>
        )}
        <div>
          <label className={label}>Footer</label>
          <select className={field} value={pageState.footerMode} onChange={(e) => onFieldChange(pageId, "footerMode", e.target.value)}>
            <option value="inherit">Inherit Global</option>
            <option value="custom">Custom Footer</option>
            <option value="disabled">Hide Footer</option>
          </select>
        </div>
        {pageState.footerMode === "custom" && (
          <input className={field} placeholder="Footer text" value={pageState.footerText} onChange={(e) => onFieldChange(pageId, "footerText", e.target.value)} />
        )}
      </div>

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Watermark / Background</p>
        <input className={field} placeholder="Watermark image URL" value={pageState.watermarkUrl} onChange={(e) => onFieldChange(pageId, "watermarkUrl", e.target.value)} />
        <label className="text-[9px] text-slate-500 cursor-pointer flex items-center gap-1">
          <Upload className="h-3 w-3" /> Upload background
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImageUpload(pageId, f, "bg"); e.target.value = ""; }} />
        </label>
        {pageState.bg_image_url && <p className="text-[9px] text-emerald-500 truncate">BG set</p>}
        <label className="text-[9px] text-slate-500 cursor-pointer flex items-center gap-1">
          <Upload className="h-3 w-3" /> Upload logo / foreground
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImageUpload(pageId, f, "image"); e.target.value = ""; }} />
        </label>
        {pageState.image_url && <p className="text-[9px] text-emerald-500 truncate">Logo set</p>}
      </div>

      {(pageState.layoutMode === "signature_block" || pageState.layoutMode === "ceo_signature_block") && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Signature Block</p>
          {[
            { key: "sigCeo", label: "CEO", enabled: "sigCeoEnabled", name: "sigCeoName", title: "sigCeoTitle", url: "sigCeoUrl" },
            { key: "sigTech", label: "Technical Director", enabled: "sigTechEnabled", name: "sigTechName", title: "sigTechTitle", url: "sigTechUrl" },
            { key: "sigSales", label: "Sales Advisor", enabled: "sigSalesEnabled", name: "sigSalesName", title: "sigSalesTitle", url: "sigSalesUrl" },
          ].map((role) => (
            <div key={role.key} className="border border-slate-850 rounded-lg p-2 space-y-1">
              <label className="flex items-center gap-2 text-[10px] text-slate-300">
                <input type="checkbox" checked={!!pageState[role.enabled]} onChange={(e) => onFieldChange(pageId, role.enabled, e.target.checked)} />
                {role.label}
              </label>
              {pageState[role.enabled] && (
                <div className="grid grid-cols-1 gap-1">
                  <input className={field} placeholder="Name" value={pageState[role.name] || ""} onChange={(e) => onFieldChange(pageId, role.name, e.target.value)} />
                  <input className={field} placeholder="Title" value={pageState[role.title] || ""} onChange={(e) => onFieldChange(pageId, role.title, e.target.value)} />
                  <label className="text-[9px] text-slate-500 cursor-pointer">
                    Upload signature
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const url = await uploadImageFile(file, false);
                        onFieldChange(pageId, role.url, url);
                      } catch (err: any) {
                        alert(err.message || "Upload failed");
                      }
                      e.target.value = "";
                    }} />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <div className="flex justify-between items-center">
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Image Blocks</p>
          <button type="button" className="text-[9px] text-amber-500 flex items-center gap-1" onClick={() => onFieldChange(pageId, "imageSections", [...(pageState.imageSections || []), createDefaultImageSection()])}>
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {(pageState.imageSections || []).map((sec, idx) => (
          <div key={sec.id} className="border border-slate-850 rounded p-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-[8px] text-slate-500">Block {idx + 1}</span>
              <button type="button" onClick={() => onFieldChange(pageId, "imageSections", (pageState.imageSections || []).filter((s) => s.id !== sec.id))}>
                <Trash2 className="h-3 w-3 text-rose-400" />
              </button>
            </div>
            <select className={field} value={sec.layout} onChange={(e) => updateImageSection(idx, { layout: e.target.value as QuoteImageSection["layout"] })}>
              <option value="full_width">Full Width</option>
              <option value="left_image">Left Image</option>
              <option value="right_image">Right Image</option>
              <option value="center">Center</option>
            </select>
            <input className={field} placeholder="Image URL" value={sec.imageUrl} onChange={(e) => updateImageSection(idx, { imageUrl: e.target.value })} />
          </div>
        ))}
      </div>
    </div>
  );
}
