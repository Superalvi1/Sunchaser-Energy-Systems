import { calculatePublicQuotation, defaultPublicQuoteConfig, PUBLIC_QUOTE_CAPACITIES, type PublicQuoteCapacity, type PublicQuoteConfig } from "../../src/lib/publicQuotationBuilder.ts";
import { PANEL_CATALOG, INVERTER_CATALOG, BATTERY_CATALOG } from "../../src/lib/solarEquipmentCatalog.ts";
import { normalizePakistanMobile } from "../../src/lib/smartQuoteLead.ts";
import type { ApprovedQuotation } from "./agentSettings.ts";

export type QuoteRequirements = { name: string; city: string; systemCapacityKw: number; panelId: string; inverterId: string; batteryId: string | null; panelQuantity: number; inverterQuantity: number; batteryQuantity: number; structureType: "standard-l2" | "standard-l3" | "elevated"; confirmed: boolean };
/** Provider supplies IDs and requirements only. All selling prices come from Smart Quote. */
export function calculateAgentQuote(input: QuoteRequirements, phone: string) {
  if (!input.confirmed) throw new Error("Confirm the proposed equipment and standard cable/service allowances with the client first.");
  if (typeof input.name !== "string" || typeof input.city !== "string" || !input.name.trim() || !input.city.trim() || input.name.length > 120 || input.city.length > 120 || /[\r\n]/.test(input.name + input.city) || !normalizePakistanMobile(phone)) throw new Error("Client name, city and a valid mobile are required.");
  if (!PUBLIC_QUOTE_CAPACITIES.includes(input.systemCapacityKw as PublicQuoteCapacity)) throw new Error("This system size requires a consultant.");
  const inverter = INVERTER_CATALOG.find(i => i.id === input.inverterId);
  const panel = PANEL_CATALOG.find(p => p.id === input.panelId);
  const battery = input.batteryId ? BATTERY_CATALOG.find(b => b.id === input.batteryId) : null;
  if (!inverter || !panel || (input.batteryId && !battery)) throw new Error("Equipment must be selected from the approved catalogue.");
  if (!Number.isInteger(input.inverterQuantity) || input.inverterQuantity < 1 || inverter.capacityKw * input.inverterQuantity < input.systemCapacityKw) throw new Error("Inverter capacity is below the requested system size; a consultant must review it.");
  if (!Number.isInteger(input.panelQuantity) || input.panelQuantity < 1 || input.panelQuantity > 80 || input.inverterQuantity > 4 || !Number.isInteger(input.batteryQuantity) || input.batteryQuantity < 0 || input.batteryQuantity > 10 || (battery && input.batteryQuantity < 1) || (!battery && input.batteryQuantity !== 0)) throw new Error("Equipment quantities require review.");
  if (inverter.phase === "unspecified") throw new Error("Wiring phase requires confirmation.");
  if (battery && inverter.voltageClass && battery.voltageClass && battery.voltageClass !== inverter.voltageClass) throw new Error("Inverter and battery voltage classes do not match.");
  if (inverter.bundle && input.batteryId !== inverter.bundle.batteryId) throw new Error("This inverter requires its bundled battery.");
  if (!["standard-l2", "standard-l3", "elevated"].includes(input.structureType)) throw new Error("A custom structure requires a site review.");
  const config: PublicQuoteConfig = { ...defaultPublicQuoteConfig(input.systemCapacityKw as PublicQuoteCapacity), panelId: input.panelId, panelQuantity: input.panelQuantity, inverterId: input.inverterId, inverterQuantity: input.inverterQuantity, batteryId: input.batteryId || defaultPublicQuoteConfig(input.systemCapacityKw as PublicQuoteCapacity).batteryId, batteryQuantity: input.batteryId ? input.batteryQuantity : 1, structureType: input.structureType, structurePanelQuantity: input.panelQuantity, wiringPhase: inverter.phase, discountPkr: 0 };
  config.included.battery = Boolean(input.batteryId);
  const result = calculatePublicQuotation(config);
  const arrayKw = input.panelQuantity * panel.watts / 1000;
  if (arrayKw < input.systemCapacityKw * 0.9 || arrayKw > input.systemCapacityKw * 1.3) throw new Error("Panel sizing requires a consultant review.");
  return { config, result };
}
export function currentApprovedQuotations(documents: ApprovedQuotation[], now = Date.now()) {
  return documents.filter(d => d.approved === true && Number.isFinite(Date.parse(d.expiresAt)) && Date.parse(d.expiresAt) > now);
}
export const publicAgentCatalog = { panels: PANEL_CATALOG, inverters: INVERTER_CATALOG, batteries: BATTERY_CATALOG };
