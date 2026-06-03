import type { UnifiedEnergyReading } from "./energyMonitor/types";
import {
  ENERGY_BRANDS,
  type CustomerEnergyDeviceRecord,
  type EnergyAlertRecord,
  type EnergySavingsFromInverter,
} from "./energyMonitor/types";
import { DEFAULT_UNIT_RATE_PKR } from "./clientPortalSavings";

export { ENERGY_BRANDS };

export function mapEnergyDeviceRow(row: any): CustomerEnergyDeviceRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    brand: row.brand,
    deviceSerial: row.device_serial,
    plantId: row.plant_id,
    apiProvider: row.api_provider,
    status: row.status || "Offline",
    lastSync: row.last_sync,
    unitRatePkr: row.unit_rate_pkr != null ? Number(row.unit_rate_pkr) : DEFAULT_UNIT_RATE_PKR,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function mapEnergyAlertRow(row: any): EnergyAlertRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    deviceId: row.device_id,
    alertType: row.alert_type,
    severity: row.severity || "warning",
    message: row.message,
    status: row.status || "open",
    createdAt: row.created_at,
  };
}

export function providerKeyForBrand(brand: string): string {
  switch (brand) {
    case "GoodWe":
      return "goodwe";
    case "Solis":
      return "solis";
    case "Growatt":
      return "growatt";
    case "Itel Hybrid":
      return "itel_hybrid";
    default:
      return brand.toLowerCase().replace(/\s+/g, "_");
  }
}

export function isEnergyTablesMissingError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.code === "PGRST205" &&
    (msg.includes("customer_energy_devices") || msg.includes("energy_alerts"))
  );
}

export function buildSavingsFromInverterReading(
  reading: UnifiedEnergyReading,
  unitRatePkr: number
): EnergySavingsFromInverter {
  const rate = unitRatePkr > 0 ? unitRatePkr : DEFAULT_UNIT_RATE_PKR;
  const dailyKwh = reading.todayGeneration;
  const monthlyKwh = reading.monthGeneration;
  const yearlyKwh = monthlyKwh * 12;
  return {
    dailySavingsPkr: Math.round(dailyKwh * rate),
    monthlySavingsPkr: Math.round(monthlyKwh * rate),
    yearlySavingsPkr: Math.round(yearlyKwh * rate),
    unitRatePkr: rate,
    fromLiveData: true,
  };
}

export function evaluateEnergyAlerts(
  reading: UnifiedEnergyReading | null,
  device: CustomerEnergyDeviceRecord
): { alertType: string; severity: string; message: string }[] {
  const out: { alertType: string; severity: string; message: string }[] = [];
  const hour = new Date().getHours();
  const daylight = hour >= 7 && hour <= 17;

  if (device.status === "Offline" || device.status === "Error") {
    out.push({
      alertType: "inverter_offline",
      severity: "critical",
      message: `${device.brand} inverter (${device.deviceSerial}) is offline. Check connectivity.`,
    });
    return out;
  }

  if (!reading) return out;

  if (reading.batterySOC <= 0 && device.brand !== "Solis") {
    out.push({
      alertType: "battery_offline",
      severity: "warning",
      message: "Battery state of charge unavailable or battery offline.",
    });
  }

  if (daylight && reading.solarPower < 0.15 && reading.todayGeneration < 0.5) {
    out.push({
      alertType: "no_generation_sunlight",
      severity: "critical",
      message: "No solar generation detected during daylight hours.",
    });
  }

  if (daylight && reading.solarPower > 0.2 && reading.solarPower < 0.5) {
    out.push({
      alertType: "low_production",
      severity: "warning",
      message: "Solar production is below expected levels for current conditions.",
    });
  }

  return out;
}

export function formatKw(kw: number): string {
  return `${kw.toFixed(2)} kW`;
}

export function formatKwhEnergy(kwh: number): string {
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${kwh.toFixed(1)} kWh`;
}

export function formatPkrEnergy(amount: number): string {
  return `PKR ${Math.round(amount).toLocaleString("en-PK")}`;
}
