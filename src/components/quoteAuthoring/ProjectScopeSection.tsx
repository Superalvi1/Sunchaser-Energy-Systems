import React from "react";
import type { Product } from "../../types";
import type {
  ProjectClass,
  ProjectScopeState,
  ScopeContext,
  ScopeLine,
  ScopeMode,
} from "../../lib/quoteProjectScope";
import { applyScopeDependencies, buildPresetScope, buildScopeForClass, presetIdForClass } from "../../lib/quoteProjectScope";
import CivilScopeEditor from "./CivilScopeEditor";
import DocumentationScopeEditor from "./DocumentationScopeEditor";
import ElectricalScopeEditor from "./ElectricalScopeEditor";
import ScopeMatrix from "./ScopeMatrix";
import StructureScopeEditor from "./StructureScopeEditor";
import { scopeChipClass } from "./quoteScopeUi";
import { buildScopeMatrix } from "../../lib/quoteProjectScope";

const CLASSES: { id: ProjectClass; label: string }[] = [
  { id: "residential", label: "Residential" },
  { id: "commercial", label: "Commercial" },
  { id: "industrial", label: "Industrial" },
  { id: "custom", label: "Custom" },
];

export default function ProjectScopeSection({
  scope,
  ctx,
  products,
  onChange,
  matrix,
}: {
  scope: ProjectScopeState;
  ctx: ScopeContext;
  products: Product[];
  onChange: (next: ProjectScopeState) => void;
  matrix: ReturnType<typeof buildScopeMatrix>;
}) {
  const patch = (partial: Partial<ProjectScopeState>) => {
    onChange(applyScopeDependencies({ ...scope, ...partial }, ctx));
  };

  const changeLine = (id: string, next: ScopeLine) => {
    patch({ lines: scope.lines.map((line) => (line.id === id ? next : line)) });
  };

  const selectClass = (projectClass: ProjectClass) => {
    const next = buildScopeForClass(projectClass);
    onChange(applyScopeDependencies(next, ctx));
  };

  const selectMode = (scopeMode: ScopeMode) => {
    if (scopeMode === "standard" && scope.projectClass === "residential") {
      onChange(applyScopeDependencies(buildPresetScope("residential_standard"), ctx));
      return;
    }
    if (scopeMode === "advanced" && scope.projectClass === "residential") {
      onChange(applyScopeDependencies({ ...scope, scopeMode: "advanced", preset: "custom" }, ctx));
      return;
    }
    patch({ scopeMode });
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Project scope</h3>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Project class</p>
        <div className="flex flex-wrap gap-2">
          {CLASSES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectClass(item.id)}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${scopeChipClass(scope.projectClass === item.id)}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Scope mode</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => selectMode("standard")}
            className={`rounded-xl px-3 py-2 text-xs font-bold ${scopeChipClass(scope.scopeMode === "standard")}`}
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => selectMode("advanced")}
            className={`rounded-xl px-3 py-2 text-xs font-bold ${scopeChipClass(scope.scopeMode === "advanced", "sky")}`}
          >
            Advanced Project Scope
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {scope.scopeMode === "standard"
            ? "Residential standard stays on the existing commercial charges. Open Advanced only when the job needs a complete BOQ."
            : `Preset: ${presetIdForClass(scope.projectClass).replace(/_/g, " ")}. Collapsible sections below — pending items are not priced.`}
        </p>
      </div>

      {scope.scopeMode === "advanced" && (
        <div className="space-y-3">
          <StructureScopeEditor scope={scope} ctx={ctx} onChange={patch} onChangeLine={changeLine} />
          <ElectricalScopeEditor scope={scope} ctx={ctx} products={products} onChange={patch} onChangeLine={changeLine} />
          <CivilScopeEditor scope={scope} ctx={ctx} onChange={patch} onChangeLine={changeLine} />
          <DocumentationScopeEditor scope={scope} onChangeLine={changeLine} />
          <ScopeMatrix matrix={matrix} />
        </div>
      )}
    </section>
  );
}
