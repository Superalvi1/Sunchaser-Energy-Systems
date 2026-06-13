import React, { useMemo } from "react";
import { Settings2 } from "lucide-react";
import {
  TEMPLATE_NAV_BOQ,
  TEMPLATE_NAV_GLOBAL,
  buildTemplateSidebarItems,
  type TemplateSidebarItem,
} from "../../lib/quoteTemplateNav";

type Props = {
  pages: any[];
  selectedTemplatePageId: string;
  onSelect: (id: string) => void;
};

export default function TemplatePageSidebar({ pages, selectedTemplatePageId, onSelect }: Props) {
  const items = useMemo(() => buildTemplateSidebarItems(pages), [pages]);

  const renderItem = (item: TemplateSidebarItem) => {
    const active = selectedTemplatePageId === item.id;
    const base =
      "w-full text-left px-3 py-2 rounded-lg text-xs transition border border-transparent";
    const activeCls = "bg-amber-500/15 text-amber-300 border-amber-500/30";
    const idleCls = "text-slate-400 hover:bg-slate-900 hover:text-slate-200";

    if (item.id === TEMPLATE_NAV_GLOBAL) {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={`${base} font-semibold flex items-center gap-2 ${active ? activeCls : idleCls}`}
        >
          <Settings2 className="h-3.5 w-3.5 shrink-0" />
          {item.label}
        </button>
      );
    }

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelect(item.id)}
        className={`${base} ${item.indent ? "pl-5" : ""} ${active ? activeCls : idleCls}`}
      >
        <span className={`block truncate ${item.indent ? "font-medium" : "font-semibold"}`}>{item.label}</span>
        {item.hint && <span className="text-[9px] text-slate-600 font-mono block truncate">{item.hint}</span>}
      </button>
    );
  };

  let lastSection: string | undefined;

  return (
    <aside className="w-[220px] shrink-0 border-r border-slate-800 bg-slate-950 overflow-y-auto">
      <nav className="p-2 space-y-1">
        {items.map((item) => {
          const showSection = item.section && item.section !== lastSection;
          if (item.section) lastSection = item.section;
          return (
            <React.Fragment key={item.id}>
              {showSection && (
                <p className="text-[9px] uppercase font-mono text-slate-600 font-bold px-2 pt-2 pb-0.5">
                  {item.section}
                </p>
              )}
              {renderItem(item)}
            </React.Fragment>
          );
        })}
      </nav>
    </aside>
  );
}
