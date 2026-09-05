/**
 * Pure commercial quotation math.
 * All per-watt charges use ACTUAL array watts (panelWattage × panelQuantity),
 * never nominal system kW alone.
 */

export function calculateArrayWatts(panelWattage: number, panelQuantity: number): number {
  const watts = Number(panelWattage) || 0;
  const qty = Number(panelQuantity) || 0;
  return watts * qty;
}

export function calculatePanelUnitPrice(panelWattage: number, panelRatePerWatt: number): number {
  const watts = Number(panelWattage) || 0;
  const rate = Number(panelRatePerWatt) || 0;
  return watts * rate;
}

export function calculatePanelTotal(
  panelWattage: number,
  panelQuantity: number,
  panelRatePerWatt: number
): number {
  return calculateArrayWatts(panelWattage, panelQuantity) * (Number(panelRatePerWatt) || 0);
}

export function calculateInstallationTotal(
  panelWattage: number,
  panelQuantity: number,
  installationRatePerWatt: number
): number {
  return calculateArrayWatts(panelWattage, panelQuantity) * (Number(installationRatePerWatt) || 0);
}

export function calculateElevatedStructureTotal(
  panelWattage: number,
  panelQuantity: number,
  elevatedStructureRatePerWatt: number
): number {
  return calculateArrayWatts(panelWattage, panelQuantity) * (Number(elevatedStructureRatePerWatt) || 0);
}

export function calculateImpliedPkrPerWatt(cataloguePrice: number, panelWattage: number): number {
  const watts = Number(panelWattage) || 0;
  const price = Number(cataloguePrice) || 0;
  if (watts <= 0) return 0;
  return price / watts;
}

export function recommendedPanelQuantity(systemSizeKw: number, panelWattage: number): number {
  const kw = Number(systemSizeKw) || 0;
  const watts = Number(panelWattage) || 0;
  if (kw <= 0 || watts <= 0) return 0;
  return Math.ceil((kw * 1000) / watts);
}

export function arrayKilowattsPeak(panelWattage: number, panelQuantity: number): number {
  return calculateArrayWatts(panelWattage, panelQuantity) / 1000;
}

export const DEFAULT_INSTALLATION_RATE_PER_WATT = 4;
export const DEFAULT_ELEVATED_STRUCTURE_RATE_PER_WATT = 16;
/** Existing AutoSizer girder commercial job amount — not a per-watt formula. */
export const DEFAULT_GIRDER_STRUCTURE_AMOUNT = 180000;
