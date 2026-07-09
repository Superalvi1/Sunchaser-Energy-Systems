/**
 * DB boxes, breakers, and protection device quantities.
 */

import { dbBoxRates } from "./SolarProductCatalog.ts";
import type { EquipmentTier, SupportedSystemSizeKw, SystemType } from "./SolarProposalModels.ts";
import { round2 } from "./SolarProposalModels.ts";

export interface ProtectionLine {
  id: string;
  name: string;
  brand: string;
  unit: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  lineTotalCost: number;
  lineTotalPrice: number;
}

export interface ProtectionCalculation {
  lines: ProtectionLine[];
  subtotalCost: number;
  subtotalPrice: number;
}

function mcbCount(sizeKw: SupportedSystemSizeKw): number {
  if (sizeKw <= 5) return 2;
  if (sizeKw <= 10) return 3;
  return 4;
}

export function calculateProtection(
  sizeKw: SupportedSystemSizeKw,
  systemType: SystemType,
  tier: EquipmentTier
): ProtectionCalculation {
  const db = dbBoxRates(tier);
  const lines: ProtectionLine[] = [
    {
      id: "ac_db_box",
      name: "AC Distribution Box (IP65)",
      brand: "Hager / Schneider",
      unit: "Nos",
      quantity: 1,
      unitCost: db.cost,
      unitPrice: db.price,
      lineTotalCost: db.cost,
      lineTotalPrice: db.price,
    },
    {
      id: "dc_spd",
      name: "DC Surge Protection Device",
      brand: "Phoenix Contact",
      unit: "Nos",
      quantity: 1,
      unitCost: tier === "premium" ? 18000 : 14000,
      unitPrice: tier === "premium" ? 20000 : 16000,
      lineTotalCost: tier === "premium" ? 18000 : 14000,
      lineTotalPrice: tier === "premium" ? 20000 : 16000,
    },
    {
      id: "ac_spd",
      name: "AC Surge Protection Device",
      brand: "Phoenix Contact",
      unit: "Nos",
      quantity: 1,
      unitCost: tier === "premium" ? 15000 : 12000,
      unitPrice: tier === "premium" ? 17000 : 14000,
      lineTotalCost: tier === "premium" ? 15000 : 12000,
      lineTotalPrice: tier === "premium" ? 17000 : 14000,
    },
    {
      id: "mcb_set",
      name: "MCB Breaker Set",
      brand: "Schneider",
      unit: "Nos",
      quantity: mcbCount(sizeKw),
      unitCost: tier === "premium" ? 4200 : 3500,
      unitPrice: tier === "premium" ? 4800 : 4000,
      lineTotalCost: mcbCount(sizeKw) * (tier === "premium" ? 4200 : 3500),
      lineTotalPrice: mcbCount(sizeKw) * (tier === "premium" ? 4800 : 4000),
    },
  ];

  if (systemType === "hybrid" || systemType === "off-grid") {
    lines.push({
      id: "battery_fuse",
      name: "Battery DC Fuse Assembly",
      brand: "Littelfuse",
      unit: "Nos",
      quantity: 1,
      unitCost: tier === "premium" ? 9000 : 7000,
      unitPrice: tier === "premium" ? 10000 : 8000,
      lineTotalCost: tier === "premium" ? 9000 : 7000,
      lineTotalPrice: tier === "premium" ? 10000 : 8000,
    });
  }

  const subtotalCost = round2(lines.reduce((s, l) => s + l.lineTotalCost, 0));
  const subtotalPrice = round2(lines.reduce((s, l) => s + l.lineTotalPrice, 0));
  return { lines, subtotalCost, subtotalPrice };
}
