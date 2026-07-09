/**
 * Sunchaser solar product catalog — deterministic SKU rates for proposal engine.
 */

import type { EquipmentTier, SystemType, SupportedSystemSizeKw } from "./SolarProposalModels.ts";

export interface CatalogProduct {
  id: string;
  name: string;
  brand: string;
  unit: string;
  unitCostBudget: number;
  unitPriceBudget: number;
  unitCostPremium: number;
  unitPricePremium: number;
}

export interface EquipmentBundle {
  panelBrand: string;
  panelWattage: number;
  panelUnitCost: number;
  panelUnitPrice: number;
  inverterBrand: string;
  inverterCapacity: string;
  inverterUnitCost: number;
  inverterUnitPrice: number;
  batteryLabel: string | null;
  batteryUnitCost: number;
  batteryUnitPrice: number;
}

const PANEL_RATES: Record<EquipmentTier, Record<string, { cost: number; price: number }>> = {
  budget: {
    Jinko: { cost: 19500, price: 21000 },
    "JA Solar": { cost: 18000, price: 19500 },
    "Canadian Solar": { cost: 21000, price: 23000 },
  },
  premium: {
    Jinko: { cost: 22800, price: 24500 },
    Longi: { cost: 25200, price: 27500 },
    "Canadian Solar": { cost: 24000, price: 26500 },
  },
};

function panelBrandFor(sizeKw: SupportedSystemSizeKw, tier: EquipmentTier): string {
  if (sizeKw >= 15) return tier === "premium" ? "Canadian Solar" : "JA Solar";
  if (sizeKw >= 10) return "Canadian Solar";
  return tier === "premium" ? "Longi" : "Jinko";
}

function inverterPick(sizeKw: SupportedSystemSizeKw, systemType: SystemType, tier: EquipmentTier) {
  if (systemType === "off-grid") {
    return { brand: "Goodwe", capacity: `${sizeKw}kW`, cost: tier === "premium" ? 480000 : 420000, price: tier === "premium" ? 520000 : 450000 };
  }
  if (systemType === "hybrid") {
    return { brand: tier === "premium" ? "Goodwe" : "Knox", capacity: `${sizeKw}kW`, cost: tier === "premium" ? 420000 : 360000, price: tier === "premium" ? 480000 : 400000 };
  }
  if (sizeKw <= 4) return { brand: "Solis", capacity: `${sizeKw}kW`, cost: 260000, price: 300000 };
  if (sizeKw <= 8) return { brand: "Knox", capacity: `${sizeKw}kW`, cost: 340000, price: 400000 };
  return { brand: "Goodwe", capacity: `${sizeKw}kW`, cost: tier === "premium" ? 460000 : 400000, price: tier === "premium" ? 520000 : 440000 };
}

function batteryPick(sizeKw: SupportedSystemSizeKw, systemType: SystemType, tier: EquipmentTier): { label: string | null; cost: number; price: number } {
  if (systemType === "on-grid") return { label: null, cost: 0, price: 0 };
  if (sizeKw <= 6) {
    return {
      label: "Lithium Battery Pack 5.12kWh",
      cost: tier === "premium" ? 260000 : 220000,
      price: tier === "premium" ? 280000 : 235000,
    };
  }
  if (sizeKw <= 12) {
    return {
      label: "Lithium Battery Pack 10.24kWh",
      cost: tier === "premium" ? 500000 : 450000,
      price: tier === "premium" ? 540000 : 480000,
    };
  }
  return {
    label: "Lithium Battery Pack 15.0kWh",
    cost: tier === "premium" ? 720000 : 650000,
    price: tier === "premium" ? 780000 : 690000,
  };
}

export function resolveEquipmentBundle(
  sizeKw: SupportedSystemSizeKw,
  tier: EquipmentTier,
  systemType: SystemType
): EquipmentBundle {
  const panelBrand = panelBrandFor(sizeKw, tier);
  const panelRates = PANEL_RATES[tier][panelBrand] ?? PANEL_RATES[tier].Jinko;
  const inverter = inverterPick(sizeKw, systemType, tier);
  const battery = batteryPick(sizeKw, systemType, tier);
  return {
    panelBrand,
    panelWattage: 580,
    panelUnitCost: panelRates.cost,
    panelUnitPrice: panelRates.price,
    inverterBrand: inverter.brand,
    inverterCapacity: inverter.capacity,
    inverterUnitCost: inverter.cost,
    inverterUnitPrice: inverter.price,
    batteryLabel: battery.label,
    batteryUnitCost: battery.cost,
    batteryUnitPrice: battery.price,
  };
}

export const CABLE_ROLL_PRICE = 20000;
export const CABLE_ROLL_LENGTH_M = 100;
export const DC_CABLE_PER_METER_COST = 240;
export const DC_CABLE_PER_METER_PRICE = 280;
export const AC_CABLE_PER_METER_COST = 220;
export const AC_CABLE_PER_METER_PRICE = 250;
export const EARTH_WIRE_PER_METER_COST = 360;
export const EARTH_WIRE_PER_METER_PRICE = 420;

export function dbBoxRates(tier: EquipmentTier): { cost: number; price: number } {
  return tier === "premium" ? { cost: 38000, price: 42000 } : { cost: 28000, price: 32000 };
}

export function suppliesJobRates(tier: EquipmentTier): { cost: number; price: number } {
  return tier === "premium" ? { cost: 21000, price: 24000 } : { cost: 16000, price: 18000 };
}

export function earthingBoreRates(tier: EquipmentTier): { cost: number; price: number } {
  return tier === "premium" ? { cost: 48000, price: 52000 } : { cost: 44000, price: 48000 };
}

export function installationRates(sizeKw: SupportedSystemSizeKw, tier: EquipmentTier): { cost: number; price: number } {
  const base = 35000 + sizeKw * 3200;
  const premiumAdj = tier === "premium" ? 8000 : 0;
  return { cost: base, price: base + premiumAdj };
}

export function netMeteringRates(sizeKw: SupportedSystemSizeKw): { cost: number; price: number } {
  if (sizeKw <= 3) return { cost: 0, price: 0 };
  return sizeKw >= 15 ? { cost: 90000, price: 95000 } : { cost: 85000, price: 90000 };
}

export function freightRates(tier: EquipmentTier): { cost: number; price: number } {
  return tier === "premium" ? { cost: 12000, price: 14000 } : { cost: 9000, price: 10000 };
}

export function surveyDesignRates(tier: EquipmentTier): { cost: number; price: number } {
  return tier === "premium" ? { cost: 7000, price: 8000 } : { cost: 4500, price: 5000 };
}
