/**
 * Client adapter — shared studio types and page builders.
 * View model assembly uses server/solar/pipeline via solarPipelineClient.ts.
 * Draft-only. No routes, save, PDF, AI, or CRM mutation.
 */

import type { SolarPipelineStage } from "../../server/solar/pipeline/SolarPipelineModels.ts";
import type {
  SimulationAssumption,
  StringSizingResult,
  MonthlyProductionRow,
  LossBreakdown,
} from "../../server/solar/simulation/SolarSimulationModels.ts";
import { type DesignObstacle, type DesignPoint } from "./solarDesignStudio.ts";
import {
  DESIGN_INCOMPLETE_BOQ_LABEL,
  DESIGN_INCOMPLETE_MESSAGE,
  PROPOSAL_CLIENT_PREVIEW_LABEL,
  type ProposalPreviewPage,
} from "./solarDesignStudio.ts";
import type {
  BoqSection,
  EquipmentTier,
  ProposalDraft,
  ProposalInputSummary,
  ProposalTemplateDraft,
  StructureType,
  SupportedSystemSizeKw,
  SystemType,
} from "../../server/solar/proposal/SolarProposalModels.ts";
import { SUPPORTED_SYSTEM_SIZES_KW } from "../../server/solar/proposal/SolarProposalModels.ts";

export type { BoqSection, EquipmentTier, ProposalDraft, ProposalInputSummary, ProposalTemplateDraft, StructureType, SupportedSystemSizeKw, SystemType };
export { SUPPORTED_SYSTEM_SIZES_KW };

export type StudioTargetSystemKw = SupportedSystemSizeKw | "auto";

export interface StudioCanvasInput {
  roofBoundary: DesignPoint[];
  obstacles: DesignObstacle[];
  structureType: StructureType;
  systemType: SystemType;
  packageTier: EquipmentTier;
  targetSystemKw: StudioTargetSystemKw;
  roofWidthMeters: number;
  roofDepthMeters: number;
  panelWattage: number;
  canvasWidth: number;
  canvasHeight: number;
  siteComplexityScore?: number;
}

export interface StudioPanelCell {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  col: number;
}

export interface StudioBoqPreviewLine {
  id: string;
  sectionId: string;
  category: string;
  name: string;
  quantity: number;
  unit: string;
  indicativeRate: number;
  lineTotal: number;
}

export interface StudioProposalViewModel {
  draftOnly: true;
  pipelineSuccess: boolean;
  pipelineStage: SolarPipelineStage | null;
  pipelineCode: string | null;
  pipelineMessage: string | null;
  stagesCompleted: SolarPipelineStage[];
  designComplete: boolean;
  validationMessage: string | null;
  roofValidationOk: boolean;
  fixGuidance: string[];
  roofAreaM2: number;
  usableAreaM2: number;
  panelCells: StudioPanelCell[];
  panelCount: number;
  systemSizeKw: number;
  monthlyProduction: MonthlyProductionRow[];
  annualProductionKwh: number;
  performanceRatio: number;
  lossBreakdown: LossBreakdown | null;
  stringSizing: StringSizingResult | null;
  cableLossKwh: number;
  clippingLossKwh: number;
  cableDistanceM: number;
  cableRolls: number;
  structureCost: number;
  marginPercent: number;
  grandTotal: number;
  boqSections: BoqSection[];
  boqPreviewLines: StudioBoqPreviewLine[];
  proposalPages: ProposalPreviewPage[];
  warnings: string[];
  assumptions: string[];
  engineeringAssumptions: SimulationAssumption[];
  template: ProposalTemplateDraft | null;
  inputSummary: ProposalInputSummary | null;
}

const ALLOWED_INPUT_SUMMARY_KEYS = new Set([
  "systemSizeKw",
  "tier",
  "systemType",
  "structureType",
  "panelWattage",
  "siteComplexityScore",
]);

export function flattenBoqSections(sections: BoqSection[]): StudioBoqPreviewLine[] {
  const lines: StudioBoqPreviewLine[] = [];
  for (const section of sections) {
    for (const line of section.lines) {
      if (line.unitPrice <= 0 && line.lineTotal <= 0) continue;
      lines.push({
        id: line.id,
        sectionId: section.id,
        category: section.label,
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
        indicativeRate: line.unitPrice,
        lineTotal: line.lineTotal,
      });
    }
  }
  return lines;
}

