import { nonNegativeFinite } from "../quoteCommercialMath";
import { isMsStructure } from "./dependencies";
import { LIGHTNING_PATH_IDS } from "./lines";
import type { ProjectScopeState, ScopeContext } from "./types";
import { PENDING_STRUCTURAL_DESIGN } from "./types";

export function validateProjectScope(scope: ProjectScopeState | null | undefined, ctx: ScopeContext): string[] {
  if (!scope) return [];
  const errors: string[] = [];

  for (const line of scope.lines) {
    if (line.inclusionState !== "included") continue;
    if (nonNegativeFinite(line.qty) == null) errors.push(`${line.name}: quantity cannot be negative.`);
    if (nonNegativeFinite(line.rate) == null) errors.push(`${line.name}: rate cannot be negative.`);
  }

  if (isMsStructure(scope, ctx) && !scope.finish.finish) {
    errors.push("MS fabricated structure requires an explicit coating / finish selection.");
  }

  if (scope.lightningEnabled) {
    for (const id of LIGHTNING_PATH_IDS) {
      const line = scope.lines.find((l) => l.id === id);
      if (!line || line.inclusionState === "excluded") {
        errors.push("Lightning protection requires air terminal, down conductor, test joint and earth path.");
        break;
      }
    }
  }

  if (scope.scopeMode === "advanced" && ctx.structureType === "girder") {
    const g = scope.girder;
    if (!g.mainSection) errors.push("Girder main section is required.");
    if (g.mainSection === "custom" && !String(g.mainSectionCustom || "").trim()) {
      errors.push("Custom girder section dimensions are required.");
    }
    if (!g.material) errors.push("Girder material is required.");
    if (!String(g.steelGrade || "").trim()) errors.push("Girder steel grade is required.");
    if (!String(g.span || "").trim()) errors.push("Girder span is required.");
    if (!(g.columnCount > 0)) errors.push("Girder column count is required.");
    if (!String(g.basePlateLength || "").trim() || !String(g.basePlateWidth || "").trim() || !String(g.basePlateThickness || "").trim()) {
      errors.push("Girder base plate length, width and thickness are required.");
    }
    if (!String(g.anchorBoltDiameter || "").trim() || !(g.anchorBoltQty > 0)) {
      errors.push("Girder anchor bolt diameter and quantity are required.");
    }
  }

  if (ctx.structureType === "girder" && scope.girder.designLoadStatus === "provided") {
    if (!String(scope.girder.designLoadNote || "").trim()) {
      errors.push(
        `Girder design load is marked provided but no value was entered. Use a calculated value or keep “${PENDING_STRUCTURAL_DESIGN}”.`
      );
    }
  }

  if (scope.finish.finish && scope.finish.finish !== "none") {
    if (nonNegativeFinite(scope.finish.rate) == null) errors.push("Structure finish rate cannot be negative.");
    if (nonNegativeFinite(scope.finish.amount) == null) errors.push("Structure finish amount cannot be negative.");
  }

  return errors;
}
