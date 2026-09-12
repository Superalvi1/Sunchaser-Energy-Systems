import React from "react";
import type { ProjectScopeState, ScopeContext, ScopeLine } from "../../lib/quoteProjectScope";
import { ScopeDetails, ScopeLineTable, ToggleRow } from "./ScopeLineTable";

export default function CivilScopeEditor({
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
  const civil = scope.lines.filter((l) => l.section === "civil");
  const logistics = scope.lines.filter((l) => l.section === "logistics");
  const install = scope.lines.filter((l) => l.section === "installation");
  const showInstallExtras = scope.projectClass === "industrial" || scope.projectClass === "commercial";

  return (
    <div className="space-y-3">
      <ScopeDetails
        title="Civil works"
        defaultOpen={scope.rccFoundationRequired || ctx.structureType === "girder" || ctx.structureType === "elevated"}
      >
        <ToggleRow
          label="RCC foundation required"
          checked={scope.rccFoundationRequired}
          onChange={(next) => onChange({ rccFoundationRequired: next })}
          hint="Girder / elevated with foundation required exposes excavation, PCC, RCC, rebar, formwork, pads, anchors and curing."
        />
        <ScopeLineTable lines={civil} onChangeLine={onChangeLine} />
      </ScopeDetails>

      <ScopeDetails title="Transport / logistics" defaultOpen={scope.craneEnabled || scope.projectClass === "industrial"}>
        <ToggleRow
          label="Crane / lifting required"
          checked={scope.craneEnabled}
          onChange={(next) => onChange({ craneEnabled: next })}
          hint="Enabling includes the crane cost line. Leave rate blank until a vendor quote exists."
        />
        <ScopeLineTable lines={logistics} onChangeLine={onChangeLine} />
      </ScopeDetails>

      {showInstallExtras && (
        <ScopeDetails title="Installation extras">
          <p className="text-[11px] text-slate-500">
            Standard installation remains 4 PKR/W. These lines are additional execution components, not a replacement.
          </p>
          <ScopeLineTable lines={install} onChangeLine={onChangeLine} />
        </ScopeDetails>
      )}
    </div>
  );
}
