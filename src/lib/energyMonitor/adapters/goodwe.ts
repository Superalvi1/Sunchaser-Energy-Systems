import type { EnergyAdapter } from "./base";
import { buildSimulatedReading } from "./simulated";

export const GoodWeAdapter: EnergyAdapter = {
  brand: "GoodWe",
  providerKey: "goodwe",
  async fetchReading(ctx) {
    return buildSimulatedReading(ctx, 1.05);
  },
};
