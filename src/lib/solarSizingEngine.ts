export interface SizingInput {
  monthlyBill: number;
  monthlyUnits?: number;
  location: string;
  loadSheddingHours: string; // "None" | "1-2" | "3-5" | "6+"
  roofType: string;
  shading: string;
}

export interface SizingRecommendation {
  systemSizekW: number;
  panelsCount: number;
  inverterType: string;
  batteryCount: number;
  batteryCapacitykWh: number;
  upfrontCost: number;
  taxCredit: number;
  netInvestment: number;
  yearlySavings: number;
  paybackYears: number;
  isPakistan: boolean;
  currency: string;
}

export function calculateSizingRecommendations(input: SizingInput): SizingRecommendation {
  const loc = (input.location || "").toLowerCase();
  const isPakistan =
    loc.includes("pakistan") ||
    loc.includes("karachi") ||
    loc.includes("lahore") ||
    loc.includes("islamabad") ||
    loc.includes("multan") ||
    loc.includes("peshawar") ||
    loc.includes("rawalpindi") ||
    loc.includes("pk");

  const currency = isPakistan ? "Rs." : "$";
  const ratePerUnit = isPakistan ? 50 : 0.25;

  let monthlyUnits = input.monthlyUnits || 0;
  if (monthlyUnits <= 0) {
    monthlyUnits = input.monthlyBill / ratePerUnit;
  }
  if (monthlyUnits <= 0) {
    monthlyUnits = 300; // sensible fallback default if inputs are zero
  }

  // Sizing: 1 kW of solar produces ~120 kWh (units) per month
  let systemSizekW = Number((monthlyUnits / 120).toFixed(1));
  // Clamp between 3kW and 100kW
  if (systemSizekW < 3) systemSizekW = 3;
  if (systemSizekW > 100) systemSizekW = 100;

  const panelsCount = Math.ceil((systemSizekW * 1000) / 400); // 400W premium cells

  // Battery backup based on outages
  let batteryCount = 0;
  if (input.loadSheddingHours === "6+") {
    batteryCount = 3;
  } else if (input.loadSheddingHours === "3-5") {
    batteryCount = 2;
  } else if (input.loadSheddingHours === "1-2") {
    batteryCount = 1;
  }

  const batteryCapacitykWh = batteryCount * 13.5; // Sunchaser Core 13.5kWh

  // Inverter selection
  const inverterType =
    batteryCount > 0 ? "Sunchaser Smart Hybrid Inverter" : "Enphase IQ8 Smart Microinverters";

  // Pricing calculations
  const costPerKw = isPakistan ? 220000 : 2500;
  const batteryCost = isPakistan ? 1500000 : 8000;

  const upfrontCost = systemSizekW * costPerKw + batteryCount * batteryCost;
  const taxCredit = Math.round(upfrontCost * 0.3); // 30% Federal ITC / rebate
  const netInvestment = upfrontCost - taxCredit;

  // Savings: offsets 90% of electricity bill
  const yearlySavings = Math.round(input.monthlyBill * 12 * 0.9);

  let paybackYears = Number((netInvestment / (yearlySavings || 1)).toFixed(1));
  // Clamp payback years between 3.5 and 8.0 for realism
  if (paybackYears < 3.5) paybackYears = 3.5;
  if (paybackYears > 8.0) paybackYears = 8.0;

  return {
    systemSizekW,
    panelsCount,
    inverterType,
    batteryCount,
    batteryCapacitykWh,
    upfrontCost,
    taxCredit,
    netInvestment,
    yearlySavings,
    paybackYears,
    isPakistan,
    currency,
  };
}
