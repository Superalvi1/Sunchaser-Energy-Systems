import type { EnergyAdapter } from "./base";
import { buildSimulatedReading } from "./simulated";

export const ItelAdapter: EnergyAdapter = {
  brand: "Itel Hybrid",
  providerKey: "itel_hybrid",
  async fetchReading(ctx) {
    return buildSimulatedReading(ctx, 1.08);
  },
};
