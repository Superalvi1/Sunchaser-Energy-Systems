import React from "react";
import type { ProjectScopeState, ScopeContext, ScopeLine } from "../../lib/quoteProjectScope";
import { girderDesignLoadDisplay, PENDING_STRUCTURAL_DESIGN } from "../../lib/quoteProjectScope";
import { NumberField, ScopeDetails, ScopeLineTable, TextField } from "./ScopeLineTable";
import { ScopeFieldLabel } from "./quoteScopeUi";

export default function StructureScopeEditor({
  scope,
  ctx,
  onChange,
  onChangeLine,
}: {
  scope: ProjectScopeState;
  ctx: ScopeContext;
  onChange: (patch: Partial<ProjectScopeState>) => void;
  onChangeLine: (id: string, next: ScopeLine) => void;
}) {
  const hardware =
    scope.projectClass === "residential"
      ? scope.lines.filter((l) => l.section === "hardware" && l.groupedResidential)
      : scope.lines.filter((l) => l.section === "hardware" && !l.groupedResidential);
  const g = scope.girder;
  const e = scope.elevated;
  const f = scope.finish;

  return (
    <div className="space-y-3">
      {ctx.structureType === "girder" && (
        <ScopeDetails title="Mughal girder / girder details" defaultOpen>
          <p className="text-[11px] text-slate-500">
            Do not invent engineering load capacity. If it has not been calculated, keep{" "}
            <span className="text-amber-300">{PENDING_STRUCTURAL_DESIGN}</span>.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <ScopeFieldLabel>Girder type</ScopeFieldLabel>
              <select
                value={g.girderType}
                onChange={(ev) => onChange({ girder: { ...g, girderType: ev.target.value as typeof g.girderType } })}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="mughal">Mughal Girder</option>
                <option value="custom_fabricated">Custom Fabricated</option>
              </select>
            </div>
            <div>
              <ScopeFieldLabel>Main section</ScopeFieldLabel>
              <select
                value={g.mainSection}
                onChange={(ev) => onChange({ girder: { ...g, mainSection: ev.target.value as typeof g.mainSection } })}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">Select</option>
                <option value="4x2">4×2 inch</option>
                <option value="6x3">6×3 inch</option>
                <option value="8x4">8×4 inch</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {g.mainSection === "custom" && (
              <TextField
                label="Custom section"
                value={g.mainSectionCustom}
                onChange={(v) => onChange({ girder: { ...g, mainSectionCustom: v } })}
              />
            )}
            <TextField label="Wall thickness / gauge" value={g.wallThickness} onChange={(v) => onChange({ girder: { ...g, wallThickness: v } })} />
            <div>
              <ScopeFieldLabel>Material</ScopeFieldLabel>
              <select
                value={g.material}
                onChange={(ev) => onChange({ girder: { ...g, material: ev.target.value as typeof g.material } })}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">Select</option>
                <option value="ms">MS</option>
                <option value="gi">GI</option>
                <option value="other">Other</option>
              </select>
            </div>
            <TextField
              label="Steel grade"
              value={g.steelGrade}
              onChange={(v) => onChange({ girder: { ...g, steelGrade: v } })}
              placeholder="ASTM A36 / equivalent"
            />
            <TextField label="Span" value={g.span} onChange={(v) => onChange({ girder: { ...g, span: v } })} />
            <NumberField label="Number of columns" value={g.columnCount} onChange={(v) => onChange({ girder: { ...g, columnCount: v } })} />
            <TextField label="Column section" value={g.columnSection} onChange={(v) => onChange({ girder: { ...g, columnSection: v } })} />
            <div>
              <ScopeFieldLabel>Design load</ScopeFieldLabel>
              <select
                value={g.designLoadStatus}
                onChange={(ev) =>
                  onChange({
                    girder: { ...g, designLoadStatus: ev.target.value as typeof g.designLoadStatus },
                  })
                }
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="pending_structural_design">{PENDING_STRUCTURAL_DESIGN}</option>
                <option value="provided">Provided by engineer</option>
              </select>
              <p className="mt-1 text-[11px] text-amber-200">{girderDesignLoadDisplay(g)}</p>
            </div>
            {g.designLoadStatus === "provided" && (
              <TextField
                label="Calculated load note"
                value={g.designLoadNote}
                onChange={(v) => onChange({ girder: { ...g, designLoadNote: v } })}
                placeholder="Engineer-supplied value only"
              />
            )}
            <div>
              <ScopeFieldLabel>Wind-load design</ScopeFieldLabel>
              <select
                value={g.windLoadDesign}
                onChange={(ev) => onChange({ girder: { ...g, windLoadDesign: ev.target.value as typeof g.windLoadDesign } })}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="pending">Pending structural assessment</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <TextField label="Base plate L" value={g.basePlateLength} onChange={(v) => onChange({ girder: { ...g, basePlateLength: v } })} />
            <TextField label="Base plate W" value={g.basePlateWidth} onChange={(v) => onChange({ girder: { ...g, basePlateWidth: v } })} />
            <TextField label="Base plate thickness" value={g.basePlateThickness} onChange={(v) => onChange({ girder: { ...g, basePlateThickness: v } })} />
            <TextField label="Anchor bolt diameter" value={g.anchorBoltDiameter} onChange={(v) => onChange({ girder: { ...g, anchorBoltDiameter: v } })} />
            <TextField label="Anchor bolt grade" value={g.anchorBoltGrade} onChange={(v) => onChange({ girder: { ...g, anchorBoltGrade: v } })} />
            <NumberField label="Anchor bolt qty" value={g.anchorBoltQty} onChange={(v) => onChange({ girder: { ...g, anchorBoltQty: v } })} />
            <NumberField label="Girder length (ft)" value={g.girderLengthFt} onChange={(v) => onChange({ girder: { ...g, girderLengthFt: v } })} />
            <TextField label="Weight if available" value={g.weight} onChange={(v) => onChange({ girder: { ...g, weight: v } })} />
          </div>
        </ScopeDetails>
      )}

      {ctx.structureType === "elevated" && (
        <ScopeDetails title="Elevated structure details" defaultOpen>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TextField label="Height" value={e.height} onChange={(v) => onChange({ elevated: { ...e, height: v } })} />
            <TextField label="Column spacing" value={e.columnSpacing} onChange={(v) => onChange({ elevated: { ...e, columnSpacing: v } })} />
            <TextField label="Main girder" value={e.mainGirder} onChange={(v) => onChange({ elevated: { ...e, mainGirder: v } })} />
            <TextField label="Secondary member" value={e.secondaryMember} onChange={(v) => onChange({ elevated: { ...e, secondaryMember: v } })} />
            <TextField label="Steel section" value={e.steelSection} onChange={(v) => onChange({ elevated: { ...e, steelSection: v } })} />
            <TextField label="Material grade" value={e.materialGrade} onChange={(v) => onChange({ elevated: { ...e, materialGrade: v } })} />
            <TextField label="Base plate" value={e.basePlate} onChange={(v) => onChange({ elevated: { ...e, basePlate: v } })} />
            <TextField label="Anchor bolt" value={e.anchorBolt} onChange={(v) => onChange({ elevated: { ...e, anchorBolt: v } })} />
            <div>
              <ScopeFieldLabel>Finish</ScopeFieldLabel>
              <select
                value={e.finish}
                onChange={(ev) => onChange({ elevated: { ...e, finish: ev.target.value as typeof e.finish } })}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">Select</option>
                <option value="hot_dip">Hot-dip galvanized</option>
                <option value="primer_paint">Primer + paint</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <ScopeFieldLabel>Civil foundation required</ScopeFieldLabel>
              <select
                value={e.civilFoundation}
                onChange={(ev) =>
                  onChange({
                    elevated: { ...e, civilFoundation: ev.target.value as typeof e.civilFoundation },
                    rccFoundationRequired: ev.target.value === "yes" ? true : scope.rccFoundationRequired,
                  })
                }
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="auto">Auto</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
        </ScopeDetails>
      )}

      <ScopeDetails title="Structure finish / corrosion protection">
        <p className="text-[11px] text-slate-500">
          Hot-dip galvanized is not auto-charged as paint. MS fabricated girder/elevated must select a finish explicitly.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <ScopeFieldLabel>Finish</ScopeFieldLabel>
            <select
              value={f.finish}
              onChange={(ev) => onChange({ finish: { ...f, finish: ev.target.value as typeof f.finish } })}
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value="">Select</option>
              <option value="hot_dip">Hot-Dip Galvanized</option>
              <option value="zinc_primer">Zinc Rich Primer</option>
              <option value="anti_rust">Anti-Rust Primer + Paint</option>
              <option value="epoxy">Epoxy Coating</option>
              <option value="powder">Powder Coating</option>
              <option value="client">Client Specified</option>
              <option value="none">None / Existing Galvanized</option>
            </select>
          </div>
          <NumberField label="Surface area if known" value={f.surfaceArea} onChange={(v) => onChange({ finish: { ...f, surfaceArea: v } })} />
          <TextField label="Coat system" value={f.coatSystem} onChange={(v) => onChange({ finish: { ...f, coatSystem: v } })} />
          <NumberField label="Number of coats" value={f.coats} onChange={(v) => onChange({ finish: { ...f, coats: v } })} />
          <NumberField label="Rate" value={f.rate} onChange={(v) => onChange({ finish: { ...f, rate: v } })} />
          <NumberField label="Amount" value={f.amount} onChange={(v) => onChange({ finish: { ...f, amount: v } })} />
        </div>
      </ScopeDetails>

      <ScopeDetails title="Structural hardware" defaultOpen={scope.projectClass !== "residential"}>
        <ScopeLineTable lines={hardware} onChangeLine={onChangeLine} compact={scope.projectClass === "residential"} />
      </ScopeDetails>
    </div>
  );
}
