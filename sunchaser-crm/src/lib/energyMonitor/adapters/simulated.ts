import type { UnifiedEnergyReading } from "../types";
import type { EnergyDeviceContext } from "./base";

/** Deterministic demo/live-style readings until vendor API credentials are wired. */
export function buildSimulatedReading(
  ctx: EnergyDeviceContext,
  brandMultiplier: number
): UnifiedEnergyReading {
  const seed = [...String(ctx.deviceSerial || "default")].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hour = new Date().getHours();
  const daylight = hour >= 6 && hour <= 18;
  const sunFactor = daylight ? Math.sin(((hour - 6) / 12) * Math.PI) : 0;
  const base = ((seed % 17) + 5) * 0.1 * brandMultiplier;

  const solarPower = daylight ? Number((base * sunFactor * 4.2).toFixed(2)) : 0;
  const loadPower = Number((solarPower * 0.65 + base * 0.3).toFixed(2));
  const batterySOC = daylight ? Math.min(98, Math.round(40 + sunFactor * 55)) : Math.round(25 + (seed % 15));
  const gridImport = Number(Math.max(0, loadPower - solarPower * 0.9).toFixed(2));
  const gridExport = Number(Math.max(0, solarPower - loadPower).toFixed(2));
  const todayGeneration = Number((solarPower * (daylight ? 3.5 + sunFactor * 2 : 0)).toFixed(1));
  const monthGeneration = Number((todayGeneration * 22 + seed % 40).toFixed(1));
  const lifetimeGeneration = Number((monthGeneration * 18 + seed * 10).toFixed(1));

  return {
    solarPower,
    loadPower,
    batterySOC,
    gridImport,
    gridExport,
    todayGeneration,
    monthGeneration,
    lifetimeGeneration,
  };
}
