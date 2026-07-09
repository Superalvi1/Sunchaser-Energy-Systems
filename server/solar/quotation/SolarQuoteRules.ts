/**
 * Deterministic solar quotation planning rules — Pakistan residential/commercial defaults.
 */

import type { SolarSystemType } from "./SolarQuoteModels.ts";

export const MIN_SYSTEM_SIZE_KW = 1;
export const MAX_SYSTEM_SIZE_KW = 50;
export const DEFAULT_PANEL_WATTAGE = 580;
export const GENERATION_PER_KW_MONTH = 120;
export const DEFAULT_TARIFF_PKR_PER_KWH = 42;

export const PANEL_BRAND_BY_TIER = {
  standard: "Jinko",
  large: "Canadian Solar",
} as const;

export const INVERTER_BRANDS = {
  onGridSmall: "Solis",
  onGridMid: "Knox",
  onGridLarge: "Goodwe",
  hybrid: "Knox",
  offGrid: "Goodwe",
} as const;

export interface InverterPick {
  brand: string;
  capacityLabel: string;
}

export function pickPanelBrand(systemSizeKw: number): string {
  return systemSizeKw >= 15 ? PANEL_BRAND_BY_TIER.large : PANEL_BRAND_BY_TIER.standard;
}

export function pickInverter(systemSizeKw: number, systemType: SolarSystemType): InverterPick {
  const capacityLabel = `${Math.ceil(systemSizeKw)}kW`;
  if (systemType === "off-grid") {
    return { brand: INVERTER_BRANDS.offGrid, capacityLabel };
  }
  if (systemType === "hybrid") {
    return { brand: INVERTER_BRANDS.hybrid, capacityLabel };
  }
  if (systemSizeKw >= 20) return { brand: INVERTER_BRANDS.onGridLarge, capacityLabel };
  if (systemSizeKw >= 6) return { brand: INVERTER_BRANDS.onGridMid, capacityLabel };
  return { brand: INVERTER_BRANDS.onGridSmall, capacityLabel };
}

export function pickBattery(
  systemSizeKw: number,
  systemType: SolarSystemType,
  backupRequirement?: string
): string | null {
  if (systemType === "on-grid") {
    const backup = normalizeBackupRequirement(backupRequirement);
    if (backup === "none") return null;
    if (systemSizeKw <= 6) return "Lithium battery pack 5.12 kWh";
    return "Lithium battery pack 10.24 kWh";
  }
  if (systemType === "hybrid") {
    if (systemSizeKw <= 6) return "Lithium battery pack 5.12 kWh";
    if (systemSizeKw <= 12) return "Lithium battery pack 10.24 kWh";
    return "Lithium battery pack 15.0 kWh";
  }
  if (systemSizeKw <= 8) return "Lithium battery pack 10.24 kWh";
  return "Lithium battery pack 15.0 kWh";
}

export function normalizeBackupRequirement(raw?: string): "none" | "partial" | "full" | "unspecified" {
  const token = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!token) return "unspecified";
  if (/none|no backup|grid only|on.?grid/i.test(token)) return "none";
  if (/full|complete|whole home|100/i.test(token)) return "full";
  if (/partial|essential|critical|lights|fans/i.test(token)) return "partial";
  return "unspecified";
}

export function estimatePanelCount(systemSizeKw: number, panelWattage = DEFAULT_PANEL_WATTAGE): number {
  if (systemSizeKw <= 0 || panelWattage <= 0) return 0;
  return Math.ceil((systemSizeKw * 1000) / panelWattage);
}

export function indicativePanelRate(brand: string): number {
  if (brand === "Canadian Solar") return 23000;
  if (brand === "Longi") return 25200;
  if (brand === "JA Solar") return 19500;
  return 21000;
}

export function indicativeInverterRate(systemSizeKw: number, systemType: SolarSystemType): number {
  if (systemType === "off-grid") return 520000;
  if (systemSizeKw >= 20) return 420000;
  if (systemSizeKw >= 10) return 400000;
  if (systemSizeKw >= 6) return 320000;
  return 280000;
}

export function indicativeBatteryRate(label: string | null): number {
  if (!label) return 0;
  if (label.includes("15.0")) return 690000;
  if (label.includes("10.24")) return 480000;
  return 235000;
}

export function structureProtectionNotes(systemSizeKw: number, systemType: SolarSystemType): string[] {
  const notes = [
    "Galvanized elevated or standard rooftop structure per site survey",
    "Lightning arrestor and earthing per IEC practice",
    "DC surge protection and AC breaker protection included in scope",
  ];
  if (systemSizeKw >= 15) {
    notes.push("Engineered structure review recommended for large array loading");
  }
  if (systemType === "off-grid") {
    notes.push("Off-grid designs require dedicated load assessment and genset fallback planning");
  }
  return notes;
}

export function safeLocationLabel(raw?: string): string {
  const token = String(raw ?? "").trim();
  if (!token) return "Standard installation region";
  if (/phone|cnic|@|\d{5,}|street|road|house|plot|iban|bank|account/i.test(token)) {
    return "Specified installation region";
  }
  if (token.length > 48) return "Specified installation region";
  return token;
}

export function safeBackupLabel(raw?: string): string {
  const normalized = normalizeBackupRequirement(raw);
  switch (normalized) {
    case "none":
      return "No backup required";
    case "partial":
      return "Partial backup (essential loads)";
    case "full":
      return "Full home backup";
    default:
      return "Backup requirement to be confirmed";
  }
}
