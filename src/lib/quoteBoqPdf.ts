import { escapeHtml } from "./quotePdfLayout";

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
  allRows: BoqPdfRow[] | null | undefined,
  options: { includeSizerItems?: boolean; defaultAutoSizerIds?: string[] } = {}
): BoqPdfRow[] {
  const defaultAutoSizerIds = options.defaultAutoSizerIds ?? DEFAULT_AUTO_SIZER_BOQ_IDS;
  const includeSizerItems = options.includeSizerItems === true;

  return (allRows || []).filter((r) => {
    if (!r?.type) return false;
    if (r.type === "heading" || r.type === "subtotal") return true;
    if (r.type !== "item") return false;
    if (includeSizerItems) return true;
    return !defaultAutoSizerIds.includes(String(r.id || ""));
  });
}

export function renderBoqTableBodyHtml(
  rows: BoqPdfRow[],
  formatPKR: (val: number) => string
): { html: string; calculatedGross: number } {
  let boqHtml = "";
  let calculatedGross = 0;
  let itemSr = 0;

  for (const r of rows) {
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
      boqHtml += `
              <tr class="boq-section-subtotal">
                <td colspan="6">${escapeHtml(r.name || "SUBTOTAL")}:</td>
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
          border-bottom: 1.5px solid #cbd5e1;
          font-weight: 700;
          background-color: #f8fafc;
          font-size: 9.5px;
          padding: 5px 8px;
        }
        .boq-section-subtotal td:first-child {
          text-align: right;
          color: #475569;
          text-transform: uppercase;
        }
        .boq-section-subtotal td:last-child {
          text-align: right;
          color: #0f172a;
        }
        .boq-item-row td {
          border-bottom: 1px solid #cbd5e1;
          font-size: 9.5px;
          padding: 5px 8px;
        }
  `;
}
