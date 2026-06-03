/** Unified inverter reading — all brand adapters must return this shape. */
export interface UnifiedEnergyReading {
  solarPower: number;
  loadPower: number;
  batterySOC: number;
  gridImport: number;
  gridExport: number;
  todayGeneration: number;
  monthGeneration: number;
  lifetimeGeneration: number;
}

export const ENERGY_BRANDS = ["GoodWe", "Solis", "Growatt", "Itel Hybrid"] as const;
export type EnergyBrand = (typeof ENERGY_BRANDS)[number];

export const ENERGY_ALERT_TYPES = [
  "low_production",
  "battery_offline",
  "inverter_offline",
  "no_generation_sunlight",
] as const;
export type EnergyAlertType = (typeof ENERGY_ALERT_TYPES)[number];

export interface CustomerEnergyDeviceRecord {
  id: string;
  customerId: string;
  brand: EnergyBrand | string;
  deviceSerial: string;
  plantId?: string | null;
  apiProvider: string;
  status: string;
  lastSync?: string | null;
  unitRatePkr: number;
  createdAt: string;
  updatedAt: string;
}

export interface EnergyAlertRecord {
  id: string;
  customerId: string;
  deviceId?: string | null;
  alertType: EnergyAlertType | string;
  severity: string;
  message: string;
  status: string;
  createdAt: string;
}

export interface EnergySavingsFromInverter {
  dailySavingsPkr: number;
  monthlySavingsPkr: number;
  yearlySavingsPkr: number;
  unitRatePkr: number;
  fromLiveData: boolean;
}

export interface EnergyMonitorPayload {
  customerId: string;
  devices: CustomerEnergyDeviceRecord[];
  reading: UnifiedEnergyReading | null;
  savings: EnergySavingsFromInverter;
  alerts: EnergyAlertRecord[];
  primaryBrand: string | null;
  lastSync: string | null;
  liveData: boolean;
}

export interface AdminEnergyMonitoringPayload {
  onlineCount: number;
  offlineCount: number;
  openAlerts: number;
  customers: {
    customerId: string;
    customerName?: string;
    devices: CustomerEnergyDeviceRecord[];
    alerts: EnergyAlertRecord[];
  }[];
}
