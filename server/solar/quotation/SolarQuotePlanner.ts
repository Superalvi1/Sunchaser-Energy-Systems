/**
 * Deterministic solar quotation draft planner — no LLM, no CRM mutation, draft only.
 */

import type {
  SolarBoqDraftLine,
  SolarQuoteDraft,
  SolarQuotePlannerInput,
  SolarSystemType,
} from "./SolarQuoteModels.ts";
import {
  DEFAULT_PANEL_WATTAGE,
  DEFAULT_TARIFF_PKR_PER_KWH,
  GENERATION_PER_KW_MONTH,
  MAX_SYSTEM_SIZE_KW,
  MIN_SYSTEM_SIZE_KW,
  estimatePanelCount,
  indicativeBatteryRate,
  indicativeInverterRate,
  indicativePanelRate,
  pickBattery,
  pickInverter,
  pickPanelBrand,
  safeBackupLabel,
  safeLocationLabel,
  structureProtectionNotes,
} from "./SolarQuoteRules.ts";

function normalizeSystemType(raw: string | undefined): SolarSystemType {
  const token = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (token === "hybrid") return "hybrid";
  if (token === "off-grid" || token === "offgrid") return "off-grid";
  return "on-grid";
}

function validateInput(input: SolarQuotePlannerInput): string[] {
  const errors: string[] = [];
  const kw = Number(input.systemSizeKw);
  if (!Number.isFinite(kw)) {
    errors.push("System size must be a valid number.");
  } else if (kw < MIN_SYSTEM_SIZE_KW || kw > MAX_SYSTEM_SIZE_KW) {
    errors.push(`System size must be between ${MIN_SYSTEM_SIZE_KW} kW and ${MAX_SYSTEM_SIZE_KW} kW.`);
  }
  return errors;
}

function billBasedSizeHint(monthlyBill?: number): number | null {
  const bill = Number(monthlyBill);
  if (!Number.isFinite(bill) || bill <= 0) return null;
  const units = Math.round(bill / DEFAULT_TARIFF_PKR_PER_KWH);
  if (units <= 0) return null;
  return Math.round((units / GENERATION_PER_KW_MONTH) * 10) / 10;
}

function buildBoqDraft(
  systemSizeKw: number,
  systemType: SolarSystemType,
  panelBrand: string,
  panelWattage: number,
  panelCount: number,
  inverter: { brand: string; capacityLabel: string },
  battery: string | null
): SolarBoqDraftLine[] {
  const lines: SolarBoqDraftLine[] = [];

  lines.push({
    id: "boq-panels",
    category: "Imported Equipment",
    name: `${panelBrand} ${panelWattage}W mono-PERC solar panels`,
    description: "Tier-1 high efficiency modules (indicative draft pricing)",
    unit: "Pcs",
    quantity: panelCount,
    indicativeRate: indicativePanelRate(panelBrand),
  });

  lines.push({
    id: "boq-inverter",
    category: "Imported Equipment",
    name: `${inverter.brand} ${inverter.capacityLabel} inverter`,
    description:
      systemType === "hybrid" || systemType === "off-grid"
        ? "Hybrid inverter with battery interface"
        : "Grid-tied solar inverter",
    unit: "Pcs",
    quantity: 1,
    indicativeRate: indicativeInverterRate(systemSizeKw, systemType),
  });

  if (battery) {
    lines.push({
      id: "boq-battery",
      category: "Imported Equipment",
      name: battery,
      description: "LiFePO4 storage (indicative draft pricing)",
      unit: "Set",
      quantity: 1,
      indicativeRate: indicativeBatteryRate(battery),
    });
  }

  const dcCableMeters = Math.round(systemSizeKw * 15 + 40);
  lines.push({
    id: "boq-dc-cable",
    category: "Cables & Protection",
    name: "DC solar cable 6 mm",
    description: "Double-insulated DC cabling",
    unit: "Meter",
    quantity: dcCableMeters,
    indicativeRate: 280,
  });

  lines.push({
    id: "boq-structure",
    category: "Structure & Installation",
    name: "Rooftop mounting structure",
    description: "Galvanized structure, clamps, and labour allowance",
    unit: "Lot",
    quantity: 1,
    indicativeRate: 40000 + systemSizeKw * 3500,
  });

  lines.push({
    id: "boq-protection",
    category: "Cables & Protection",
    name: "Earthing and surge protection kit",
    description: "SPD, earthing, and protection accessories",
    unit: "Lot",
    quantity: 1,
    indicativeRate: 18000 + Math.round(systemSizeKw * 800),
  });

  if (systemType !== "off-grid" && systemSizeKw > 3) {
    lines.push({
      id: "boq-net-metering",
      category: "Net Metering",
      name: "Net metering application support",
      description: "DISCO application documentation and liaison (indicative)",
      unit: "Lot",
      quantity: 1,
      indicativeRate: systemSizeKw >= 20 ? 90000 : 75000,
    });
  }

  return lines;
}

