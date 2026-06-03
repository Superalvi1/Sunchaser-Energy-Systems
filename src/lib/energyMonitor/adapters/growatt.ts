import type { EnergyAdapter } from "./base";
import { buildSimulatedReading } from "./simulated";

export const GrowattAdapter: EnergyAdapter = {
  brand: "Growatt",
  providerKey: "growatt",
  async fetchReading(ctx) {
    return buildSimulatedReading(ctx, 0.98);
  },
};
