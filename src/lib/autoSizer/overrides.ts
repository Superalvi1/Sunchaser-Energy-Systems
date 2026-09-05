/**
 * Manual override helpers for AutoSizer-generated quote snapshots.
 *
 * The saved BOQ snapshot is authoritative. AutoSizer must not rewrite a
 * human-edited field unless the user explicitly re-runs AutoSizer / reset.
 */

import type { BoqRow } from "../../types";
import { calculateBoqRowTotals } from "../boqPackageLibrary";
import {
  L2_STRUCTURE_KIT_RATE,
  L3_STRUCTURE_KIT_RATE,
  normalizeStructureBreakdown,
  type StructureBreakdown,
} from "./structureRecommendation";
import {
  STRUCTURE_L2_ROW_ID,
  STRUCTURE_L3_ROW_ID,
  STRUCTURE_JOB_ROW_ID,
} from "./generateRecommendedBoq";

export type QuoteManualOverrideField =
  | "panel"
  | "inverter"
  | "battery"
  | "structure"
  | "cables"
  | "accessories"
  | "prices";

export type QuoteManualOverrides = Partial<Record<QuoteManualOverrideField, boolean>>;

export const EMPTY_MANUAL_OVERRIDES: QuoteManualOverrides = {};

export function markOverride(
  current: QuoteManualOverrides | null | undefined,
  field: QuoteManualOverrideField
): QuoteManualOverrides {
  return { ...(current || {}), [field]: true };
}

export function isOverridden(
  current: QuoteManualOverrides | null | undefined,
  field: QuoteManualOverrideField
): boolean {
  return current?.[field] === true;
}

export function shouldRegenerateField(
  current: QuoteManualOverrides | null | undefined,
  field: QuoteManualOverrideField,
  forceReset: boolean
): boolean {
  if (forceReset) return true;
  return !isOverridden(current, field);
}

function upsertStructureKitRow(
  rows: BoqRow[],
  id: string,
  payload: Omit<BoqRow, "id" | "type">
): BoqRow[] {
  const existing = rows.findIndex((r) => r.id === id);
  const row: BoqRow = { id, type: "item", ...payload };
  if (existing >= 0) {
    const next = rows.slice();
    next[existing] = { ...next[existing], ...row };
    return next;
  }
  const headingIdx = rows.findIndex((r) => r.id === "h-6");
  const insertAt = headingIdx >= 0 ? headingIdx + 1 : rows.length;
  const next = rows.slice();
  next.splice(insertAt, 0, row);
  return next;
}

function removeRow(rows: BoqRow[], id: string): BoqRow[] {
  return rows.filter((r) => r.id !== id);
}

/** Apply salesperson L2/L3 quantities onto an existing BOQ snapshot. */
export function applyStructureKitOverride(
  rows: BoqRow[],
  panelCount: number,
  override: { l3: number; l2: number }
): { rows: BoqRow[]; structure: StructureBreakdown } {
  const structure = normalizeStructureBreakdown(panelCount, override);
  let next = rows.map((r) => ({ ...r }));
  next = removeRow(next, STRUCTURE_JOB_ROW_ID);

  if (structure.l3 > 0) {
    next = upsertStructureKitRow(next, STRUCTURE_L3_ROW_ID, {
      srNo: "10a",
      name: "L3 Mounting Structure (3-panel kit)",
      description: "Galvanized L3 14 Gauge iron mounting structure — 3 panel positions per kit, Rawal bolts",
      brand: "Mughal",
      unit: "Pcs",
      qty: structure.l3,
      rate: L3_STRUCTURE_KIT_RATE,
      total: structure.l3 * L3_STRUCTURE_KIT_RATE,
    });
  } else {
    next = removeRow(next, STRUCTURE_L3_ROW_ID);
  }

  if (structure.l2 > 0) {
    next = upsertStructureKitRow(next, STRUCTURE_L2_ROW_ID, {
      srNo: "10b",
      name: "L2 Mounting Structure (2-panel kit)",
      description: "Galvanized L2 14 Gauge iron mounting structure — 2 panel positions per kit, Rawal bolts",
      brand: "Mughal",
      unit: "Pcs",
      qty: structure.l2,
      rate: L2_STRUCTURE_KIT_RATE,
      total: structure.l2 * L2_STRUCTURE_KIT_RATE,
    });
  } else {
    next = removeRow(next, STRUCTURE_L2_ROW_ID);
  }

  return { rows: calculateBoqRowTotals(next), structure };
}

export function applyNamedRowQty(
  rows: BoqRow[],
  rowId: string,
  qty: number
): BoqRow[] {
  const next = rows.map((r) => {
    if (r.id !== rowId || r.type !== "item") return r;
    const safeQty = Math.max(0, Number(qty) || 0);
    const rate = Number(r.rate) || 0;
    return { ...r, qty: safeQty, total: safeQty * rate };
  });
  return calculateBoqRowTotals(next);
}

export function applyNamedRowFields(
  rows: BoqRow[],
  rowId: string,
  patch: Partial<Pick<BoqRow, "name" | "description" | "brand" | "qty" | "rate" | "unit">>
): BoqRow[] {
  const next = rows.map((r) => {
    if (r.id !== rowId || r.type !== "item") return r;
    const merged = { ...r, ...patch };
    const qty = Number(merged.qty) || 0;
    const rate = Number(merged.rate) || 0;
    return { ...merged, total: qty * rate };
  });
  return calculateBoqRowTotals(next);
}

export function snapshotHasItems(rows: BoqRow[] | null | undefined): boolean {
  return Array.isArray(rows) && rows.some((r) => r && r.type === "item");
}
