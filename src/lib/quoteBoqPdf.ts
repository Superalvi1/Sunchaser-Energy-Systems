import { escapeHtml } from "./quotePdfLayout";
import { normalizeRows } from "./normalizeRows";

export const DEFAULT_AUTO_SIZER_BOQ_IDS = [
  "h-1",
  "panel_row",
  "inverter_row",
  "battery_row",
  "s-1",
  "h-2",
  "dc_cable_row",
  "ac_cable_row",
  "earth_wire_row",
  "s-2",
  "h-3",
  "db_box_row",
  "s-3",
  "h-4",
  "supplies_row",
  "s-4",
  "h-5",
  "earthing_bore_row",
  "s-5",
  "h-6",
  "structure_row",
  "structure_l3_row",
  "structure_l2_row",
  "civil_work_row",
  "install_service_row",
  "s-6",
  "h-7",
  "freight_row",
  "net_metering_row",
  "survey_design_row",
  "s-7",
];

export type BoqPdfRow = {
  id?: string;
  type?: "heading" | "item" | "subtotal" | string;
  srNo?: string;
  name?: string;
  description?: string;
  unit?: string;
  qty?: number;
  rate?: number;
  total?: number;
};

/** Preserve builder row order; include section/subtotal rows; filter auto-sizer items when manual-only. */
export function filterBoqRowsForPdf(
  allRows: BoqPdfRow[] | null | undefined | unknown,
  options: { includeSizerItems?: boolean; defaultAutoSizerIds?: string[] } = {}
): BoqPdfRow[] {
  const defaultAutoSizerIds = options.defaultAutoSizerIds ?? DEFAULT_AUTO_SIZER_BOQ_IDS;
  const includeSizerItems = options.includeSizerItems === true;
  const rows = normalizeRows(allRows) as BoqPdfRow[];

  return rows.filter((r) => {
    if (!r?.type) return false;
    if (r.type === "heading" || r.type === "subtotal") return true;
    if (r.type !== "item") return false;
    if (includeSizerItems) return true;
    return !defaultAutoSizerIds.includes(String(r.id || ""));
  });
}

/** Insert or refresh section subtotals so each heading group ends with a subtotal row. */
export function ensureBoqSectionSubtotals(rows: BoqPdfRow[]): BoqPdfRow[] {
  const out: BoqPdfRow[] = [];
  let idx = 0;

  while (idx < rows.length) {
    const row = rows[idx];
    if (row.type !== "heading") {
      out.push(row);
      idx++;
      continue;
    }

    out.push(row);
    const sectionName = String(row.name || "Section").trim();
    idx++;

    const sectionRows: BoqPdfRow[] = [];
    let sectionSum = 0;
    let hasSubtotal = false;

    while (idx < rows.length && rows[idx].type !== "heading") {
      const cur = rows[idx];
      if (cur.type === "subtotal") {
        hasSubtotal = true;
      } else if (cur.type === "item") {
        sectionSum +=
          Number(cur.total) ||
          Math.round(Number(cur.qty || 0) * Number(cur.rate || 0) * 100) / 100;
      }
      sectionRows.push(cur);
      idx++;
    }

    for (const sr of sectionRows) {
      if (sr.type === "subtotal") {
        const rawLabel = String(sr.name || `${sectionName} Subtotal`).trim();
        const label = rawLabel.endsWith(":") ? rawLabel.slice(0, -1).trim() : rawLabel;
        const amount = Number(sr.total) > 0 ? Number(sr.total) : sectionSum;
        out.push({ ...sr, name: label, total: amount });
      } else {
        out.push(sr);
      }
    }

    const itemCount = sectionRows.filter((r) => r.type === "item").length;
    if (!hasSubtotal && itemCount > 0) {
      out.push({
        id: `pdf-sub-${out.length}`,
        type: "subtotal",
        name: `${sectionName} Subtotal`,
        total: sectionSum,
      });
    }
  }

  return out;
}

export const BOQ_FIRST_PAGE_MAX_WEIGHT = 20;
export const BOQ_PAGE_MAX_WEIGHT = 22;