function buildAssumptions(
  systemSizeKw: number,
  systemType: SolarSystemType,
  locationLabel: string,
  billHint: number | null
): string[] {
  const assumptions = [
    `Draft based on ${systemSizeKw} kW ${systemType} system for ${locationLabel}`,
    `Panel sizing uses ${DEFAULT_PANEL_WATTAGE}W modules and standard roof layout`,
    `Generation estimate uses ${GENERATION_PER_KW_MONTH} kWh per kW per month (conservative Lahore baseline)`,
    "Indicative BOQ rates are planning estimates — final BOQ requires site survey",
    "Draft only — not saved to CRM and not a binding quotation",
  ];
  if (billHint && billHint > 0) {
    assumptions.push(`Monthly bill suggests approximately ${billHint} kW as a reference sizing anchor`);
  }
  return assumptions;
}

function buildWarnings(
  systemSizeKw: number,
  systemType: SolarSystemType,
  billHint: number | null,
  inputKw: number
): string[] {
  const warnings: string[] = [];
  if (systemType === "off-grid") {
    warnings.push("Off-grid systems require detailed load inventory and backup planning before final quote.");
  }
  if (systemType === "hybrid") {
    warnings.push("Hybrid battery sizing should be validated against backup load list and night consumption.");
  }
  if (billHint && Math.abs(billHint - inputKw) / Math.max(inputKw, 1) > 0.35) {
    warnings.push("Entered system size differs significantly from bill-based sizing — confirm with customer load profile.");
  }
  if (systemSizeKw >= 20) {
    warnings.push("Systems above 20 kW may require three-phase service and DISCO technical review.");
  }
  return warnings;
}

function buildNextSteps(systemType: SolarSystemType): string[] {
  const steps = [
    "Review draft BOQ and adjust rates in Manual BOQ Builder",
    "Confirm roof structure type and cable routing on site survey",
    "Validate net metering eligibility with local DISCO",
    "Save quotation manually when pricing is finalized",
  ];
  if (systemType === "hybrid" || systemType === "off-grid") {
    steps.splice(1, 0, "Confirm backup load list and battery autonomy requirements");
  }
  return steps;
}

export function planSolarQuote(input: SolarQuotePlannerInput): SolarQuoteDraft {
  const errors = validateInput(input);
  const systemType = normalizeSystemType(input.systemType);
  const systemSizeKw = Math.round(Number(input.systemSizeKw) * 10) / 10;
  const locationLabel = safeLocationLabel(input.location);
  const backupLabel = safeBackupLabel(input.backupRequirement);
  const billHint = billBasedSizeHint(input.monthlyBill);

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      draftOnly: true,
      recommendedSystemSummary: "",
      systemSizeKw,
      systemType,
      panelCountEstimate: 0,
      panelWattage: DEFAULT_PANEL_WATTAGE,
      panelBrandSuggestion: "",
      inverterSuggestion: "",
      batterySuggestion: null,
      structureProtectionNotes: [],
      boqDraft: [],
      assumptions: [],
      warnings: [],
      nextSteps: ["Correct input errors and regenerate the draft."],
      locationLabel,
      backupLabel,
    };
  }

  const panelBrand = pickPanelBrand(systemSizeKw);
  const panelWattage = DEFAULT_PANEL_WATTAGE;
  const panelCount = estimatePanelCount(systemSizeKw, panelWattage);
  const inverter = pickInverter(systemSizeKw, systemType);
  const battery = pickBattery(systemSizeKw, systemType, input.backupRequirement);
  const inverterSuggestion = `${inverter.brand} ${inverter.capacityLabel} ${systemType === "on-grid" ? "on-grid" : "hybrid"} inverter`;
  const monthlyGen = Math.round(systemSizeKw * GENERATION_PER_KW_MONTH);

  const recommendedSystemSummary = [
    `${systemSizeKw} kW ${systemType} solar system`,
    `${panelCount} × ${panelWattage}W ${panelBrand} panels`,
    `Estimated ${monthlyGen} kWh/month generation`,
    battery ? `Battery: ${battery}` : "No battery in base on-grid draft",
  ].join(" · ");

  return {
    valid: true,
    errors: [],
    draftOnly: true,
    recommendedSystemSummary,
    systemSizeKw,
    systemType,
    panelCountEstimate: panelCount,
    panelWattage,
    panelBrandSuggestion: panelBrand,
    inverterSuggestion,
    batterySuggestion: battery,
    structureProtectionNotes: structureProtectionNotes(systemSizeKw, systemType),
    boqDraft: buildBoqDraft(systemSizeKw, systemType, panelBrand, panelWattage, panelCount, inverter, battery),
    assumptions: buildAssumptions(systemSizeKw, systemType, locationLabel, billHint),
    warnings: buildWarnings(systemSizeKw, systemType, billHint, systemSizeKw),
    nextSteps: buildNextSteps(systemType),
    locationLabel,
    backupLabel,
  };
}

/** Assert draft JSON never echoes customer PII from input. */
export function assertSolarQuoteDraftSafe(
  draft: SolarQuoteDraft,
  forbiddenNeedles: string[] = []
): boolean {
  const blob = JSON.stringify(draft);
  const patterns = [/cnic/i, /\biban\b/i, /bank\s*account/i, /\b03\d{9}\b/];
  if (patterns.some((re) => re.test(blob))) return false;
  return forbiddenNeedles.every((needle) => !blob.includes(needle));
}
