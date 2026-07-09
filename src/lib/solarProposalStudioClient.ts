/**
 * Client adapter — Solar Proposal Studio UI uses the same deterministic engine as server/solar/proposal.
 * Draft-only. No routes, save, PDF, AI, or CRM mutation.
 */

import { layoutPanels, type PanelPlacement } from "../../server/solar/proposal/PanelLayoutEngine.ts";
import { generateSolarProposal } from "../../server/solar/proposal/SolarProposalEngine.ts";
import { panelCountForSystem } from "../../server/solar/proposal/SolarDesignRules.ts";
import { polygonArea, type DesignObstacle, type DesignPoint } from "./solarDesignStudio.ts";
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
  SolarProposalInput,
  StructureType,
  SupportedSystemSizeKw,
  SystemType,
} from "../../server/solar/proposal/SolarProposalModels.ts";
import {
  SUPPORTED_SYSTEM_SIZES_KW,
  SolarProposalValidationError,
  validateAndNormalizeSolarProposalInput,
} from "../../server/solar/proposal/SolarProposalModels.ts";
import { DEFAULT_PANEL_WATTAGE } from "../../server/solar/proposal/SolarDesignRules.ts";

export type { BoqSection, EquipmentTier, ProposalDraft, ProposalInputSummary, ProposalTemplateDraft, StructureType, SupportedSystemSizeKw, SystemType };
export { SUPPORTED_SYSTEM_SIZES_KW, generateSolarProposal };

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
  designComplete: boolean;
  validationMessage: string | null;
  roofAreaM2: number;
  usableAreaM2: number;
  panelCells: StudioPanelCell[];
  panelCount: number;
  systemSizeKw: number;
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

function panelCountForSystemSafe(sizeKw: SupportedSystemSizeKw, panelWattage: number): number {
  if (!Number.isFinite(panelWattage) || panelWattage <= 0) return Number.POSITIVE_INFINITY;
  return panelCountForSystem(sizeKw, panelWattage);
}

export function snapToSupportedSystemSizeKw(kw: number): SupportedSystemSizeKw {
  const sizes = [...SUPPORTED_SYSTEM_SIZES_KW];
  let best: SupportedSystemSizeKw = sizes[0];
  let bestDist = Infinity;
  for (const size of sizes) {
    const dist = Math.abs(size - kw);
    if (dist < bestDist) {
      bestDist = dist;
      best = size;
    }
  }
  return best;
}

export function resolveStudioSystemSizeKw(input: StudioCanvasInput): SupportedSystemSizeKw | null {
  if (input.roofBoundary.length < 3) return null;

  const layoutInput = toEngineLayoutInput(input, 15);
  const maxLayout = layoutPanels(layoutInput);
  if (maxLayout.placedPanels.length === 0) return null;

  if (input.targetSystemKw !== "auto") {
    const snapped = snapToSupportedSystemSizeKw(input.targetSystemKw);
    const needed = panelCountForSystemSafe(snapped, input.panelWattage);
    if (needed > maxLayout.placedPanels.length) return null;
    return snapped;
  }

  for (let i = sizesDescending().length - 1; i >= 0; i -= 1) {
    const size = sizesDescending()[i];
    const needed = panelCountForSystemSafe(size, input.panelWattage);
    if (needed <= maxLayout.placedPanels.length) return size;
  }
  return 3;
}

function sizesDescending(): SupportedSystemSizeKw[] {
  return [...SUPPORTED_SYSTEM_SIZES_KW].sort((a, b) => b - a) as SupportedSystemSizeKw[];
}

function toEngineLayoutInput(input: StudioCanvasInput, systemSizeKw: SupportedSystemSizeKw): SolarProposalInput {
  return {
    systemSizeKw,
    tier: input.packageTier,
    systemType: input.systemType,
    structureType: input.structureType,
    panelWattage: input.panelWattage,
    roofBoundary: input.roofBoundary,
    obstacles: input.obstacles,
    roofWidthMeters: input.roofWidthMeters,
    canvasWidth: input.canvasWidth,
    siteComplexityScore: input.siteComplexityScore ?? 0,
  };
}