export function boqRowWeight(row: BoqPdfRow): number {
  if (!row?.type) return 0.5;
  if (row.type === "heading") return 1.5;
  if (row.type === "subtotal") return 1;
  if (row.type === "item") {
    const desc = String(row.description || "").trim();
    return desc.length > 80 ? 2 : 1;
  }
  return 0.5;
}

export type BoqPdfPageChunk = {
  rows: BoqPdfRow[];
  isFirst: boolean;
};

/** Deterministic BOQ pagination — row weights, no Playwright measurement. */
export function paginateBoqRowsForPdf(rows: BoqPdfRow[]): BoqPdfPageChunk[] {
  const normalized = ensureBoqSectionSubtotals(rows);
  if (!normalized.length) return [{ rows: [], isFirst: true }];

  const chunks: BoqPdfPageChunk[] = [];
  let current: BoqPdfRow[] = [];
  let weight = 0;
  let isFirst = true;

  const pageMax = () => (isFirst ? BOQ_FIRST_PAGE_MAX_WEIGHT : BOQ_PAGE_MAX_WEIGHT);

  const flush = () => {
    if (!current.length) return;
    chunks.push({ rows: current, isFirst });
    current = [];
    weight = 0;
    isFirst = false;
  };

  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    const w = boqRowWeight(row);

    if (weight + w > pageMax() && current.length > 0) {
      if (row.type === "subtotal") {
        const last = current[current.length - 1];
        if (last?.type === "item") {
          const moved = current.pop()!;
          weight -= boqRowWeight(moved);
          flush();
          current.push(moved);
          weight += boqRowWeight(moved);
        } else {
          flush();
        }
      } else if (row.type === "heading") {
        flush();
      } else {
        flush();
      }
    }

    current.push(row);
    weight += w;
  }

  flush();
  return chunks.length ? chunks : [{ rows: [], isFirst: true }];
}

export function renderBoqTableHeadHtml(): string {
  return `
                  <thead>
                    <tr style="height: 28px;">
                      <th style="width: 5%; text-align: center; border-bottom: 2px solid #0f172a;">Sr.</th>
                      <th style="width: 25%; border-bottom: 2px solid #0f172a;">Item Name</th>
                      <th style="width: 32%; border-bottom: 2px solid #0f172a;">Material Specifications</th>
                      <th style="width: 7%; text-align: center; border-bottom: 2px solid #0f172a;">Unit</th>
                      <th style="width: 7%; text-align: center; border-bottom: 2px solid #0f172a;">Qty</th>
                      <th style="width: 12%; text-align: right; border-bottom: 2px solid #0f172a;">Rate</th>
                      <th style="width: 12%; text-align: right; border-bottom: 2px solid #0f172a;">Total</th>
                    </tr>
                  </thead>`;
}

export function buildBoqTotalsHtml(options: {
  formatPKR: (val: number) => string;
  grossTotal: number;
  netTotal: number;
  discountAmount: number;
  discountLabel: string;
  taxEnabled: boolean;
  taxRate: number;
  taxAmount: number;
  societyCharges: number;
  customNotes?: string;
  strictTemplateOnly?: boolean;
}): string {
  const {
    formatPKR,
    grossTotal,
    netTotal,
    discountAmount,
    discountLabel,
    taxEnabled,
    taxRate,
    taxAmount,
    societyCharges,
    customNotes,
    strictTemplateOnly,
  } = options;

  return `
              <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="width: 48%; font-size: 9.5px; color: #64748b; line-height: 1.45;">
                  ${customNotes ? `
                    <div style="background-color: #fdf4ff; border: 1px solid #f3e8ff; border-radius: 6px; padding: 6px 10px; color: #6b21a8; font-weight: 500;">
                      <strong>Special Execution Notes:</strong><br/>
                      ${customNotes}
                    </div>
                  ` : strictTemplateOnly ? "" : "Note: Complete hardware clearances are direct clearance imported. Local mounts are AL ADAM galvanized Mughal steel."}
                </div>
                <div style="width: 46%;">
                  <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                    <span style="color: #64748b; font-weight: 500;">Subtotal:</span>
                    <span style="font-weight: 600; color: #0f172a;">${formatPKR(grossTotal)}</span>
                  </div>
                  ${discountAmount > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">${escapeHtml(discountLabel)}:</span>
                      <span style="font-weight: 600; color: #dc2626;">-${formatPKR(discountAmount)}</span>
                    </div>
                  ` : ""}
                  ${taxEnabled ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Sales Tax (${taxRate}%):</span>
                      <span style="font-weight: 600; color: #dc2626;">+${formatPKR(taxAmount)}</span>
                    </div>
                  ` : ""}
                  ${societyCharges > 0 ? `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                      <span style="color: #64748b; font-weight: 500;">Society Approval / Dues:</span>
                      <span style="font-weight: 600; color: #0f172a;">+${formatPKR(societyCharges)}</span>
                    </div>
                  ` : ""}
                  <div style="display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 850; border-top: 1.5px solid #0f172a; padding-top: 4px; margin-top: 4px;">
                    <span style="color: #0f172a;">Final Price:</span>
                    <span style="color: #d97706; font-size: 13.5px;">${formatPKR(netTotal)}</span>
                  </div>
                </div>
              </div>`;
}

