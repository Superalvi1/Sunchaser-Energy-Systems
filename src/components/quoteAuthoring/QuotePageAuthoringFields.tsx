import React from "react";
import { Plus, Trash2 } from "lucide-react";
import QuoteRichTextEditor from "./QuoteRichTextEditor";
import QuotePageLivePreview from "./QuotePageLivePreview";
import {
  AUTHORING_PAGE_TYPES,
  appendHtmlToEditor,
  createDefaultImageSection,
  getDefaultBodyHtmlForPageType,
  mergeContentLibrary,
  type AuthoringPageType,
  type ContentLibraryBlock,
} from "../../lib/quoteAuthoring";
import { API_BASE_URL } from "../../services/api";
import type { QuoteImageSection } from "../../lib/quotePdfLayout";

export type PageAuthoringState = {
  title: string;
  body_html: string;
  body_text: string;
  authoringPageType: AuthoringPageType;
  layoutMode: string;
  imageSections: QuoteImageSection[];
  fontFamily: string;
  fontSize: string;
  headingColor: string;
  bodyColor: string;
  lineHeight: string;
  textAlign: string;
  sigCeoEnabled: boolean;
  sigCeoName: string;
  sigCeoTitle: string;
  sigCeoUrl: string;
  sigTechEnabled: boolean;
  sigTechName: string;
  sigTechTitle: string;
  sigTechUrl: string;
  sigSalesEnabled: boolean;
  sigSalesName: string;
  sigSalesTitle: string;
  sigSalesUrl: string;
  [key: string]: any;
};

type QuotePageAuthoringFieldsProps = {
  pageId: string;
  pageState: PageAuthoringState;
  contentLibrary: ContentLibraryBlock[];
  ceoMessages?: any[];
  onFieldChange: (pageId: string, field: string, value: any) => void;
};

