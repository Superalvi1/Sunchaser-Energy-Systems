/** Pakistan DISCO blended rate used for bill ↔ kWh conversion (PKR/kWh). */
export const DEFAULT_TARIFF_PKR_PER_KWH = 40;

/**
 * Resolve monthly kWh from bill (PKR) and stored units.
 * Fixes leads where monthly_bill was saved as monthly_units (e.g. Rs 20,000 → 18,000+ kWh).
 */
export function resolveMonthlyUnits(
  monthlyBill: number,
  monthlyUnits: number,
  tariffRate = DEFAULT_TARIFF_PKR_PER_KWH
): number {
  const bill = Number(monthlyBill) || 0;
  const units = Number(monthlyUnits) || 0;
  const rate = tariffRate > 0 ? tariffRate : DEFAULT_TARIFF_PKR_PER_KWH;

  if (units > 0 && bill > 0 && units >= bill * 0.75) {
    return Math.round(bill / rate);
  }
  if (units > 0) return Math.round(units);
  if (bill > 0) return Math.round(bill / rate);
  return 0;
}

export function billToMonthlyUnits(
  monthlyBill: number,
  tariffRate = DEFAULT_TARIFF_PKR_PER_KWH
): number {
  const bill = Number(monthlyBill) || 0;
  if (bill <= 0) return 0;
  const rate = tariffRate > 0 ? tariffRate : DEFAULT_TARIFF_PKR_PER_KWH;
  return Math.round(bill / rate);
}
