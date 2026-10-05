import { resolveSalesProvider, type SalesProviderSelection } from "./providerConfig.ts";
import { getRailwayObject, putRailwayObjectConditional, isRailwayObjectStorageConfigured } from "../storage/railwayObjectStorage.ts";

export type ApprovedQuotation = { id: string; title: string; description: string; capacityKw: number; expiresAt: string; storagePath: string; approved: boolean };
export type SalesAgentSettings = SalesProviderSelection & { enabled: boolean; ownerUsername: string; businessFacts: string; dailyLimit: number; autoQuotes: boolean; quotations: ApprovedQuotation[]; revision: number };
const key = "whatsapp-agent/settings.json";
export const defaultAgentSettings = (): SalesAgentSettings => ({ enabled: false, ownerUsername: "", businessFacts: "", dailyLimit: 100, autoQuotes: false, quotations: [], revision: 0 });
export function agentReadiness(env: NodeJS.ProcessEnv = process.env, selection: SalesProviderSelection = {}) {
  const config = resolveSalesProvider(env, selection);
  return { providerConfigured: Boolean(config.apiKey), modelConfigured: Boolean(config.model), storageConfigured: isRailwayObjectStorageConfigured(env), whatsappEnabled: /^(true|1|yes)$/i.test(env.WHATSAPP_CONVERSATIONS_ENABLED || "") };
}
export function canEnableAgent(env: NodeJS.ProcessEnv = process.env, selection: SalesProviderSelection = {}) { return Object.values(agentReadiness(env,selection)).every(Boolean); }
export async function loadAgentSettings() {
  const obj = await getRailwayObject("customer-documents", key);
  if (!obj) return { settings: defaultAgentSettings(), etag: null };
  const settings = JSON.parse(obj.body.toString("utf8")) as SalesAgentSettings;
  if (typeof settings.enabled !== "boolean" || !Array.isArray(settings.quotations) || !Number.isInteger(settings.revision)) throw new Error("Agent settings are invalid.");
  return { settings, etag: obj.etag };
}
export async function updateAgentSettings(revision: number, mutate: (current: SalesAgentSettings) => SalesAgentSettings) {
  const current = await loadAgentSettings();
  if (current.settings.revision !== revision) throw Object.assign(new Error("Settings changed. Refresh and try again."), { status: 409 });
  const next = { ...mutate(current.settings), revision: revision + 1 };
  if (!await putRailwayObjectConditional("customer-documents", key, Buffer.from(JSON.stringify(next)), "application/json", current.etag)) throw Object.assign(new Error("Settings changed. Refresh and try again."), { status: 409 });
  return next;
}