async function uploadSignatureImage(file: File): Promise<string> {
  const reader = new FileReader();
  const base64Data = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
  const response = await fetch(`${API_BASE_URL}/api/quote-assets/watermark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data, settingsId: "signature" }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Upload failed");
  return payload.publicUrl || "";
}

export default function QuotePageAuthoringFields({
  pageId,
  pageState,
  contentLibrary,
  ceoMessages = [],
  onFieldChange,
}: QuotePageAuthoringFieldsProps) {
  const blocks = mergeContentLibrary(contentLibrary);

  const updateImageSection = (idx: number, patch: Partial<QuoteImageSection>) => {
    const next = [...(pageState.imageSections || [])];
    next[idx] = { ...next[idx], ...patch };
    onFieldChange(pageId, "imageSections", next);
  };

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
    <>
      <div className="space-y-2">
        <label className="text-[9px] uppercase font-mono text-slate-500 font-bold">Page Type Template</label>
        <select
          value={pageState.authoringPageType}
          onChange={(e) => {
            const nextType = e.target.value as AuthoringPageType;
            onFieldChange(pageId, "authoringPageType", nextType);
            if (!pageState.body_html?.trim()) {
              onFieldChange(pageId, "body_html", getDefaultBodyHtmlForPageType(nextType));
            }
          }}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
        >
          {AUTHORING_PAGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="text-[9px] text-slate-500">
          {AUTHORING_PAGE_TYPES.find((t) => t.value === pageState.authoringPageType)?.description}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-[9px] uppercase font-mono text-slate-500 font-bold">Content Library</label>
        <div className="flex flex-wrap gap-1.5">
          {blocks.map((block) => (
            <button
              key={block.id}
              type="button"
              onClick={() =>
                onFieldChange(pageId, "body_html", appendHtmlToEditor(pageState.body_html || "", block.html))
              }
              className="text-[9px] px-2 py-1 rounded-full border border-slate-800 bg-slate-900 hover:border-amber-500/40 hover:text-amber-400 text-slate-400"
            >
              + {block.name}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[9px] uppercase font-mono text-slate-500 font-bold">Page Body (Rich Editor)</label>
        <QuoteRichTextEditor
          value={pageState.body_html || ""}
          onChange={(html) => onFieldChange(pageId, "body_html", html)}
          minHeight={180}
        />
      </div>

      <div className="space-y-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-900/80">
        <div className="flex justify-between items-center">
          <label className="text-[9px] uppercase font-mono text-amber-500 font-bold">Image Placement</label>
          <button
            type="button"
            onClick={() =>
              onFieldChange(pageId, "imageSections", [...(pageState.imageSections || []), createDefaultImageSection()])
            }
            className="text-[9px] text-amber-500 flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Add Image Block
          </button>
        </div>
        {(pageState.imageSections || []).map((sec, idx) => (
          <div key={sec.id} className="grid grid-cols-2 gap-2 border border-slate-850 rounded-lg p-2">
            <div className="col-span-2 flex justify-between">
              <span className="text-[8px] uppercase text-slate-500 font-mono">Image Block {idx + 1}</span>
              <button
                type="button"
                onClick={() =>
                  onFieldChange(
                    pageId,
                    "imageSections",
                    (pageState.imageSections || []).filter((s) => s.id !== sec.id)
                  )
                }
              >
                <Trash2 className="h-3 w-3 text-rose-400" />
              </button>
            </div>
            <select
              value={sec.layout}
              onChange={(e) => updateImageSection(idx, { layout: e.target.value as QuoteImageSection["layout"] })}
              className="col-span-2 bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white"
            >
              <option value="full_width">Full Width Image</option>
              <option value="left_image">Left Image + Right Text</option>
              <option value="right_image">Right Image + Left Text</option>
              <option value="center">Center Image</option>
            </select>
            <input
              type="text"
              placeholder="Image URL"
              value={sec.imageUrl}
              onChange={(e) => updateImageSection(idx, { imageUrl: e.target.value })}
              className="col-span-2 bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white font-mono"
            />
            <input
              type="number"
              min={20}
              max={100}
              placeholder="Width %"
              value={sec.widthPercent ?? 100}
              onChange={(e) => updateImageSection(idx, { widthPercent: Number(e.target.value) })}
              className="bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white"
            />
            {(sec.layout === "left_image" || sec.layout === "right_image") && (
              <input
                type="text"
                placeholder="Companion text (HTML ok)"
                value={sec.textHtml || ""}
                onChange={(e) => updateImageSection(idx, { textHtml: e.target.value })}
                className="bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white"
              />
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <label className="text-[9px] uppercase font-mono text-slate-500 font-bold block">Page Layout Mode</label>
        <select
          value={pageState.layoutMode}
          onChange={(e) => onFieldChange(pageId, "layoutMode", e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
        >
          <option value="standard">Standard (Header, Title, Text, Footer)</option>
          <option value="signature_block">Signature Block Page</option>
          <option value="ceo_signature_block">CEO Signature Block (legacy)</option>
          <option value="image_only">Image Only Page</option>
          <option value="full_page_image">Full Page Image Only</option>
        </select>
      </div>

      {(pageState.layoutMode === "signature_block" || pageState.layoutMode === "ceo_signature_block") && (
        <div className="space-y-2 bg-slate-900/40 p-2.5 rounded-xl border border-slate-900/80">
          <label className="text-[9px] uppercase font-mono text-amber-500 font-bold block">Signature Block</label>
          {[
            { key: "sigCeo", label: "CEO Signature", enabled: "sigCeoEnabled", name: "sigCeoName", title: "sigCeoTitle", url: "sigCeoUrl" },
            { key: "sigTech", label: "Technical Director", enabled: "sigTechEnabled", name: "sigTechName", title: "sigTechTitle", url: "sigTechUrl" },
            { key: "sigSales", label: "Sales Advisor", enabled: "sigSalesEnabled", name: "sigSalesName", title: "sigSalesTitle", url: "sigSalesUrl" },
          ].map((role) => (
            <div key={role.key} className="border border-slate-850 rounded-lg p-2 space-y-1">
              <label className="flex items-center gap-2 text-[10px] text-slate-300">
                <input
                  type="checkbox"
                  checked={!!pageState[role.enabled]}
                  onChange={(e) => onFieldChange(pageId, role.enabled, e.target.checked)}
                  className="rounded border-slate-800"
                />
                {role.label}
              </label>
              {pageState[role.enabled] && (
                <div className="grid grid-cols-2 gap-1.5">
                  <input type="text" placeholder="Name" value={pageState[role.name] || ""} onChange={(e) => onFieldChange(pageId, role.name, e.target.value)} className="bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white" />
                  <input type="text" placeholder="Title" value={pageState[role.title] || ""} onChange={(e) => onFieldChange(pageId, role.title, e.target.value)} className="bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white" />
                  <input type="text" placeholder="Signature URL" value={pageState[role.url] || ""} onChange={(e) => onFieldChange(pageId, role.url, e.target.value)} className="col-span-2 bg-slate-950 border border-slate-850 rounded px-2 py-1 text-[11px] text-white font-mono" />
                  <label className="col-span-2 text-[9px] text-slate-500 cursor-pointer">
                    Upload signature image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const url = await uploadSignatureImage(file);
                          onFieldChange(pageId, role.url, url);
                        } catch (err: any) {
                          alert(err.message || "Upload failed");
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
      />
    </>
  );
}
