import { finiteNumber } from "../quoteCommercialMath";
import type { ProjectScopeState, ScopeLine } from "./types";
import type {
  AcCableRunDetail,
  AcPanelDetail,
  CableTrayDetail,
  DcCableRunDetail,
  DcCombinerDetail,
  EarthingConductorDetail,
  LightningDetail,
} from "./electricalTypes";
import type { CivilFoundationDetail } from "./civilTypes";

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join(", ");
}

function spaceJoin(parts: Array<string | null | undefined>): string {
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join(" ");
}

function dcConductorLabel(value: DcCableRunDetail["conductor"]): string {
  if (value === "tinned_copper") return "tinned copper";
  if (value === "copper") return "copper";
  if (value === "other") return "conductor";
  return "";
}

function dcAreaLabel(detail: DcCableRunDetail): string {
  if (detail.areaMm2 === "custom") return String(detail.customArea || "").trim();
  return detail.areaMm2 ? `${detail.areaMm2} mm²` : "";
}

function dcVoltageLabel(detail: DcCableRunDetail): string {
  if (detail.voltageRating === "custom") return String(detail.customVoltage || "").trim();
  if (detail.voltageRating === "1000v") return "1000 V DC";
  if (detail.voltageRating === "1500v") return "1500 V DC";
  return "";
}

function polarityLabel(detail: DcCableRunDetail): string {
  if (detail.polarity === "positive") return "positive run";
  if (detail.polarity === "negative") return "negative run";
  return "";
}

export function describeDcCable(detail: DcCableRunDetail | undefined, line?: ScopeLine): string {
  if (!detail) return String(line?.specification || "").trim();
  const length = finiteNumber(detail.lengthM, 0) || finiteNumber(line?.qty, 0);
  const head = joinParts([
    spaceJoin([dcAreaLabel(detail), dcConductorLabel(detail.conductor), detail.cableType]),
    dcVoltageLabel(detail),
  ]);
  const run = polarityLabel(detail);
  const lengthBit = length > 0 ? `${run ? `${run} ` : ""}${length} m` : run;
  return [head, lengthBit].filter(Boolean).join(" — ");
}

function acCoresLabel(detail: AcCableRunDetail): string {
  if (detail.cores === "custom") return String(detail.customCores || "").trim();
  if (detail.cores === "4c_e") return "4C+E";
  if (detail.cores) return detail.cores.replace("c", "C");
  return "";
}

function acAreaLabel(detail: AcCableRunDetail): string {
  if (detail.areaMm2 === "custom") return String(detail.customArea || "").trim();
  return detail.areaMm2 ? `${detail.areaMm2} mm²` : "";
}

function acConstructionLabel(detail: AcCableRunDetail): string {
  if (detail.construction === "custom") return String(detail.customConstruction || "").trim();
  if (detail.construction === "xlpe_swa_pvc") return "XLPE/SWA/PVC";
  if (detail.construction === "xlpe") return "XLPE";
  if (detail.construction === "pvc") return "PVC";
  if (detail.construction === "flexible") return "Flexible";
  return "";
}

function acVoltageLabel(detail: AcCableRunDetail): string {
  if (detail.voltageRating === "custom") return String(detail.customVoltage || "").trim();
  if (detail.voltageRating === "0.6_1kv") return "0.6/1kV";
  return "";
}

const AC_ROUTE_LABEL: Record<string, string> = {
  ac_inv_db: "inverter to AC DB",
  ac_db_lt: "AC DB to LT",
  ac_lt_grid: "LT to grid",
  ac_backup: "backup output",
};

export function describeAcCable(detail: AcCableRunDetail | undefined, line?: ScopeLine): string {
  if (!detail) return String(line?.specification || "").trim();
  const conductor = detail.conductor === "copper" ? "Cu" : detail.conductor === "aluminium" ? "Al" : "";
  const head = joinParts([
    spaceJoin([acCoresLabel(detail), acAreaLabel(detail), conductor, acConstructionLabel(detail)]),
    acVoltageLabel(detail),
  ]);
  const length = finiteNumber(detail.lengthM, 0) || finiteNumber(line?.qty, 0);
  const route = AC_ROUTE_LABEL[line?.id || ""] || String(line?.name || "").replace(/\s+Cable$/i, "");
  const lengthBit = length > 0 ? `${route ? `${route}, ` : ""}${length} m` : route;
  return [head, lengthBit].filter(Boolean).join(" — ");
}

export function describeDcCombiner(detail: DcCombinerDetail | undefined): string {
  if (!detail) return "";
  return joinParts([
    detail.numberOfStrings > 0 ? `${detail.numberOfStrings} strings` : "",
    detail.dcBreakerType,
    detail.spdType === "type_ii" ? "SPD Type II" : detail.spdType === "type_i_ii" ? "SPD Type I+II" : "",
    detail.enclosureIp && detail.enclosureIp !== "custom" ? detail.enclosureIp.toUpperCase() : detail.customEnclosureIp,
  ]);
}