function roofAreaM2FromBoundary(boundary: DesignPoint[], roofWidthMeters: number, canvasWidth: number): number {
  if (boundary.length < 3 || roofWidthMeters <= 0 || canvasWidth <= 0) return 0;
  const metersPerPixel = roofWidthMeters / canvasWidth;
  return Math.round(polygonArea(boundary) * metersPerPixel * metersPerPixel * 10) / 10;
}

function mapPanelCells(placements: PanelPlacement[]): StudioPanelCell[] {
  return placements.map((p) => ({
    id: `panel-${p.row}-${p.col}`,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    row: p.row,
    col: p.col,
  }));
}

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
            "Calculated locally using server/solar/proposal engine rules.",
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

export function buildStudioProposalViewModel(input: StudioCanvasInput): StudioProposalViewModel {
  const roofAreaM2 = roofAreaM2FromBoundary(input.roofBoundary, input.roofWidthMeters, input.canvasWidth);
  const empty: StudioProposalViewModel = {
    draftOnly: true,
    designComplete: false,
    validationMessage: null,
    roofAreaM2,
    usableAreaM2: 0,
    panelCells: [],
    panelCount: 0,
    systemSizeKw: 0,
    cableDistanceM: 0,
    cableRolls: 0,
    structureCost: 0,
    marginPercent: 0,
    grandTotal: 0,
    boqSections: [],
    boqPreviewLines: [],
    proposalPages: buildIncompleteStudioPages(),
    warnings: [],
    assumptions: [],
    template: null,
    inputSummary: null,
  };

  if (input.roofBoundary.length < 3) {
    return { ...empty, validationMessage: DESIGN_INCOMPLETE_MESSAGE };
  }

  try {
    validateAndNormalizeSolarProposalInput(
      {
        systemSizeKw: 3,
        tier: input.packageTier,
        systemType: input.systemType,
        structureType: input.structureType,
        panelWattage: input.panelWattage,
        siteComplexityScore: input.siteComplexityScore ?? 0,
        roofWidthMeters: input.roofWidthMeters,
        canvasWidth: input.canvasWidth,
      },
      DEFAULT_PANEL_WATTAGE
    );
  } catch (e) {
    const message =
      e instanceof SolarProposalValidationError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Invalid proposal inputs.";
    return { ...empty, validationMessage: message };
  }

  const resolvedSize = resolveStudioSystemSizeKw(input);
  if (!resolvedSize) {
    return {
      ...empty,
      validationMessage: "Roof layout cannot support the selected system size.",
    };
  }

  try {
    const engineInput = toEngineLayoutInput(input, resolvedSize);
    const layout = layoutPanels(engineInput);
    const { draft, template } = generateSolarProposal(engineInput);

    if (!assertStudioProposalDraftSafe(draft)) {
      return { ...empty, validationMessage: "Proposal draft failed safety checks." };
    }

    const proposalPages = buildStudioProposalPages(
      draft,
      template,
      input.roofWidthMeters,
      input.roofDepthMeters,
      layout.usableAreaM2,
      roofAreaM2
    );

    return {
      draftOnly: true,
      designComplete: true,
      validationMessage: null,
      roofAreaM2,
      usableAreaM2: layout.usableAreaM2,
      panelCells: mapPanelCells(layout.placedPanels),
      panelCount: draft.panelCount,
      systemSizeKw: draft.systemSizeKw,
      cableDistanceM: draft.cableDistanceM,
      cableRolls: draft.cableRolls,
      structureCost: draft.structureCost,
      marginPercent: draft.pricing.marginPercent,
      grandTotal: draft.pricing.grandTotal,
      boqSections: draft.sections,
      boqPreviewLines: flattenBoqSections(draft.sections),
      proposalPages,
      warnings: [...layout.warnings, ...draft.warnings],
      assumptions: draft.assumptions,
      template,
      inputSummary: draft.inputSummary,
    };
  } catch (e) {
    const message =
      e instanceof SolarProposalValidationError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Unable to generate proposal draft.";
    return { ...empty, validationMessage: message };
  }
}
