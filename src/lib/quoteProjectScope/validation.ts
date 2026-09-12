import { finiteNumber, nonNegativeFinite } from "../quoteCommercialMath";
import { isMsStructure, isValidFinishForMaterial } from "./dependencies";
import { LIGHTNING_PATH_IDS } from "./lines";
import { acScheduleComplete, dcScheduleComplete, earthScheduleComplete } from "./replacement";
import type { ProjectScopeState, ScopeContext } from "./types";
import { PENDING_STRUCTURAL_DESIGN } from "./types";

function included(scope: ProjectScopeState, id: string): boolean {
  return scope.lines.some((l) => l.id === id && l.inclusionState === "included");
}

export function validateProjectScope(scope: ProjectScopeState | null | undefined, ctx: ScopeContext): string[] {
  if (!scope) return [];
  const errors: string[] = [];

  for (const line of scope.lines) {
    if (line.inclusionState !== "included") continue;
    if (nonNegativeFinite(line.qty) == null) errors.push(`${line.name}: quantity cannot be negative.`);
    if (nonNegativeFinite(line.rate) == null) errors.push(`${line.name}: rate cannot be negative.`);
  }

  if (isMsStructure(scope, ctx) && !isValidFinishForMaterial("ms", scope.finish.finish)) {
    errors.push("MS fabricated structure requires an explicit coating / finish selection. None / existing galvanized is not valid for MS.");
  }

  if (scope.lightningEnabled) {
    for (const id of LIGHTNING_PATH_IDS) {
      const line = scope.lines.find((l) => l.id === id);
      if (!line || line.inclusionState === "excluded") {
        errors.push("Lightning protection requires air terminal, down conductor, test joint and earth path.");
        break;
      }
    }
    const lp = scope.lightningDetail;
    if (!String(lp?.airTerminalType || "").trim()) errors.push("Lightning air terminal type is required.");
    if (!(finiteNumber(lp?.airTerminalQty, 0) > 0)) errors.push("Lightning air terminal quantity is required.");
    if (!String(lp?.downConductorType || "").trim()) errors.push("Lightning down conductor type is required.");
    if (!String(lp?.downConductorArea || "").trim()) errors.push("Lightning down conductor area is required.");
    if (!(finiteNumber(lp?.downConductorLength, 0) > 0)) errors.push("Lightning down conductor length is required.");
    if (!(finiteNumber(lp?.testJointQty, 0) > 0)) errors.push("Lightning test joint quantity is required.");
    if (!(finiteNumber(lp?.earthPitQty, 0) > 0)) errors.push("Lightning earth path / earth pit quantity is required.");
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

  if (scope.replaceGenericDc) {
    const dc = dcScheduleComplete(scope);
    if (!dc.complete) {
      errors.push(`Replace standard DC cable is on, but the detailed schedule is incomplete: ${dc.missing.join("; ")}.`);
    }
  }
  if (scope.replaceGenericAc) {
    const ac = acScheduleComplete(scope);
    if (!ac.complete) {
      errors.push(`Replace standard AC cable is on, but the detailed schedule is incomplete: ${ac.missing.join("; ")}.`);
    }
  }
  if (scope.replaceGenericEarth) {
    const earth = earthScheduleComplete(scope);
    if (!earth.complete) {
      errors.push(`Replace standard earthing is on, but the detailed schedule is incomplete: ${earth.missing.join("; ")}.`);
    }
  }

  const civil = scope.civilFoundation;
  if (scope.rccFoundationRequired && civil?.designStatus === "provided") {
    if (included(scope, "cv_pads")) {
      if (!(finiteNumber(civil.foundationPadQty, 0) > 0)) errors.push("Foundation pad quantity is required.");
      if (!String(civil.padLength || "").trim() || !String(civil.padWidth || "").trim() || !String(civil.padDepth || "").trim()) {
        errors.push("Foundation pad dimensions are required when design is provided.");
      }
    }
    if (included(scope, "cv_excavation") && !(finiteNumber(civil.excavationQty, 0) > 0)) {
      errors.push("Excavation quantity is required when foundation design is provided.");
    }
    if (included(scope, "cv_pcc") && !(finiteNumber(civil.pccQty, 0) > 0)) {
      errors.push("PCC quantity is required when foundation design is provided.");
    }
    if (included(scope, "cv_rcc") && !(finiteNumber(civil.rccQty, 0) > 0)) {
      errors.push("RCC quantity is required when foundation design is provided.");
    }
    if (included(scope, "cv_rebar") && !(finiteNumber(civil.rebarKg, 0) > 0)) {
      errors.push("Rebar quantity is required when foundation design is provided.");
    }
    if (included(scope, "cv_formwork") && !(finiteNumber(civil.formworkArea, 0) > 0)) {
      errors.push("Formwork area is required when foundation design is provided.");
    }
    if (included(scope, "cv_anchors") && !(finiteNumber(civil.anchorBoltQty, 0) > 0)) {
      errors.push("Anchor bolt quantity is required when foundation design is provided.");
    }
  }

  return errors;
}
