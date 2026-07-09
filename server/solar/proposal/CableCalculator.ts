/**
 * Cable roll and conductor pricing — default 20,000 PKR per roll with complexity adjustment.
 */

import {
  AC_CABLE_PER_METER_COST,
  AC_CABLE_PER_METER_PRICE,
  CABLE_ROLL_LENGTH_M,
  CABLE_ROLL_PRICE,
  DC_CABLE_PER_METER_COST,
  DC_CABLE_PER_METER_PRICE,
  EARTH_WIRE_PER_METER_COST,
  EARTH_WIRE_PER_METER_PRICE,
} from "./SolarProductCatalog.ts";
import { acCableDistanceMeters, complexityMultiplier, dcCableDistanceMeters, earthWireMeters } from "./SolarDesignRules.ts";
import type { StructureType, SupportedSystemSizeKw, SystemType } from "./SolarProposalModels.ts";
import { round2 } from "./SolarProposalModels.ts";

export interface CableCalculation {
  dcDistanceM: number;
  acDistanceM: number;
  earthDistanceM: number;
  complexityMultiplier: number;
  adjustedDcDistanceM: number;
  cableRolls: number;
  rollUnitPrice: number;
  rollLineTotal: number;
  dcCableCost: number;
  dcCablePrice: number;
  acCableCost: number;
  acCablePrice: number;
  earthWireCost: number;
  earthWirePrice: number;
  sectionSubtotalCost: number;
  sectionSubtotalPrice: number;
}

export function calculateCables(
  sizeKw: SupportedSystemSizeKw,
  systemType: SystemType,
  structureType: StructureType,
  siteComplexityScore = 0
): CableCalculation {
  const dcDistanceM = dcCableDistanceMeters(sizeKw);
  const acDistanceM = acCableDistanceMeters(sizeKw);
  const earthDistanceM = earthWireMeters(sizeKw);
  const mult = complexityMultiplier(systemType, structureType, siteComplexityScore);
  const adjustedDcDistanceM = round2(dcDistanceM * mult);
  const cableRolls = Math.max(1, Math.ceil(adjustedDcDistanceM / CABLE_ROLL_LENGTH_M));
  const rollLineTotal = cableRolls * CABLE_ROLL_PRICE;
  const dcCableCost = round2(adjustedDcDistanceM * DC_CABLE_PER_METER_COST);
  const dcCablePrice = round2(adjustedDcDistanceM * DC_CABLE_PER_METER_PRICE);
  const acCableCost = round2(acDistanceM * AC_CABLE_PER_METER_COST);
  const acCablePrice = round2(acDistanceM * AC_CABLE_PER_METER_PRICE);
  const earthWireCost = round2(earthDistanceM * EARTH_WIRE_PER_METER_COST);
  const earthWirePrice = round2(earthDistanceM * EARTH_WIRE_PER_METER_PRICE);

  return {
    dcDistanceM,
    acDistanceM,
    earthDistanceM,
    complexityMultiplier: mult,
    adjustedDcDistanceM,
    cableRolls,
    rollUnitPrice: CABLE_ROLL_PRICE,
    rollLineTotal,
    dcCableCost,
    dcCablePrice,
    acCableCost,
    acCablePrice,
    earthWireCost,
    earthWirePrice,
    sectionSubtotalCost: round2(dcCableCost + acCableCost + earthWireCost),
    sectionSubtotalPrice: round2(rollLineTotal + acCablePrice + earthWirePrice),
  };
}
