/**
 * Deterministic mounting-structure kit recommendation from panel count.
 *
 * L3 = 3-panel structural section, L2 = 2-panel structural section.
 * Maximize L3 kits while remaining positions are an exact multiple of 2.
 *
 * Example (owner-required): 10 panels → 2 × L3 + 2 × L2
 * because (2 × 3) + (2 × 2) = 10.
 *
 * These are quotation kit lines. They are NOT the old per-panel inventory SKU
 * `structure_std` ("Standard GI Structure L3" / "L3 14 Gauge" at 4800/panel).
 */

export type StructureKitCode = "L3" | "L2";

export interface StructureKitLine {
  code: StructureKitCode;
  panelPositions: number;
  quantity: number;
}

export interface StructureBreakdown {
  panelCount: number;
  l3: number;
  l2: number;
  remainder: number;
  positions: number;
  kits: StructureKitLine[];
}

export const L3_PANEL_POSITIONS = 3;
export const L2_PANEL_POSITIONS = 2;

/** Production CRM per-panel standard structure sale rate (PKR). */
export const STANDARD_STRUCTURE_PER_PANEL_RATE = 4800;

/** Kit rates preserve the existing per-panel commercial total. */
export const L3_STRUCTURE_KIT_RATE = STANDARD_STRUCTURE_PER_PANEL_RATE * L3_PANEL_POSITIONS;
export const L2_STRUCTURE_KIT_RATE = STANDARD_STRUCTURE_PER_PANEL_RATE * L2_PANEL_POSITIONS;

export const L3_STRUCTURE_CUSTOMER_NAME = "L3 Structure – 3 Panel Section";
export const L2_STRUCTURE_CUSTOMER_NAME = "L2 Structure – 2 Panel Section";
export const L3_STRUCTURE_CUSTOMER_DESCRIPTION =
  "Galvanized iron mounting section covering 3 panel positions, including Rawal bolts.";
export const L2_STRUCTURE_CUSTOMER_DESCRIPTION =
  "Galvanized iron mounting section covering 2 panel positions, including Rawal bolts.";

export const QUOTE_STRUCTURE_KIT_LINE_KIND = "quote_structure_kit";
export const LEGACY_PER_PANEL_STRUCTURE_PRODUCT_ID = "structure_std";
export const LEGACY_PER_PANEL_STRUCTURE_ROW_ID = "structure_row";
export const STRUCTURE_L3_ROW_ID = "structure_l3_row";
export const STRUCTURE_L2_ROW_ID = "structure_l2_row";

export function recommendStructures(panelCount: number): StructureBreakdown {
  const n = Math.max(0, Math.floor(Number(panelCount) || 0));
  if (n <= 0) {
    return emptyBreakdown(0);
  }

  let l3 = Math.floor(n / L3_PANEL_POSITIONS);
  while (l3 >= 0) {
    const remainderAfterL3 = n - l3 * L3_PANEL_POSITIONS;
    if (remainderAfterL3 % L2_PANEL_POSITIONS === 0) {
      const l2 = remainderAfterL3 / L2_PANEL_POSITIONS;
      return toBreakdown(n, l3, l2, 0);
    }
    l3 -= 1;
  }

  return toBreakdown(n, 0, 0, n);
}

export function structureKitTotal(breakdown: Pick<StructureBreakdown, "l3" | "l2">): number {
  const l3 = Math.max(0, Math.floor(Number(breakdown.l3) || 0));
  const l2 = Math.max(0, Math.floor(Number(breakdown.l2) || 0));
  return l3 * L3_STRUCTURE_KIT_RATE + l2 * L2_STRUCTURE_KIT_RATE;
}

export function normalizeStructureBreakdown(
  panelCount: number,
  override?: { l3?: number; l2?: number } | null
): StructureBreakdown {
  const n = Math.max(0, Math.floor(Number(panelCount) || 0));
  if (!override) return recommendStructures(n);
  const l3 = Math.max(0, Math.floor(Number(override.l3) || 0));
  const l2 = Math.max(0, Math.floor(Number(override.l2) || 0));
  const positions = l3 * L3_PANEL_POSITIONS + l2 * L2_PANEL_POSITIONS;
  const remainder = Math.max(0, n - positions);
  return toBreakdown(n, l3, l2, remainder);
}

export function isQuoteStructureKitRow(row: { id?: string; quoteLineKind?: string } | null | undefined): boolean {
  if (!row) return false;
  if (row.quoteLineKind === QUOTE_STRUCTURE_KIT_LINE_KIND) return true;
  return row.id === STRUCTURE_L3_ROW_ID || row.id === STRUCTURE_L2_ROW_ID;
}

export function isLegacyPerPanelStructureSku(row: {
  id?: string;
  catalogProductId?: string;
  name?: string;
  rate?: number;
  qty?: number;
} | null | undefined): boolean {
  if (!row) return false;
  if (row.id === LEGACY_PER_PANEL_STRUCTURE_PRODUCT_ID) return true;
  if (row.catalogProductId === LEGACY_PER_PANEL_STRUCTURE_PRODUCT_ID) return true;
  if (row.id === LEGACY_PER_PANEL_STRUCTURE_ROW_ID) {
    const rate = Number(row.rate) || 0;
    return rate === STANDARD_STRUCTURE_PER_PANEL_RATE || /14\s*gauge/i.test(String(row.name || ""));
  }
  return false;
}

export function structureKitRowFields(code: StructureKitCode, quantity: number) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  if (code === "L3") {
    return {
      srNo: "10a",
      name: L3_STRUCTURE_CUSTOMER_NAME,
      description: L3_STRUCTURE_CUSTOMER_DESCRIPTION,
      brand: "Mughal",
      unit: "Section",
      qty,
      rate: L3_STRUCTURE_KIT_RATE,
      total: qty * L3_STRUCTURE_KIT_RATE,
      quoteLineKind: QUOTE_STRUCTURE_KIT_LINE_KIND,
      catalogProductId: "",
    };
  }
  return {
    srNo: "10b",
    name: L2_STRUCTURE_CUSTOMER_NAME,
    description: L2_STRUCTURE_CUSTOMER_DESCRIPTION,
    brand: "Mughal",
    unit: "Section",
    qty,
    rate: L2_STRUCTURE_KIT_RATE,
    total: qty * L2_STRUCTURE_KIT_RATE,
    quoteLineKind: QUOTE_STRUCTURE_KIT_LINE_KIND,
    catalogProductId: "",
  };
}

function emptyBreakdown(panelCount: number): StructureBreakdown {
  return {
    panelCount,
    l3: 0,
    l2: 0,
    remainder: 0,
    positions: 0,
    kits: [],
  };
}

function toBreakdown(panelCount: number, l3: number, l2: number, remainder: number): StructureBreakdown {
  const kits: StructureKitLine[] = [];
  if (l3 > 0) kits.push({ code: "L3", panelPositions: L3_PANEL_POSITIONS, quantity: l3 });
  if (l2 > 0) kits.push({ code: "L2", panelPositions: L2_PANEL_POSITIONS, quantity: l2 });
  return {
    panelCount,
    l3,
    l2,
    remainder,
    positions: l3 * L3_PANEL_POSITIONS + l2 * L2_PANEL_POSITIONS,
    kits,
  };
}