export function renderBoqTableBodyHtml(
  rows: BoqPdfRow[],
  formatPKR: (val: number) => string
): { html: string; calculatedGross: number } {
  const normalized = ensureBoqSectionSubtotals(rows);
  let boqHtml = "";
  let calculatedGross = 0;
  let itemSr = 0;

  for (const r of normalized) {
    if (r.type === "heading") {
      const label = String(r.name || r.description || "Section").trim().toUpperCase();
      if (!label) continue;
      boqHtml += `
              <tr class="boq-section-header">
                <td colspan="7">${escapeHtml(label)}</td>
              </tr>
            `;
      continue;
    }

    if (r.type === "subtotal") {
      const label = String(r.name || "Subtotal").trim();
      boqHtml += `
              <tr class="boq-section-subtotal">
                <td colspan="6">${escapeHtml(label)}:</td>
                <td>${formatPKR(Number(r.total || 0))}</td>
              </tr>
            `;
      continue;
    }

    if (r.type !== "item") continue;

    itemSr += 1;
    calculatedGross += Number(r.total) || 0;
    const srDisplay = r.srNo || String(itemSr);
    boqHtml += `
              <tr class="boq-item-row">
                <td style="text-align: center; color: #64748b;">${escapeHtml(srDisplay)}</td>
                <td style="font-weight: 600; color: #0f172a;">${escapeHtml(r.name || "")}</td>
                <td style="color: #475569; font-size: 9px; line-height: 1.3;">${escapeHtml(r.description || "")}</td>
                <td style="text-align: center; color: #475569;">${escapeHtml(r.unit || "Nos")}</td>
                <td style="text-align: center; font-weight: 500;">${r.qty ?? ""}</td>
                <td style="text-align: right; color: #475569;">${formatPKR(Number(r.rate || 0))}</td>
                <td style="text-align: right; font-weight: 600; color: #0f172a;">${formatPKR(Number(r.total || 0))}</td>
              </tr>
            `;
  }

  return { html: boqHtml, calculatedGross };
}

export function boqPdfSectionCss(): string {
  return `
        .boq-section-header td {
          background-color: #0f172a;
          color: #ffffff;
          font-weight: 800;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 8px 10px;
          border-top: 2px solid #1e3a8a;
          border-bottom: 2px solid #1e3a8a;
          text-align: center;
        }
        .boq-section-subtotal td {
          border-top: 1px solid #cbd5e1;
          border-bottom: 2px solid #94a3b8;
          font-weight: 700;
          background-color: #f1f5f9;
          font-size: 10px;
          padding: 7px 8px;
        }
        .boq-section-subtotal td:first-child {
          text-align: right;
          color: #0f172a;
          font-style: normal;
        }
        .boq-section-subtotal td:last-child {
          text-align: right;
          color: #0f172a;
          font-weight: 800;
        }
        .boq-item-row td {
          border-bottom: 1px solid #cbd5e1;
          font-size: 9.5px;
          padding: 5px 8px;
        }
  `;
}
