import type { UnifiedEnergyReading } from "../types";

export interface EnergyDeviceContext {
  deviceSerial: string;
  plantId?: string | null;
  apiProvider?: string | null;
}

export interface EnergyAdapter {
  readonly brand: string;
  readonly providerKey: string;
  fetchReading(ctx: EnergyDeviceContext): Promise<UnifiedEnergyReading>;
}
