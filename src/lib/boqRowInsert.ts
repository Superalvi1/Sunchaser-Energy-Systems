import type { BoqRow } from "../types";

export type BoqRowKind = BoqRow["type"];

export function createBoqRow(type: BoqRowKind): BoqRow {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    srNo: undefined,
    name:
      type === "heading"
        ? "New Section Heading"
        : type === "subtotal"
          ? "Section Subtotal"
          : "New Item Name",
    description: "",
    brand: "",
    unit: type === "item" ? "Pcs" : "",
    qty: type === "item" ? 1 : 0,
    rate: 0,
    total: 0,
  };
}

export function reindexBoqItemNumbers(rows: BoqRow[]): BoqRow[] {
  let itemCounter = 1;
  return rows.map((row) => {
    if (row?.type === "item") {
      return { ...row, srNo: String(itemCounter++) };
    }
    return row;
  });
}

export function findSectionHeadingName(rows: BoqRow[], rowIndex: number): string | null {
  for (let i = rowIndex; i >= 0; i--) {
    if (rows[i]?.type === "heading") return rows[i].name;
  }
  return null;
}

/** Index to insert a new item inside the section that starts at / contains rowIndex. */
export function findInsertIndexForSectionItem(rows: BoqRow[], sectionRowIndex: number): number {
  const marker = rows[sectionRowIndex];
  if (!marker) return rows.length;

  if (marker.type === "subtotal") {
    return sectionRowIndex;
  }

  if (marker.type === "heading") {
    for (let i = sectionRowIndex + 1; i < rows.length; i++) {
      if (rows[i].type === "subtotal" || rows[i].type === "heading") {
        return i;
      }
    }
    return rows.length;
  }

  // Item row: insert directly below current item
  return sectionRowIndex + 1;
}

export function insertBoqRowAt(rows: BoqRow[], index: number, row: BoqRow): BoqRow[] {
  const list = [...rows];
  const clamped = Math.max(0, Math.min(index, list.length));
  list.splice(clamped, 0, row);
  return list;
}

export type BoqInsertAction =
  | "row-above"
  | "row-below"
  | "section-above"
  | "section-below"
  | "item-in-section";

export function applyBoqInsertAction(rows: BoqRow[], rowIndex: number, action: BoqInsertAction): BoqRow[] {
  const row = rows[rowIndex];
  if (!row) return rows;

  switch (action) {
    case "row-above":
      return insertBoqRowAt(rows, rowIndex, createBoqRow("item"));
    case "row-below":
      return insertBoqRowAt(rows, rowIndex + 1, createBoqRow("item"));
    case "section-above":
      return insertBoqRowAt(rows, rowIndex, createBoqRow("heading"));
    case "section-below":
      return insertBoqRowAt(rows, rowIndex + 1, createBoqRow("heading"));
    case "item-in-section": {
      const insertAt = findInsertIndexForSectionItem(rows, rowIndex);
      return insertBoqRowAt(rows, insertAt, createBoqRow("item"));
    }
    default:
      return rows;
  }
}