export function describeAcPanel(detail: AcPanelDetail | undefined, line?: ScopeLine): string {
  if (!detail) return String(line?.specification || "").trim();
  return joinParts([
    detail.panelType,
    detail.incomingBreakerType
      ? `incoming ${detail.incomingBreakerType}${detail.incomingCurrentA ? ` ${detail.incomingCurrentA}A` : ""}`
      : "",
    detail.acSpd === "type_ii" ? "SPD Type II" : detail.acSpd === "type_i_ii" ? "SPD Type I+II" : "",
    detail.busbarMaterial === "copper" ? "Cu busbar" : detail.busbarMaterial === "aluminium" ? "Al busbar" : "",
    detail.enclosureIp && detail.enclosureIp !== "custom" ? detail.enclosureIp.toUpperCase() : detail.customEnclosureIp,
  ]);
}

export function describeLightning(detail: LightningDetail | undefined): string {
  if (!detail) return "";
  return joinParts([
    detail.airTerminalType ? `Air terminal ${detail.airTerminalType}` : "",
    detail.airTerminalQty > 0 ? `qty ${detail.airTerminalQty}` : "",
    detail.downConductorType ? `down conductor ${detail.downConductorType}` : "",
    detail.downConductorArea,
    detail.downConductorLength > 0 ? `${detail.downConductorLength} m` : "",
    detail.testJointQty > 0 ? `${detail.testJointQty} test joint(s)` : "",
    detail.earthPitQty > 0 ? `${detail.earthPitQty} earth pit(s)` : "",
  ]);
}

export function describeCableTray(detail: CableTrayDetail | undefined): string {
  if (!detail) return "";
  return joinParts([
    detail.trayType,
    detail.widthMm ? `${detail.widthMm} mm wide` : "",
    detail.heightMm ? `${detail.heightMm} mm high` : "",
    detail.thicknessMm,
    detail.lengthM > 0 ? `${detail.lengthM} m` : "",
    detail.coverRequired === "yes" ? "cover required" : "",
  ]);
}

export function describeEarthConductor(detail: EarthingConductorDetail | undefined, line?: ScopeLine): string {
  if (!detail) return String(line?.specification || "").trim();
  const type =
    detail.conductorType === "bare_copper"
      ? "Bare Copper"
      : detail.conductorType === "insulated_copper"
        ? "Insulated Copper"
        : detail.conductorType === "gi_strip"
          ? "GI Strip"
          : detail.conductorType === "copper_strip"
            ? "Copper Strip"
            : detail.customType;
  const size = [detail.areaMm2, detail.stripSize].filter(Boolean).join(" ");
  const length = finiteNumber(detail.lengthM, 0) || finiteNumber(line?.qty, 0);
  return joinParts([type, size, length > 0 ? `${length} m` : ""]);
}

export function describeCivilFoundation(detail: CivilFoundationDetail | undefined): string {
  if (!detail) return "";
  if (detail.designStatus !== "provided") return "Pending structural design / site survey";
  return joinParts([
    detail.foundationPadQty > 0 ? `${detail.foundationPadQty} pads` : "",
    detail.padLength && detail.padWidth && detail.padDepth ? `${detail.padLength}×${detail.padWidth}×${detail.padDepth}` : "",
    detail.pccGrade,
    detail.rccGrade,
    detail.rebarGrade,
    String(detail.designNote || "").trim(),
  ]);
}

export function scopeLineBoqDescription(line: ScopeLine, scope: ProjectScopeState): string {
  let structured = "";
  if (line.section === "dc_cabling") structured = describeDcCable(scope.dcCables?.[line.id], line);
  else if (line.section === "ac_cabling") structured = describeAcCable(scope.acCables?.[line.id], line);
  else if (line.id === "dc_combiner") structured = describeDcCombiner(scope.dcCombiner);
  else if (line.section === "ac_protection") structured = describeAcPanel(scope.acPanels?.[line.id], line);
  else if (line.section === "lightning") structured = describeLightning(scope.lightningDetail);
  else if (line.id === "cm_tray") structured = describeCableTray(scope.cableTray);
  else if (line.section === "earthing") structured = describeEarthConductor(scope.earthConductors?.[line.id], line);
  else if (line.section === "civil") structured = describeCivilFoundation(scope.civilFoundation);

  const spec = String(line.specification || "").trim();
  const notes = String(line.notes || "").trim();
  return [structured || spec, notes].filter(Boolean).join(" — ");
}

export function dcCableHasStructuredFields(detail: DcCableRunDetail | undefined): boolean {
  if (!detail) return false;
  return Boolean(
    detail.brand ||
      detail.cableType ||
      detail.conductor ||
      detail.areaMm2 ||
      detail.voltageRating ||
      detail.lengthM > 0 ||
      detail.catalogProductId
  );
}