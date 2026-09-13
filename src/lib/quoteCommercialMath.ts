/**
 * Pure commercial quotation math.
 * All per-watt charges use ACTUAL array watts (panelWattage × panelQuantity),
 * never nominal system kW alone.
 */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" ? Number.isFinite(value) : Number.isFinite(Number(value));
}

export function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Preserve 0. Reject NaN/Infinity/negative. */
export function nonNegativeFinite(value: unknown): number | null {
  const n = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function positiveFinite(value: unknown): number | null {
  const n = nonNegativeFinite(value);
  if (n == null || n <= 0) return null;
  return n;
}

export function positiveInteger(value: unknown): number | null {
  const n = positiveFinite(value);
  if (n == null || !Number.isInteger(n)) return null;
  return n;
}

export function nonNegativeInteger(value: unknown): number | null {
  const n = nonNegativeFinite(value);
  if (n == null || !Number.isInteger(n)) return null;
  return n;
}

function factor(value: unknown): number {
  const n = nonNegativeFinite(value);
  return n == null ? 0 : n;
}

export function calculateArrayWatts(panelWattage: number, panelQuantity: number): number {
  return factor(panelWattage) * factor(panelQuantity);
}

export function calculatePanelUnitPrice(panelWattage: number, panelRatePerWatt: number): number {
  return factor(panelWattage) * factor(panelRatePerWatt);
}

export function calculatePanelTotal(
  panelWattage: number,
  panelQuantity: number,
  panelRatePerWatt: number
): number {
  return calculateArrayWatts(panelWattage, panelQuantity) * factor(panelRatePerWatt);
}

export function calculateInstallationTotal(
  panelWattage: number,
  panelQuantity: number,
  installationRatePerWatt: number
): number {
  return calculateArrayWatts(panelWattage, panelQuantity) * factor(installationRatePerWatt);
}

export function calculateElevatedStructureTotal(
  panelWattage: number,
  panelQuantity: number,
  elevatedStructureRatePerWatt: number
): number {
  return calculateArrayWatts(panelWattage, panelQuantity) * factor(elevatedStructureRatePerWatt);
}

export function calculateImpliedPkrPerWatt(cataloguePrice: number, panelWattage: number): number {
  const watts = factor(panelWattage);
  const price = factor(cataloguePrice);
  if (watts <= 0) return 0;
  return price / watts;
}

export function recommendedPanelQuantity(systemSizeKw: number, panelWattage: number): number {
  const kw = factor(systemSizeKw);
  const watts = factor(panelWattage);
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

/**
 * Read the financial installation amount from a BOQ row.
 * Supports both:
 *   - preferred: qty = actualArrayWatts, unit = W, rate = PKR/W
 *   - legacy:    qty = 1, unit = Job, rate = total
 */
export function installationChargesFromBoqRow(
  row: { qty?: unknown; rate?: unknown; total?: unknown; unit?: unknown } | null | undefined
): number {
  if (!row) return 0;
  const total = finiteNumber(row.total, Number.NaN);
  if (Number.isFinite(total) && total >= 0) return total;
  const qty = finiteNumber(row.qty, 0);
  const rate = finiteNumber(row.rate, 0);
  const product = qty * rate;
  if (product > 0) return product;
  return Number.isFinite(rate) && rate >= 0 ? rate : 0;
}
