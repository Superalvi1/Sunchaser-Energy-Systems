import { API_BASE_URL, authorizedFetch } from './api';
import { validateSmartQuoteSettings, type SmartQuoteSettings } from '../lib/smartQuoteSettings';
async function settingsResponse(response: Response): Promise<SmartQuoteSettings> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load current quotation prices.');
  return validateSmartQuoteSettings(body.settings);
}
export async function fetchSmartQuoteSettings(): Promise<SmartQuoteSettings> {
  return settingsResponse(await fetch(`${API_BASE_URL}/api/public/smart-quote-settings`, { cache: 'no-store' }));
}
export async function fetchAdminSmartQuoteSettings(): Promise<SmartQuoteSettings> {
  return settingsResponse(await authorizedFetch('/api/admin/smart-quote-settings', { cache: 'no-store' }));
}
export async function saveSmartQuoteSettings(settings: SmartQuoteSettings): Promise<SmartQuoteSettings> {
  return settingsResponse(await authorizedFetch('/api/admin/smart-quote-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }));
}
