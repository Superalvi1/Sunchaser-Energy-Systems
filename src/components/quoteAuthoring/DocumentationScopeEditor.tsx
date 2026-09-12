import React from "react";
import type { ProjectScopeState, ScopeLine } from "../../lib/quoteProjectScope";
import { ScopeDetails, ScopeLineTable } from "./ScopeLineTable";

export default function DocumentationScopeEditor({
  scope,
  onChangeLine,
}: {
  scope: ProjectScopeState;
  onChangeLine: (id: string, next: ScopeLine) => void;
}) {
  return (
    <div className="space-y-3">
      <ScopeDetails title="Site survey / engineering" defaultOpen={scope.projectClass !== "residential"}>
        <p className="text-[11px] text-slate-500">
          The existing Survey / Design charge (Rs 5,000 default) stays on Other Charges. These lines are extra commercial /
          industrial engineering services with blank rates until quoted.
        </p>
        <ScopeLineTable lines={scope.lines.filter((l) => l.section === "survey")} onChangeLine={onChangeLine} />
      </ScopeDetails>
      <ScopeDetails title="Documentation & handover" defaultOpen>
        <p className="text-[11px] text-slate-500">
          Core documentation defaults included. Included-but-unpriced lines stay in scope metadata and do not inflate the
          quotation total.
        </p>
        <ScopeLineTable lines={scope.lines.filter((l) => l.section === "documentation")} onChangeLine={onChangeLine} />
      </ScopeDetails>
      <ScopeDetails title="Net metering extras">
        <p className="text-[11px] text-slate-500">
          Off-grid defaults these off unless the salesperson explicitly includes them. Basic LESCO process remains the
          existing Rs 90,000 editable charge.
        </p>
        <ScopeLineTable lines={scope.lines.filter((l) => l.section === "net_metering")} onChangeLine={onChangeLine} />
      </ScopeDetails>
    </div>
  );
}
