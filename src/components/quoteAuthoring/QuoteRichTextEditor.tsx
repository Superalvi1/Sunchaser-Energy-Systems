import React, { useCallback, useEffect, useRef } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Minus,
  Palette,
  Table,
  Underline,
} from "lucide-react";
import { createEmptyTableHtml, sanitizeQuoteHtml } from "../../lib/quoteAuthoring";

type QuoteRichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
};

const TEXT_COLORS = ["#0f172a", "#475569", "#d97706", "#1e3a8a", "#dc2626", "#059669"];

export default function QuoteRichTextEditor({
  value,
  onChange,
  placeholder = "Compose page content…",
  minHeight = 160,
}: QuoteRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastHtml = useRef(value);

  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastHtml.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || "";
      lastHtml.current = value;
    }
  }, [value]);

  const emitChange = useCallback(() => {
    if (!editorRef.current) return;
    const html = sanitizeQuoteHtml(editorRef.current.innerHTML);
    lastHtml.current = html;
    onChange(html);
  }, [onChange]);

  const exec = (command: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, val);
    emitChange();
  };

  const insertHtml = (html: string) => {
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    emitChange();
  };

  const btn =
    "p-1.5 rounded border border-slate-800 bg-slate-950 hover:bg-slate-900 hover:text-amber-400 text-slate-400 transition";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 p-1.5 bg-slate-950 border border-slate-850 rounded-lg">
        <button type="button" className={btn} title="Bold" onClick={() => exec("bold")}>
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Italic" onClick={() => exec("italic")}>
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Underline" onClick={() => exec("underline")}>
          <Underline className="h-3.5 w-3.5" />
        </button>
        <span className="w-px h-6 bg-slate-800 mx-0.5 self-center" />
        <button type="button" className={btn} title="Heading 1" onClick={() => exec("formatBlock", "h1")}>
          <Heading1 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Heading 2" onClick={() => exec("formatBlock", "h2")}>
          <Heading2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Heading 3" onClick={() => exec("formatBlock", "h3")}>
          <Heading3 className="h-3.5 w-3.5" />
        </button>
        <span className="w-px h-6 bg-slate-800 mx-0.5 self-center" />
        <button type="button" className={btn} title="Bullet list" onClick={() => exec("insertUnorderedList")}>
          <List className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Numbered list" onClick={() => exec("insertOrderedList")}>
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <span className="w-px h-6 bg-slate-800 mx-0.5 self-center" />
        <button type="button" className={btn} title="Align left" onClick={() => exec("justifyLeft")}>
          <AlignLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Align center" onClick={() => exec("justifyCenter")}>
          <AlignCenter className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Align right" onClick={() => exec("justifyRight")}>
          <AlignRight className="h-3.5 w-3.5" />
        </button>
        <span className="w-px h-6 bg-slate-800 mx-0.5 self-center" />
        <div className="flex items-center gap-0.5">
          <Palette className="h-3.5 w-3.5 text-slate-500 ml-0.5" />
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={`Color ${color}`}
              className="h-4 w-4 rounded-full border border-slate-700"
              style={{ backgroundColor: color }}
              onClick={() => exec("foreColor", color)}
            />
          ))}
        </div>
        <span className="w-px h-6 bg-slate-800 mx-0.5 self-center" />
        <button
          type="button"
          className={btn}
          title="Insert image"
          onClick={() => {
            const url = window.prompt("Image URL");
            if (url?.trim()) insertHtml(`<img src="${url.trim()}" alt="" style="max-width:100%;height:auto;" />`);
          }}
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn} title="Insert divider" onClick={() => insertHtml("<hr />")}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={btn}
          title="Insert table"
          onClick={() => insertHtml(createEmptyTableHtml(3, 3))}
        >
          <Table className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={emitChange}
        data-placeholder={placeholder}
        className="quote-rich-editor w-full bg-white text-slate-800 border border-slate-850 rounded-lg px-3 py-2 text-xs leading-relaxed outline-none focus:border-amber-500/60 overflow-auto"
        style={{ minHeight }}
      />
      <style>{`
        .quote-rich-editor:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
        }
        .quote-rich-editor h1 { font-size: 1.35rem; font-weight: 800; color: #d97706; margin: 0.75rem 0 0.5rem; }
        .quote-rich-editor h2 { font-size: 1.15rem; font-weight: 800; color: #d97706; margin: 0.65rem 0 0.45rem; }
        .quote-rich-editor h3 { font-size: 1rem; font-weight: 800; color: #1e3a8a; margin: 0.55rem 0 0.4rem; }
        .quote-rich-editor table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
        .quote-rich-editor th, .quote-rich-editor td { border: 1px solid #cbd5e1; padding: 4px 6px; }
        .quote-rich-editor th { background: #f8fafc; font-weight: 700; }
        .quote-rich-editor ul, .quote-rich-editor ol { padding-left: 1.25rem; margin: 0.35rem 0; }
        .quote-rich-editor hr { border: none; border-top: 1px solid #e2e8f0; margin: 0.75rem 0; }
        .quote-rich-editor img { max-width: 100%; height: auto; }
      `}</style>
    </div>
  );
}
