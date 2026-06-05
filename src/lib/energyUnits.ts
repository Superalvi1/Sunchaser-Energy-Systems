/** Pakistan DISCO blended rate for bill ↔ kWh conversion (PKR/kWh). */
export const DEFAULT_TARIFF_PKR_PER_KWH = 42;

/** Conservative Lahore generation: kWh per kW DC per month. */
export const DEFAULT_GENERATION_PER_KW_MONTH = 120;

/** System output derating (0–1). Applied to generation estimates. */
export const DEFAULT_SOLAR_DERATING_FACTOR = 1;

export type SolarSizingSettings = {
  blendedTariffPkrPerKwh: number;
  generationPerKwMonth: number;
  deratingFactor: number;
};

export function getSolarSizingSettings(settings?: Record<string, unknown> | null): SolarSizingSettings {
  const nested = (settings?.solarSizing || settings?.solar_sizing) as Record<string, unknown> | undefined;
  const tariff = Number(
    nested?.blendedTariffPkrPerKwh ??
      nested?.blended_tariff_pkr_per_kwh ??
      settings?.blendedTariffPkrPerKwh ??
      settings?.blended_tariff_pkr_per_kwh
  );
  const generation = Number(
    nested?.generationPerKwMonth ??
      nested?.generation_per_kw_month ??
      settings?.solarGenerationPerKwMonth ??
      settings?.solar_generation_per_kw_month
  );
  const derating = Number(
    nested?.deratingFactor ??
      nested?.derating_factor ??
      settings?.solarDeratingFactor ??
      settings?.solar_derating_factor
  );
  return {
    blendedTariffPkrPerKwh:
      tariff > 0 ? tariff : DEFAULT_TARIFF_PKR_PER_KWH,
    generationPerKwMonth:
      generation > 0 ? generation : DEFAULT_GENERATION_PER_KW_MONTH,
    deratingFactor:
      derating > 0 && derating <= 1 ? derating : DEFAULT_SOLAR_DERATING_FACTOR,
  };
}

/** True when stored monthly_units looks like PKR bill amount, not kWh. */
export function looksLikeBillStoredAsUnits(monthlyBill: number, monthlyUnits: number): boolean {
  const bill = Number(monthlyBill) || 0;
  const units = Number(monthlyUnits) || 0;
  if (bill <= 0 || units <= 0) return false;
  if (units >= bill * 0.5) return true;
  const impliedRate = bill / units;
  if (units > 800 && impliedRate > 8 && impliedRate < 120) return true;
  return false;
}

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

  if (bill > 0) {
    const fromBill = Math.round(bill / rate);
    if (units <= 0) return fromBill;
    if (looksLikeBillStoredAsUnits(bill, units)) return fromBill;
    if (units > fromBill * 3) return fromBill;
    return Math.round(units);
  }
  if (units > 0) return Math.round(units);
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

/** recommendedKW = monthlyUnits / generationPerKwMonth (Pakistan Lahore conservative). */
export function recommendSystemSizeKw(
  monthlyUnits: number,
  sizing?: Partial<SolarSizingSettings>
): number {
  const cfg = { ...getSolarSizingSettings(), ...sizing };
  const units = Number(monthlyUnits) || 0;
  if (units <= 0 || cfg.generationPerKwMonth <= 0) return 0;
  return Math.round((units / cfg.generationPerKwMonth) * 10) / 10;
}

/** Monthly kWh generation for a system size. */
export function estimateMonthlyGenerationKw(
  systemSizeKw: number,
  sizing?: Partial<SolarSizingSettings>
): number {
  const cfg = { ...getSolarSizingSettings(), ...sizing };
  const kw = Number(systemSizeKw) || 0;
  if (kw <= 0) return 0;
  return Math.round(kw * cfg.generationPerKwMonth * cfg.deratingFactor);
}

/** Example conversions for admin/docs (PKR bill → kWh at tariff). */
export function billToUnitsExamples(
  bills: number[],
  tariffRate = DEFAULT_TARIFF_PKR_PER_KWH
): Array<{ bill: number; units: number }> {
  return bills.map((bill) => ({
    bill,
    units: billToMonthlyUnits(bill, tariffRate),
  }));
}
