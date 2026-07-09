/**
 * Client adapter for deterministic solar quote planner — draft only, no CRM writes.
 */

import { planSolarQuote, assertSolarQuoteDraftSafe } from "../../server/solar/quotation/SolarQuotePlanner.ts";
import type {
  SolarQuoteDraft,
  SolarQuotePlannerInput,
  SolarSystemType,
} from "../../server/solar/quotation/SolarQuoteModels.ts";
import type { BoqRow } from "../types";

export type { SolarQuoteDraft, SolarQuotePlannerInput, SolarSystemType };
export { planSolarQuote, assertSolarQuoteDraftSafe };

export function mapSystemTypeToForm(systemType: SolarSystemType): "On-grid" | "Hybrid" | "Off-grid" {
  switch (systemType) {
    case "on-grid":
      return "On-grid";
    case "off-grid":
      return "Off-grid";
    default:
      return "Hybrid";
  }
}

export function mapFormSystemType(raw: string): SolarSystemType {
  const token = raw.trim().toLowerCase();
  if (token === "on-grid" || token === "ongrid") return "on-grid";
  if (token === "off-grid" || token === "offgrid") return "off-grid";
  return "hybrid";
}

/** Map planner BOQ draft lines into editable BOQ rows — still draft until user saves manually. */
export function mapSolarDraftToBoqRows(draft: SolarQuoteDraft): BoqRow[] {
  if (!draft.valid || draft.boqDraft.length === 0) return [];

  const rows: BoqRow[] = [];
  let sr = 1;
  let currentCategory = "";

  for (const line of draft.boqDraft) {
    if (line.category !== currentCategory) {
      currentCategory = line.category;
      rows.push({
        id: `ai-h-${rows.length}`,
        type: "heading",
        name: currentCategory,
        description: "AI Quote Builder draft section",
        brand: "",
        unit: "",
        qty: 0,
        rate: 0,
        total: 0,
      });
    }

    rows.push({
      id: `ai-${line.id}`,
      type: "item",
      srNo: String(sr),
      name: line.name,
      description: line.description,
      brand: "",
      unit: line.unit,
      qty: line.quantity,
      rate: line.indicativeRate,
      total: line.quantity * line.indicativeRate,
    });
    sr += 1;
  }

  rows.push({
    id: "ai-subtotal",
    type: "subtotal",
    name: "AI draft indicative subtotal",
    description: "Review rates before saving quotation",
    brand: "",
    unit: "",
    qty: 0,
    rate: 0,
    total: rows
      .filter((r) => r.type === "item")
      .reduce((sum, r) => sum + (Number(r.total) || 0), 0),
  });

  return rows;
}

export interface SolarQuoteDraftFormApply {
  systemSizekW: number;
  systemType: "On-grid" | "Hybrid" | "Off-grid";
  panelBrand: string;
  panelWattage: number;
  inverterBrand: string;
  inverterCapacity: string;
  batteryOption: string;
  boqRows: BoqRow[];
}

export function buildDraftApplyPayload(draft: SolarQuoteDraft): SolarQuoteDraftFormApply | null {
  if (!draft.valid) return null;

  const inverterParts = draft.inverterSuggestion.split(" ");
  const inverterBrand = inverterParts[0] || "Knox";
  const inverterCapacity = inverterParts[1] || `${draft.systemSizeKw}kW`;

  return {
    systemSizekW: draft.systemSizeKw,
    systemType: mapSystemTypeToForm(draft.systemType),
    panelBrand: draft.panelBrandSuggestion,
    panelWattage: draft.panelWattage,
    inverterBrand,
    inverterCapacity,
    batteryOption: draft.batterySuggestion ?? "None",
    boqRows: mapSolarDraftToBoqRows(draft),
  };
}
