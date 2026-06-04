import type { EnergyAdapter } from "./base";
import { buildSimulatedReading } from "./simulated";

export const SolisAdapter: EnergyAdapter = {
  brand: "Solis",
  providerKey: "solis",
  async fetchReading(ctx) {
    return buildSimulatedReading(ctx, 1.0);
  },
};
