import { getSupabase } from '../../dbManager';
import { defaultSmartQuoteSettings, validateSmartQuoteSettings, type SmartQuoteSettings } from '../../src/lib/smartQuoteSettings';

export const SMART_QUOTE_SETTINGS_KEY = 'smart_quote_pricing';
export class SmartQuoteSettingsConflict extends Error {}
export function createSmartQuoteSettingsStore(local: { read: () => unknown; write: (settings: SmartQuoteSettings) => void }, dataClient = getSupabase) {
  const readRaw = async (): Promise<unknown> => {
    const client = dataClient();
    if (!client) return local.read();
    const { data, error } = await client.from('settings').select('value').eq('key', SMART_QUOTE_SETTINGS_KEY).maybeSingle();
    if (error) throw new Error('Could not load current Smart Quote prices. Please retry.');
    return data?.value ?? null;
  };
  const parse = (raw: any): SmartQuoteSettings => {
    if (!raw) return defaultSmartQuoteSettings();
    const defaults = defaultSmartQuoteSettings();
    // New catalogue entries inherit their approved default until staff updates them.
    return validateSmartQuoteSettings({ ...raw, panels: { ...defaults.panels, ...raw.panels }, inverters: { ...defaults.inverters, ...raw.inverters }, batteries: { ...defaults.batteries, ...raw.batteries }, accessories: { ...defaults.accessories, ...raw.accessories }, rates: { ...defaults.rates, ...raw.rates } });
  };
  return {
    async read() { return parse(await readRaw()); },
    async save(input: unknown): Promise<SmartQuoteSettings> {
      const draft = validateSmartQuoteSettings(input);
      const raw = await readRaw();
      const current = parse(raw);
      if (draft.revision !== current.revision) throw new SmartQuoteSettingsConflict('Prices were changed by another user. Reload before saving.');
      const next = { ...draft, revision: current.revision + 1 };
      const client = dataClient();
      if (client) {
        if (raw) {
          const { data, error } = await client.from('settings').update({ value: next }).eq('key', SMART_QUOTE_SETTINGS_KEY).eq('value', JSON.stringify(raw)).select('key').maybeSingle();
          if (error) throw new Error('Could not save Smart Quote prices. Please retry.');
          if (!data) throw new SmartQuoteSettingsConflict('Prices changed while saving. Reload before saving.');
        } else {
          const { error } = await client.from('settings').insert({ key: SMART_QUOTE_SETTINGS_KEY, value: next });
          if (error?.code === '23505') throw new SmartQuoteSettingsConflict('Prices changed while saving. Reload before saving.');
          if (error) throw new Error('Could not save Smart Quote prices. Please retry.');
        }
      } else {
        // No await between comparing and writing local state.
        if (parse(local.read()).revision !== current.revision) throw new SmartQuoteSettingsConflict('Prices changed while saving. Reload before saving.');
        local.write(next);
      }
      return next;
    },
  };
}
