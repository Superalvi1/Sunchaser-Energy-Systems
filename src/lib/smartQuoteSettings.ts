import { PANEL_CATALOG, INVERTER_CATALOG, BATTERY_CATALOG, BATTERY_ACCESSORY_CATALOG } from './solarEquipmentCatalog';

export const DEFAULT_SMART_QUOTE_RATES = {
  acCable: 300, dcCable: 275, earthingCable: 115, bore: 9_000,
  lightningArrester: 6_000, transport: 10_000, survey: 5_000,
  singlePhaseBreakers: 20_000, threePhaseBreakers: 25_000,
  miscellaneous: 10_000, civilPadPerLeg: 500,
  installationPerWatt: 4, elevatedPerWatt: 16, l2Stand: 4_500, l3Stand: 7_200,
};
export type SmartQuoteSettings = {
  revision: number;
  panels: Record<string, number>;
  inverters: Record<string, number>;
  batteries: Record<string, number>;
  accessories: Record<string, number>;
  rates: typeof DEFAULT_SMART_QUOTE_RATES;
  document: { preparedBy: string; validityDays: number; paymentPlan: string[]; terms: string[] };
};
export const SMART_QUOTE_RATE_LABELS: Record<keyof typeof DEFAULT_SMART_QUOTE_RATES, string> = {
  acCable: 'AC cable / meter', dcCable: 'DC cable / meter', earthingCable: 'Earthing cable / meter',
  bore: 'Earthing / bore', lightningArrester: 'Lightning arrester / unit', transport: 'Within-city transport / job',
  survey: 'Survey and design / job', singlePhaseBreakers: 'Single-phase protection / set',
  threePhaseBreakers: 'Three-phase protection / set', miscellaneous: 'Electrical miscellaneous / job',
  civilPadPerLeg: 'Civil pad / leg', installationPerWatt: 'Installation / watt', elevatedPerWatt: 'Elevated structure / watt',
  l2Stand: 'L2 stand / 2 panels', l3Stand: 'L3 stand / 3 panels',
};
export function defaultSmartQuoteSettings(): SmartQuoteSettings {
  return {
    revision: 0,
    panels: Object.fromEntries(PANEL_CATALOG.map(p => [p.id, p.pricePerWattPkr])),
    inverters: Object.fromEntries(INVERTER_CATALOG.map(p => [p.id, p.pricePkr])),
    batteries: Object.fromEntries(BATTERY_CATALOG.map(p => [p.id, p.pricePkr])),
    accessories: Object.fromEntries(BATTERY_ACCESSORY_CATALOG.map(p => [p.id, p.pricePkr])),
    rates: { ...DEFAULT_SMART_QUOTE_RATES },
    document: {
      preparedBy: 'Sunchaser Energy Systems', validityDays: 3,
      paymentPlan: ['Advance booking and milestone payments as agreed in the final sales contract.'],
      terms: ['Subject to site survey, stock availability and final technical approval.', 'Only items listed in the bill of quantities are included. Unlisted civil work is excluded.', 'Equipment models, warranties, delivery schedule and final scope must be confirmed before payment.'],
    },
  };
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Validate on both sides; unknown products/fields cannot become price overrides. */
export function validateSmartQuoteSettings(input: unknown): SmartQuoteSettings {
  const defaults = defaultSmartQuoteSettings();
  if (!object(input) || Object.keys(input).some(k => !(k in defaults))) throw new Error('Invalid Smart Quote settings.');
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new Error('Invalid settings revision. Reload prices.');
  const result = { ...defaults, revision: Number(input.revision) };
  for (const group of ['panels', 'inverters', 'batteries', 'accessories', 'rates'] as const) {
    const values = input[group];
    if (!object(values) || Object.keys(values).some(id => !Object.hasOwn(defaults[group], id))) throw new Error(`Invalid ${group} prices.`);
    for (const id of Object.keys(defaults[group])) {
      const value = values[id];
      const max = group === 'panels' || (group === 'rates' && ['installationPerWatt', 'elevatedPerWatt'].includes(id)) ? 10_000 : 100_000_000;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) throw new Error(`Enter a valid ${group} price for ${id} (up to two decimals).`);
      (result[group] as Record<string, number>)[id] = value;
    }
  }
  const doc = input.document;
  if (!object(doc) || Object.keys(doc).some(k => !Object.hasOwn(defaults.document, k))) throw new Error('Invalid quotation document settings.');
  if (typeof doc.preparedBy !== 'string' || !doc.preparedBy.trim() || doc.preparedBy.length > 100 || /[\r\n]/.test(doc.preparedBy)) throw new Error('Prepared by must be 1–100 characters on one line.');
  if (!Number.isInteger(doc.validityDays) || Number(doc.validityDays) < 1 || Number(doc.validityDays) > 90) throw new Error('Quotation validity must be 1–90 days.');
  const lines = (v: unknown, label: string) => {
    if (!Array.isArray(v) || v.length < 1 || v.length > 15 || v.some(s => typeof s !== 'string' || !s.trim() || s.length > 500 || /[\r\n]/.test(s))) throw new Error(`${label}: use 1–15 lines of up to 500 characters each.`);
    return v.map(s => s.trim());
  };
  result.document = { preparedBy: doc.preparedBy.trim(), validityDays: Number(doc.validityDays), paymentPlan: lines(doc.paymentPlan, 'Payment plan'), terms: lines(doc.terms, 'Terms') };
  return result;
}
export function smartQuoteCatalog(settings: SmartQuoteSettings) {
  return {
    panels: PANEL_CATALOG.map(p => ({ ...p, pricePerWattPkr: settings.panels[p.id] })),
    inverters: INVERTER_CATALOG.map(p => ({ ...p, pricePkr: settings.inverters[p.id], ...(p.bundle ? { bundle: { ...p.bundle, totalBundlePricePkr: settings.inverters[p.id] } } : {}) })),
    batteries: BATTERY_CATALOG.map(p => ({ ...p, pricePkr: settings.batteries[p.id] })),
    accessories: BATTERY_ACCESSORY_CATALOG.map(p => ({ ...p, pricePkr: settings.accessories[p.id] })),
  };
}
