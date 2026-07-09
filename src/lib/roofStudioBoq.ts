/**
 * Roof Studio — editable draft BOQ (no save, no PDF).
 */

import type { StructureLayout } from "./roofStudioStructure.ts";
import { structureMemberCounts } from "./roofStudioStructure.ts";
import type { StudioPanelPlacement } from "./roofStudioPanels.ts";
import { panelSystemKw } from "./roofStudioPanels.ts";
import { nextStudioId } from "./roofStudioClient.ts";

export interface EditableBoqLine {
  id: string;
  section: string;
  item: string;
  brand: string;
  qty: number;
  unit: string;
  rate: number;
  marginPercent: number;
  overridden: boolean;
}

export const BOQ_MARGIN_MIN = 0;
export const BOQ_MARGIN_MAX = 100;

export function isValidBoqQty(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function isValidBoqRate(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function isValidBoqMargin(value: number): boolean {
  return Number.isFinite(value) && value >= BOQ_MARGIN_MIN && value <= BOQ_MARGIN_MAX;
}

function sanitizeBoqNumericFields(line: EditableBoqLine): EditableBoqLine {
  return {
    ...line,
    qty: isValidBoqQty(line.qty) ? line.qty : 0,
    rate: isValidBoqRate(line.rate) ? line.rate : 0,
    marginPercent: isValidBoqMargin(line.marginPercent) ? line.marginPercent : BOQ_MARGIN_MIN,
  };
}

export function lineTotal(line: EditableBoqLine): number {
  const safe = sanitizeBoqNumericFields(line);
  const sub = safe.qty * safe.rate;
  const total = Math.round(sub * (1 + safe.marginPercent / 100));
  if (!Number.isFinite(total) || total < 0) return 0;
  return total;
}

export interface BoqUpdateResult {
  lines: EditableBoqLine[];
  warning: string | null;
}

export function updateBoqLine(
  lines: EditableBoqLine[],
  id: string,
  patch: Partial<EditableBoqLine>
): BoqUpdateResult {
  const target = lines.find((l) => l.id === id);
  if (!target) return { lines, warning: null };

  const nextPatch: Partial<EditableBoqLine> = {};
  const warnings: string[] = [];

  if ("qty" in patch) {
    const qty = patch.qty!;
    if (!isValidBoqQty(qty)) warnings.push("Qty must be a finite number ≥ 0.");
    else nextPatch.qty = qty;
  }
  if ("rate" in patch) {
    const rate = patch.rate!;
    if (!isValidBoqRate(rate)) warnings.push("Rate must be a finite number ≥ 0.");
    else nextPatch.rate = rate;
  }
  if ("marginPercent" in patch) {
    const marginPercent = patch.marginPercent!;
    if (!isValidBoqMargin(marginPercent)) {
      warnings.push(`Margin must be a finite number between ${BOQ_MARGIN_MIN} and ${BOQ_MARGIN_MAX}.`);
    } else {
      nextPatch.marginPercent = marginPercent;
    }
  }

  for (const key of ["item", "brand", "section", "unit"] as const) {
    if (key in patch) nextPatch[key] = patch[key] as EditableBoqLine[typeof key];
  }
  if ("overridden" in patch) nextPatch.overridden = patch.overridden;

  const numericRejected =
    ("qty" in patch && !("qty" in nextPatch)) ||
    ("rate" in patch && !("rate" in nextPatch)) ||
    ("marginPercent" in patch && !("marginPercent" in nextPatch));

  if (numericRejected && warnings.length === 0) {
    warnings.push("Invalid BOQ value rejected.");
  }

  const hasChanges = Object.keys(nextPatch).length > 0 || numericRejected;
  if (!hasChanges) return { lines, warning: warnings[0] ?? null };

  const updatedLines = lines.map((l) =>
    l.id === id
      ? sanitizeBoqNumericFields({
          ...l,
          ...nextPatch,
          overridden: nextPatch.overridden ?? (numericRejected ? l.overridden : true),
        })
      : l
  );

  return { lines: updatedLines, warning: warnings[0] ?? null };
}

export function generateDraftBoq(opts: {
  panelCount: number;
  systemKw: number;
  structure: StructureLayout;
  panelWattage: number;
}): EditableBoqLine[] {
  const counts = structureMemberCounts(opts.structure);
  const lines: EditableBoqLine[] = [
    {
      id: nextStudioId("boq"),
      section: "PV Modules",
      item: `${opts.panelWattage}W Mono-PERC Module`,
      brand: "JA Solar / Longi (draft)",
      qty: opts.panelCount,
      unit: "pcs",
      rate: 18500,
      marginPercent: 12,
      overridden: false,
    },
    {
      id: nextStudioId("boq"),
      section: "Inverter",
      item: `On-grid inverter ~${opts.systemKw} kW`,
      brand: "Growatt (draft)",
      qty: 1,
      unit: "set",
      rate: opts.systemKw * 22000,
      marginPercent: 10,
      overridden: false,
    },
    {
      id: nextStudioId("boq"),
      section: "Elevated Structure",
      item: "H-Beam / Girder",
      brand: "Sunchaser galvanized",
      qty: counts["h-beam"],
      unit: "pcs",
      rate: 18500,
      marginPercent: 15,
      overridden: false,
    },
    {
      id: nextStudioId("boq"),
      section: "Elevated Structure",
      item: "C-Channel / Purlin",
      brand: "Sunchaser galvanized",
      qty: counts["c-channel"],
      unit: "pcs",
      rate: 6200,
      marginPercent: 15,
      overridden: false,
    },
    {
      id: nextStudioId("boq"),
      section: "Civil Works",
      item: "RCC foundation blocks",
      brand: "Site cast",
      qty: counts.foundation || counts.column,
      unit: "nos",
      rate: 4500,
      marginPercent: 12,
      overridden: false,
    },
    {
      id: nextStudioId("boq"),
      section: "Civil Works",
      item: `Air passage (${opts.structure.airPassageM} m)`,
      brand: "As per layout",
      qty: 1,
      unit: "lot",
      rate: 12000,
      marginPercent: 10,
      overridden: false,
    },
    {
      id: nextStudioId("boq"),
      section: "Civil Works",
      item: `Cleaning space (${opts.structure.cleaningSpaceM} m)`,
      brand: "As per layout",
      qty: 1,
      unit: "lot",
      rate: 8500,
      marginPercent: 10,
      overridden: false,
    },
  ];
  return lines.filter((l) => l.qty > 0 || l.section === "Civil Works").map(sanitizeBoqNumericFields);
}

/** Sum line totals; never returns NaN/Infinity/negative even if a line is corrupt. */
export function boqGrandTotal(lines: EditableBoqLine[]): number {
  let sum = 0;
  for (const line of lines) {
    const part = lineTotal(line);
    if (!Number.isFinite(part) || part < 0) continue;
    const next = sum + part;
    if (!Number.isFinite(next) || next < 0) return 0;
    sum = next;
  }
  return Number.isFinite(sum) && sum >= 0 ? sum : 0;
}

export function boqFromPlacements(
  placements: StudioPanelPlacement[],
  structure: StructureLayout,
  panelWattage: number
): EditableBoqLine[] {
  return generateDraftBoq({
    panelCount: placements.length,
    systemKw: panelSystemKw(placements, panelWattage),
    structure,
    panelWattage,
  });
}
