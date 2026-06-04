import type { EnergyAdapter } from "./base";
import { GoodWeAdapter } from "./goodwe";
import { SolisAdapter } from "./solis";
import { GrowattAdapter } from "./growatt";
import { ItelAdapter } from "./itel";

const ADAPTERS_BY_BRAND: Record<string, EnergyAdapter> = {
  GoodWe: GoodWeAdapter,
  Solis: SolisAdapter,
  Growatt: GrowattAdapter,
  "Itel Hybrid": ItelAdapter,
};

const ADAPTERS_BY_PROVIDER: Record<string, EnergyAdapter> = {
  goodwe: GoodWeAdapter,
  solis: SolisAdapter,
  growatt: GrowattAdapter,
  itel: ItelAdapter,
  itel_hybrid: ItelAdapter,
};

export function getEnergyAdapter(brand: string, apiProvider?: string | null): EnergyAdapter | null {
  const byBrand = ADAPTERS_BY_BRAND[brand];
  if (byBrand) return byBrand;
  const key = String(apiProvider || "").trim().toLowerCase();
  return ADAPTERS_BY_PROVIDER[key] || null;
}

export function listSupportedEnergyBrands(): string[] {
  return Object.keys(ADAPTERS_BY_BRAND);
}

export { GoodWeAdapter, SolisAdapter, GrowattAdapter, ItelAdapter };
