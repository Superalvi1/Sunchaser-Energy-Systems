import type { BoqRow } from "../../types";
import { finiteNumber } from "../quoteCommercialMath";
import { finishAmount, isPricedIncludedLine, lineAmount } from "./costing";
import { scopeLineBoqDescription } from "./descriptions";
import type { ProjectScopeState, ScopeLine } from "./types";
import { PENDING_SITE_SURVEY } from "./types";

export const SCOPE_BOQ_ID_PREFIX = "scope_";

function itemFromLine(line: ScopeLine, scope: ProjectScopeState): BoqRow {
  const qty = finiteNumber(line.qty, 0);
  const rate = finiteNumber(line.rate, 0);
  return {
    id: `${SCOPE_BOQ_ID_PREFIX}${line.id}`,
    type: "item",
    name: line.name,
    description: scopeLineBoqDescription(line, scope),
    brand: "",
    unit: line.unit || "Job",
    qty,
    rate,
    total: qty * rate,
    catalogProductId: line.catalogProductId || "",
    quoteLineKind: `project_scope:${line.section}`,
  };
}

export function projectScopeToBoqRows(scope: ProjectScopeState | null | undefined): BoqRow[] {
  if (!scope || scope.scopeMode !== "advanced") return [];
  const rows: BoqRow[] = [];
  for (const line of scope.lines) {
    if (line.inclusionState === "excluded") continue;
    if (line.inclusionState === "pending") continue;
    if (line.inclusionState === "included" && !isPricedIncludedLine(line) && lineAmount(line) === 0) {
      continue;
    }
    if (line.inclusionState === "included") rows.push(itemFromLine(line, scope));
  }
  const paint = finishAmount(scope.finish);
  if (paint > 0 && scope.finish.finish && scope.finish.finish !== "none") {
    const qty = finiteNumber(scope.finish.surfaceArea, 0) > 0 ? finiteNumber(scope.finish.surfaceArea, 0) : 1;
    const rate = qty > 0 && finiteNumber(scope.finish.amount, 0) > 0 ? paint / qty : finiteNumber(scope.finish.rate, 0) || paint;
    rows.push({
      id: `${SCOPE_BOQ_ID_PREFIX}structure_finish`,
      type: "item",
      name: `Structure finish — ${scope.finish.finish.replace(/_/g, " ")}`,
      description: [scope.finish.coatSystem, scope.finish.coats ? `${scope.finish.coats} coat(s)` : ""]
        .filter(Boolean)
        .join(" · "),
      brand: "",
      unit: finiteNumber(scope.finish.surfaceArea, 0) > 0 ? "Sft" : "Job",
      qty,
      rate: finiteNumber(scope.finish.surfaceArea, 0) > 0 ? rate : paint,
      total: paint,
      quoteLineKind: "project_scope:finish",
    });
  }
  return rows;
}

/** Pending items stay in metadata. Helper for tests that want an explicit pending row. */
export function pendingScopeNoteRows(scope: ProjectScopeState | null | undefined): BoqRow[] {
  if (!scope) return [];
  return scope.lines
    .filter((line) => line.inclusionState === "pending")
    .map((line) => ({
      id: `${SCOPE_BOQ_ID_PREFIX}pending_${line.id}`,
      type: "item" as const,
      name: `${line.name} — ${PENDING_SITE_SURVEY}`,
      description: PENDING_SITE_SURVEY,
      brand: "",
      unit: line.unit,
      qty: 0,
      rate: 0,
      total: 0,
      quoteLineKind: `project_scope_pending:${line.section}`,
    }));
}
