import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { appendHtmlToEditor, mergeContentLibrary, type ContentLibraryBlock } from "../../lib/quoteAuthoring";
import QuoteRichTextEditor from "./QuoteRichTextEditor";
import QuoteTemplatePageSettingsPanel from "./QuoteTemplatePageSettingsPanel";
import type { PageAuthoringState } from "./QuotePageAuthoringFields";

type Props = {
  page: any;
  pageState: PageAuthoringState & Record<string, any>;
  contentLibrary: ContentLibraryBlock[];
  globalFontFamily: string;
  globalHeadingColor: string;
  globalBodyColor: string;
  onFieldChange: (pageId: string, field: string, value: any) => void;
  onImageUpload: (pageId: string, file: File, type: "image" | "bg") => void;
  uploadImageFile: (file: File, isBg: boolean) => Promise<string>;
};

export default function TemplatePageEditor({
  page,
  pageState,
  contentLibrary,
  globalFontFamily,
  globalHeadingColor,
  globalBodyColor,
  onFieldChange,
  onImageUpload,
  uploadImageFile,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const blocks = mergeContentLibrary(contentLibrary);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-900">
      <div className="border-b border-slate-800 bg-slate-950 shrink-0">
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-500"
        >
          Page Settings
          {settingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {settingsOpen && (
          <div className="max-h-[220px] overflow-y-auto px-4 pb-3 border-t border-slate-900">
            <QuoteTemplatePageSettingsPanel
              pageId={page.id}
              page={page}
              pageState={pageState}
              globalFontFamily={globalFontFamily}
              globalHeadingColor={globalHeadingColor}
              globalBodyColor={globalBodyColor}
              onFieldChange={onFieldChange}
              onImageUpload={onImageUpload}
              uploadImageFile={uploadImageFile}
            />
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-b border-slate-800 bg-slate-950 shrink-0">
        <p className="text-[9px] uppercase font-mono text-slate-500 font-bold mb-1.5">Content Library</p>
        <div className="flex flex-wrap gap-1">
          {blocks.map((block) => (
            <button
              key={block.id}
              type="button"
              onClick={() =>
                onFieldChange(page.id, "body_html", appendHtmlToEditor(pageState.body_html || "", block.html))
              }
              className="text-[9px] px-2 py-0.5 rounded-full border border-slate-800 bg-slate-900 hover:border-amber-500/40 text-slate-400 hover:text-amber-400"
            >
              + {block.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-[600px] p-4 overflow-hidden flex flex-col">
        <QuoteRichTextEditor
          value={pageState.body_html || ""}
          onChange={(html) => onFieldChange(page.id, "body_html", html)}
          minHeight={600}
          stickyToolbar
        />
      </div>
    </div>
  );
}
