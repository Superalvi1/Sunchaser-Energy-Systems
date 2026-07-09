/**
 * Roof Studio — draft layout report pages (matches Sunchaser layout report sections).
 */

import type { ScaleCalibration } from "./roofStudioCalibration.ts";
import { formatDualUnits, formatFeetInches, formatMeters, requireValidScale } from "./roofStudioCalibration.ts";
import type { EditableBoqLine } from "./roofStudioBoq.ts";
import { boqGrandTotal, lineTotal } from "./roofStudioBoq.ts";
import type { StudioPanelPlacement, PanelModuleSpec } from "./roofStudioPanels.ts";
import { panelFootprintUnits, panelSystemKw } from "./roofStudioPanels.ts";
import type { StructureLayout } from "./roofStudioStructure.ts";
import { STRUCTURE_TYPE_LABELS, memberLengthM, structureMemberCounts } from "./roofStudioStructure.ts";
import type { StudioPlane } from "./roofStudioClient.ts";
import type { DimensionAnnotation } from "./roofStudioDimensions.ts";
import { dimensionLabel } from "./roofStudioDimensions.ts";
import { polygonBounds } from "../../server/solar/roof/RoofPolygon.ts";
import { measureDistanceM } from "./roofStudioClient.ts";

export interface ReportPage {
  id: string;
  title: string;
  sections: Array<{ heading: string; lines: string[] }>;
}

export function buildLayoutReportPages(opts: {
  planes: StudioPlane[];
  metersPerUnit: number;
  calibration: ScaleCalibration | null;
  dimensions: DimensionAnnotation[];
  panelPlacements: StudioPanelPlacement[];
  panelSpec: PanelModuleSpec;
  structure: StructureLayout;
  boqLines: EditableBoqLine[];
}): ReportPage[] {
  const mpu = requireValidScale(opts.metersPerUnit);
  const primary = opts.planes[0];
  const bounds = primary ? polygonBounds(primary.boundary) : null;
  const widthM = bounds ? (bounds.maxX - bounds.minX) * mpu : 0;
  const depthM = bounds ? (bounds.maxY - bounds.minY) * mpu : 0;
  const panelCount = opts.panelPlacements.length;
  const systemKw = panelSystemKw(opts.panelPlacements, opts.panelSpec.wattage);
  const counts = structureMemberCounts(opts.structure);

  const siteDimensions: ReportPage = {
    id: "site-dimensions",
    title: "Site Dimensions",
    sections: [
      {
        heading: "Scale calibration",
        lines: opts.calibration
          ? [
              `Known distance: ${opts.calibration.inputLabel} (${formatMeters(opts.calibration.realLengthM)})`,
              `Scale: 1 canvas unit = ${mpu.toFixed(4)} m`,
            ]
          : ["Scale not calibrated — dimensions are not valid."],
      },
      {
        heading: "Roof envelope",
        lines: bounds
          ? [
              `Width: ${formatDualUnits(widthM)}`,
              `Depth: ${formatDualUnits(depthM)}`,
              `Perimeter segments: ${primary!.boundary.length}`,
            ]
          : ["No roof plane drawn."],
      },
      {
        heading: "Dimension annotations",
        lines:
          opts.dimensions.length > 0
            ? opts.dimensions.map((d) => dimensionLabel(d, mpu))
            : ["No dimension lines placed."],
      },
    ],
  };

  const panelLayout: ReportPage = {
    id: "panel-layout",
    title: "Panel Layout",
    sections: [
      {
        heading: "Array summary",
        lines: [
          `Modules: ${panelCount}`,
          `System size: ${systemKw} kW DC`,
          `Module: ${opts.panelSpec.wattage}W · ${opts.panelSpec.orientation}`,
          `Module size: ${formatFeetInches(opts.panelSpec.widthM)} × ${formatFeetInches(opts.panelSpec.heightM)}`,
          `Gap: ${formatMeters(opts.panelSpec.gapM)} · Row spacing: ${formatMeters(opts.panelSpec.rowSpacingM)}`,
        ],
      },
      {
        heading: "Placement mode",
        lines: panelCount > 0 ? ["Manual + auto-fill on calibrated scale"] : ["No panels placed."],
      },
    ],
  };

  const airPassage: ReportPage = {
    id: "air-passage",
    title: "Air Passage / Cleaning Space",
    sections: [
      {
        heading: "Elevated clearance",
        lines: [
          `Structure height: ${formatDualUnits(opts.structure.structureHeightM)}`,
          `Air passage below array: ${formatDualUnits(opts.structure.airPassageM)}`,
          `Cleaning / maintenance space: ${formatDualUnits(opts.structure.cleaningSpaceM)}`,
        ],
      },
      {
        heading: "Civil work notes",
        lines: opts.structure.civilLabels.length > 0 ? opts.structure.civilLabels : ["No civil labels."],
      },
    ],
  };

  const hBeam: ReportPage = {
    id: "h-beam-c-channel",
    title: "H-Beam & C-Channel",
    sections: [
      {
        heading: "Member counts",
        lines: [
          `${STRUCTURE_TYPE_LABELS["h-beam"]}: ${counts["h-beam"]}`,
          `${STRUCTURE_TYPE_LABELS["c-channel"]}: ${counts["c-channel"]}`,
          `${STRUCTURE_TYPE_LABELS.column}: ${counts.column}`,
          `${STRUCTURE_TYPE_LABELS.foundation}: ${counts.foundation}`,
        ],
      },
      {
        heading: "Member schedule",
        lines:
          opts.structure.members.length > 0
            ? opts.structure.members.map(
                (m) =>
                  `${m.label}: ${formatDualUnits(memberLengthM(m, mpu))} @ ${formatMeters(m.heightM)} height`
              )
            : ["No structure members drawn."],
      },
    ],
  };

  const structureDims: ReportPage = {
    id: "structure-dimensions",
    title: "Structure Dimensions",
    sections: [
      {
        heading: "BOQ draft total",
        lines: [
          `Line items: ${opts.boqLines.length}`,
          `Indicative total: Rs. ${boqGrandTotal(opts.boqLines).toLocaleString()} (draft only)`,
        ],
      },
      {
        heading: "Priced lines",
        lines:
          opts.boqLines.length > 0
            ? opts.boqLines.map(
                (l) =>
                  `${l.item} — ${l.qty} ${l.unit} @ Rs.${l.rate.toLocaleString()} = Rs.${lineTotal(l).toLocaleString()}${l.overridden ? " (override)" : ""}`
              )
            : ["BOQ not generated — calibrate scale and place panels first."],
      },
    ],
  };

  if (primary && primary.boundary.length >= 2) {
    const segLines: string[] = [];
    for (let i = 0; i < primary.boundary.length; i += 1) {
      const a = primary.boundary[i];
      const b = primary.boundary[(i + 1) % primary.boundary.length];
      const lenM = measureDistanceM(a, b, mpu);
      segLines.push(`Segment ${i + 1}: ${formatDualUnits(lenM)}`);
    }
    siteDimensions.sections.push({ heading: "Roof segments", lines: segLines });
  }

  return [siteDimensions, panelLayout, airPassage, hBeam, structureDims];
}