export function buildIncompleteStudioPages(): ProposalPreviewPage[] {
  return [
    {
      id: "incomplete",
      title: "Proposal Preview",
      subtitle: DESIGN_INCOMPLETE_BOQ_LABEL,
      sections: [{ heading: "Status", lines: [DESIGN_INCOMPLETE_MESSAGE] }],
    },
  ];
}

export function buildStudioProposalPages(
  draft: ProposalDraft,
  template: ProposalTemplateDraft,
  roofWidthMeters: number,
  roofDepthMeters: number,
  usableAreaM2: number,
  roofAreaM2: number
): ProposalPreviewPage[] {
  const summary = draft.inputSummary;
  const boqLines = flattenBoqSections(draft.sections);

  return [
    {
      id: "cover",
      title: template.cover.title,
      subtitle: template.cover.subtitle,
      sections: [
        {
          heading: "Prepared for",
          lines: [PROPOSAL_CLIENT_PREVIEW_LABEL, draft.generatedAt.slice(0, 10)],
        },
        {
          heading: "System snapshot",
          lines: [
            `${template.cover.systemSizeLabel} · ${template.cover.panelCount} panels`,
            `${template.cover.systemTypeLabel} · ${template.cover.tierLabel} package`,
            `Structure: ${template.cover.structureLabel}`,
          ],
        },
      ],
    },
    {
      id: "site-design",
      title: "Site Design",
      subtitle: "Rooftop layout & shading",
      sections: [
        {
          heading: "Roof dimensions",
          lines: [
            `Width ${roofWidthMeters} m × depth ${roofDepthMeters} m`,
            `Drawn roof area ${roofAreaM2} m²`,
            `Usable PV area ${usableAreaM2} m²`,
          ],
        },
        {
          heading: "Array layout",
          lines: [
            `${draft.panelCount} modules per engine layout rules`,
            draft.warnings.length > 0 ? draft.warnings[0] : "Obstacles excluded from placement zones",
          ],
        },
      ],
    },
    {
      id: "system-spec",
      title: "System Specification",
      subtitle: "Equipment & structure",
      sections: [
        {
          heading: "Configuration",
          lines: [
            `System type: ${template.cover.systemTypeLabel}`,
            `Package: ${template.cover.tierLabel}`,
            `Structure: ${template.cover.structureLabel}`,
            `Module: ${summary.panelWattage}W (engine catalog)`,
            `Site complexity score: ${summary.siteComplexityScore}/10`,
          ],
        },
        {
          heading: "Estimates",
          lines: [
            `DC cable run ~${draft.cableDistanceM} m (${draft.cableRolls} roll(s))`,
            `Structure subtotal Rs. ${draft.structureCost.toLocaleString()} (indicative)`,
            `Margin ${draft.pricing.marginPercent}%`,
          ],
        },
      ],
    },
    {
      id: "boq",
      title: "Bill of Quantities",
      subtitle: "Sunchaser 7-section draft",
      sections: [
        {
          heading: "Sections",
          lines: template.sectionSummaries.map(
            (s) => `${s.label} — ${s.lineCount} line(s) · Rs. ${s.subtotal.toLocaleString()}`
          ),
        },
        {
          heading: "Line items (priced)",
          lines: boqLines.map(
            (l) => `${l.name} — ${l.quantity} ${l.unit} @ Rs. ${l.indicativeRate.toLocaleString()}`
          ),
        },
        {
          heading: "Total",
          lines: [`Rs. ${draft.pricing.grandTotal.toLocaleString()} (draft only — not a final quotation)`],
        },
      ],
    },
    {
      id: "next-steps",
      title: "Next Steps",
      subtitle: "Draft workflow",
      sections: [
        { heading: "Review", lines: template.terms.slice(0, 2) },
        {
          heading: "Draft notice",
          lines: [
            "Calculated locally using server/solar/pipeline (unified design pipeline).",
            "No data is saved, exported as PDF, or written to CRM.",
          ],
        },
      ],
    },
  ];
}

export function assertStudioProposalDraftSafe(
  draft: ProposalDraft,
  forbiddenFragments: string[] = []
): boolean {
  if ("input" in (draft as Record<string, unknown>)) return false;
  const keys = Object.keys(draft.inputSummary);
  if (!keys.every((k) => ALLOWED_INPUT_SUMMARY_KEYS.has(k))) return false;
  const blob = JSON.stringify(draft);
  return forbiddenFragments.every((f) => !blob.includes(f));
}

export { buildPipelineStudioViewModel as buildStudioProposalViewModel } from "./solarPipelineClient.ts";
