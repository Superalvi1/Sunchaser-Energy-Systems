/**
 * PDF-only customer presentation transform for the standard 3-page quotation.
 *
 * The saved BoqRow[] snapshot stays the source of truth. This module never
 * mutates historical quote data. It only builds a compact customer table when
 * the original snapshot would overflow the 3-page BOQ weight budget.
 */

import {
  quoteBoqOverflow,
  type BoqPdfRow,
} from "./quoteBoqPdf";
import {
  LEGACY_PER_PANEL_STRUCTURE_ROW_ID,
  STRUCTURE_L2_ROW_ID,
  STRUCTURE_L3_ROW_ID,
} from "./autoSizer/structureRecommendation";

export const CUSTOMER_BOQ_TOTAL_TOLERANCE_PKR = 1;

export const THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE =
  "This quotation still exceeds the standard 3-page customer format after automatic grouping. Review unusually detailed custom BOQ items.";

export const THREE_PAGE_BOQ_TOTAL_MISMATCH_MESSAGE =
  "Customer quotation totals could not be verified after grouping. Final PDF is blocked.";

export type CustomerBoqRow = BoqPdfRow & {
  brand?: string;
  quoteLineKind?: string;
  catalogProductId?: string;
};

type CustomerGroupKey =
  | "panel"
  | "inverter"
  | "battery"
  | "dc"
  | "ac"
  | "earth"
  | "standard_structure"
  | "other_structure"
  | "civil"
  | "install"
  | "freight"
  | "net_metering"
  | "survey";

const KNOWN_ITEM_GROUPS: Record<string, CustomerGroupKey> = {
  panel_row: "panel",
  inverter_row: "inverter",
  battery_row: "battery",
  dc_cable_row: "dc",
  supplies_row: "dc",
  ac_cable_row: "ac",
  db_box_row: "ac",
  earth_wire_row: "earth",
  earthing_bore_row: "earth",
  [STRUCTURE_L3_ROW_ID]: "standard_structure",
  [STRUCTURE_L2_ROW_ID]: "standard_structure",
  [LEGACY_PER_PANEL_STRUCTURE_ROW_ID]: "other_structure",
  civil_work_row: "civil",
  install_service_row: "install",
  freight_row: "freight",
  net_metering_row: "net_metering",
  survey_design_row: "survey",
};

const GROUP_LABEL: Record<CustomerGroupKey, { name: string; unit: string }> = {
  panel: { name: "Solar Panels", unit: "Pcs" },
  inverter: { name: "Inverter", unit: "Pcs" },
  battery: { name: "Battery Storage", unit: "Pcs" },
  dc: { name: "DC Cabling & Accessories", unit: "Job" },
  ac: { name: "AC Cabling & Protection", unit: "Job" },
  earth: { name: "Earthing System", unit: "Job" },
  standard_structure: { name: "Standard Mounting Structure", unit: "Job" },
  other_structure: { name: "Mounting Structure", unit: "Job" },
  civil: { name: "Civil Work", unit: "Job" },
  install: { name: "Installation & Commissioning", unit: "Job" },
  freight: { name: "Freight / Transportation", unit: "Job" },
  net_metering: { name: "Net Metering", unit: "Job" },
  survey: { name: "Survey / Design / Engineering", unit: "Job" },
};

export function pricedBoqItemTotal(row: CustomerBoqRow | null | undefined): number {
  if (!row || String(row.type || "") !== "item") return 0;
  const total = Number(row.total);
  if (Number.isFinite(total)) return total;
  const qty = Number(row.qty) || 0;
  const rate = Number(row.rate) || 0;
  return Math.round(qty * rate * 100) / 100;
}

export function sumPricedBoqItems(rows: CustomerBoqRow[] | null | undefined): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, row) => sum + pricedBoqItemTotal(row), 0);
}

export function customerBoqTotalsPreserved(
  original: CustomerBoqRow[],
  customer: CustomerBoqRow[],
  tolerance = CUSTOMER_BOQ_TOTAL_TOLERANCE_PKR
): boolean {
  return Math.abs(sumPricedBoqItems(original) - sumPricedBoqItems(customer)) <= tolerance;
}

export function assertCustomerBoqTotalsPreserved(
  original: CustomerBoqRow[],
  customer: CustomerBoqRow[],
  tolerance = CUSTOMER_BOQ_TOTAL_TOLERANCE_PKR
): void {
  const originalTotal = sumPricedBoqItems(original);
  const customerTotal = sumPricedBoqItems(customer);
  if (Math.abs(originalTotal - customerTotal) > tolerance) {
    throw new Error(
      `Customer BOQ totals drifted: original ${originalTotal} vs customer ${customerTotal}`
    );
  }
}

function cloneRow(row: CustomerBoqRow): CustomerBoqRow {
  return { ...row };
}

function groupKeyFor(row: CustomerBoqRow): CustomerGroupKey | null {
  const id = String(row.id || "");
  return KNOWN_ITEM_GROUPS[id] || null;
}

function includedComponentLine(row: CustomerBoqRow): string {
  const name = String(row.name || "").trim();
  const qty = Number(row.qty);
  const unit = String(row.unit || "").trim();
  if (Number.isFinite(qty) && qty > 0 && unit && name) return `${qty} ${unit} ${name}`;
  return name;
}

function combinedDescription(members: CustomerBoqRow[]): string {
  const parts = members.map(includedComponentLine).filter(Boolean);
  if (parts.length <= 1) {
    return String(members[0]?.description || parts[0] || "").trim();
  }
  return `Includes: ${parts.join("; ")}.`;
}

function standardStructureDescription(members: CustomerBoqRow[]): string {
  const l3 = members.find((r) => String(r.id) === STRUCTURE_L3_ROW_ID);
  const l2 = members.find((r) => String(r.id) === STRUCTURE_L2_ROW_ID);
  const bits: string[] = [];
  const l3Qty = Number(l3?.qty) || 0;
  const l2Qty = Number(l2?.qty) || 0;
  if (l3Qty > 0) bits.push(`${l3Qty} × L3 (3-panel sections)`);
  if (l2Qty > 0) bits.push(`${l2Qty} × L2 (2-panel sections)`);
  if (!bits.length) return "Standard galvanized mounting structure.";
  return `Standard galvanized mounting structure: ${bits.join(" + ")}`;
}

function collapseGroup(key: CustomerGroupKey, members: CustomerBoqRow[]): CustomerBoqRow {
  if (members.length === 1 && key !== "standard_structure") {
    return cloneRow(members[0]);
  }
  const total = sumPricedBoqItems(members);
  const label = GROUP_LABEL[key];
  const description =
    key === "standard_structure" ? standardStructureDescription(members) : combinedDescription(members);
  return {
    id: `customer-${key}`,
    type: "item",
    name: members.length === 1 && key !== "standard_structure" ? String(members[0].name || label.name) : label.name,
    description,
    unit: label.unit,
    qty: 1,
    rate: total,
    total,
    brand: members.length === 1 ? members[0].brand : "",
  };
}

/**
 * Deterministic customer-facing BOQ. Headings/subtotals are omitted.
 * Known AutoSizer ids are grouped; unknown/custom item rows stay individual.
 */
export function buildCustomerFacingBoqRows(rows: CustomerBoqRow[] | null | undefined): CustomerBoqRow[] {
  const source = Array.isArray(rows) ? rows : [];
  const items = source.filter((row) => String(row?.type || "") === "item");
  const emittedGroups = new Set<CustomerGroupKey>();
  const out: CustomerBoqRow[] = [];

  for (const row of items) {
    const key = groupKeyFor(row);
    if (!key) {
      out.push(cloneRow(row));
      continue;
    }
    if (emittedGroups.has(key)) continue;
    emittedGroups.add(key);
    const members = items.filter((candidate) => groupKeyFor(candidate) === key);
    out.push(collapseGroup(key, members));
  }

  return out;
}

export interface ResolvedCustomerBoq {
  rows: CustomerBoqRow[];
  consolidated: boolean;
  blocked: boolean;
  originalOverflow: boolean;
  originalWeight: number;
  customerWeight: number;
  originalTotal: number;
  customerTotal: number;
  totalsPreserved: boolean;
  itemCount: number;
  message: string | null;
}

export function resolveCustomerFacingBoq(rows: CustomerBoqRow[] | null | undefined): ResolvedCustomerBoq {
  const source = Array.isArray(rows) ? rows : [];
  const originalFit = quoteBoqOverflow(source);
  const originalTotal = sumPricedBoqItems(source);

  if (!originalFit.overflow) {
    return {
      rows: source.map(cloneRow),
      consolidated: false,
      blocked: false,
      originalOverflow: false,
      originalWeight: originalFit.weight,
      customerWeight: originalFit.weight,
      originalTotal,
      customerTotal: originalTotal,
      totalsPreserved: true,
      itemCount: originalFit.itemCount,
      message: null,
    };
  }

  const customerRows = buildCustomerFacingBoqRows(source);
  const customerTotal = sumPricedBoqItems(customerRows);
  const totalsPreserved = customerBoqTotalsPreserved(source, customerRows);
  const customerFit = quoteBoqOverflow(customerRows);

  if (!totalsPreserved) {
    return {
      rows: source.map(cloneRow),
      consolidated: false,
      blocked: true,
      originalOverflow: true,
      originalWeight: originalFit.weight,
      customerWeight: customerFit.weight,
      originalTotal,
      customerTotal,
      totalsPreserved: false,
      itemCount: originalFit.itemCount,
      message: THREE_PAGE_BOQ_TOTAL_MISMATCH_MESSAGE,
    };
  }

  if (!customerFit.overflow) {
    return {
      rows: customerRows,
      consolidated: true,
      blocked: false,
      originalOverflow: true,
      originalWeight: originalFit.weight,
      customerWeight: customerFit.weight,
      originalTotal,
      customerTotal,
      totalsPreserved: true,
      itemCount: customerFit.itemCount,
      message: null,
    };
  }

  return {
    rows: customerRows,
    consolidated: true,
    blocked: true,
    originalOverflow: true,
    originalWeight: originalFit.weight,
    customerWeight: customerFit.weight,
    originalTotal,
    customerTotal,
    totalsPreserved: true,
    itemCount: customerFit.itemCount,
    message: THREE_PAGE_BOQ_STILL_OVERFLOW_MESSAGE,
  };
}
