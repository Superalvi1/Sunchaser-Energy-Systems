export const DEFAULT_UNIT_RATE_PKR = 55;
export const GENERATION_HOURS_PER_DAY = 4;
export const CO2_KG_PER_KWH = 0.45;
export const KG_CO2_PER_TREE = 21;

export const PERFORMANCE_STATUSES = [
  "Excellent",
  "Normal",
  "Low Generation",
  "Needs Attention",
] as const;

export type PerformanceStatus = (typeof PERFORMANCE_STATUSES)[number];

export interface SavingsMetric {
  value: number;
  display: string;
  estimated: boolean;
}

export interface CustomerSavingsProfileRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  systemSizeKw?: number | null;
  unitRate?: number | null;
  manualTodayGeneration?: number | null;
  manualMonthGeneration?: number | null;
  lifetimeGeneration?: number | null;
  performanceStatus?: PerformanceStatus | string | null;
  notes?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavingsDashboardPayload {
  customerId: string;
  projectId: string | null;
  systemSizeKw: number;
  unitRate: number;
  todayGeneration: SavingsMetric;
  monthGeneration: SavingsMetric;
  lifetimeGeneration: SavingsMetric;
  savingsThisMonth: SavingsMetric;
  lifetimeSavings: SavingsMetric;
  co2SavedKg: SavingsMetric;
  treesEquivalent: number;
  performanceStatus: PerformanceStatus | string;
  profile: CustomerSavingsProfileRecord | null;
}

export function formatPkr(amount: number): string {
  const rounded = Math.round(amount);
  return `PKR ${rounded.toLocaleString("en-PK")}`;
}

export function formatKwh(kwh: number): string {
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${kwh.toFixed(1)} kWh`;
}

export function mapSavingsProfileRow(row: any): CustomerSavingsProfileRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    systemSizeKw: row.system_size_kw != null ? Number(row.system_size_kw) : null,
    unitRate: row.unit_rate != null ? Number(row.unit_rate) : null,
    manualTodayGeneration:
      row.manual_today_generation != null ? Number(row.manual_today_generation) : null,
    manualMonthGeneration:
      row.manual_month_generation != null ? Number(row.manual_month_generation) : null,
    lifetimeGeneration:
      row.lifetime_generation != null ? Number(row.lifetime_generation) : null,
    performanceStatus: row.performance_status,
    notes: row.notes,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

function metric(value: number, display: string, estimated: boolean): SavingsMetric {
  return { value, display, estimated };
}

export function buildSavingsDashboard(input: {
  customerId: string;
  projectId?: string | null;
  systemSizeKw: number;
  profile?: CustomerSavingsProfileRecord | null;
}): SavingsDashboardPayload {
  const profile = input.profile;
  const systemSizeKw = Math.max(
    0,
    profile?.systemSizeKw ?? input.systemSizeKw ?? 0
  );
  const unitRate = profile?.unitRate ?? DEFAULT_UNIT_RATE_PKR;
  const estimatedDaily = systemSizeKw * GENERATION_HOURS_PER_DAY;
  const estimatedMonthly = estimatedDaily * 30;

  const todayEstimated = estimatedDaily <= 0;
  const todayValue =
    profile?.manualTodayGeneration != null
      ? profile.manualTodayGeneration
      : estimatedDaily;
  const todayGeneration = metric(
    todayValue,
    formatKwh(todayValue),
    profile?.manualTodayGeneration == null || todayEstimated
  );

  const monthEstimated = profile?.manualMonthGeneration == null;
  const monthValue = profile?.manualMonthGeneration ?? estimatedMonthly;
  const monthGeneration = metric(
    monthValue,
    formatKwh(monthValue),
    monthEstimated || systemSizeKw <= 0
  );

  const lifetimeEstimated = profile?.lifetimeGeneration == null;
  const lifetimeValue =
    profile?.lifetimeGeneration ?? (monthValue > 0 ? monthValue * 12 : 0);
  const lifetimeGeneration = metric(
    lifetimeValue,
    formatKwh(lifetimeValue),
    lifetimeEstimated || systemSizeKw <= 0
  );

  const savingsMonthValue = monthValue * unitRate;
  const savingsLifetimeValue = lifetimeValue * unitRate;
  const savingsEstimated =
    monthEstimated || todayEstimated || lifetimeEstimated || systemSizeKw <= 0;

  const co2Kg = lifetimeValue * CO2_KG_PER_KWH;
  const trees = co2Kg > 0 ? co2Kg / KG_CO2_PER_TREE : 0;

  let performanceStatus: PerformanceStatus | string =
    profile?.performanceStatus || "Normal";
  if (!profile?.performanceStatus) {
    if (systemSizeKw <= 0) performanceStatus = "Needs Attention";
    else if (todayValue < estimatedDaily * 0.5 && !todayGeneration.estimated) {
      performanceStatus = "Low Generation";
    } else if (systemSizeKw >= 5) performanceStatus = "Excellent";
    else performanceStatus = "Normal";
  }

  return {
    customerId: input.customerId,
    projectId: profile?.projectId ?? input.projectId ?? null,
    systemSizeKw,
    unitRate,
    todayGeneration,
    monthGeneration,
    lifetimeGeneration,
    savingsThisMonth: metric(savingsMonthValue, formatPkr(savingsMonthValue), savingsEstimated),
    lifetimeSavings: metric(savingsLifetimeValue, formatPkr(savingsLifetimeValue), savingsEstimated),
    co2SavedKg: metric(co2Kg, `${co2Kg.toFixed(0)} kg`, savingsEstimated),
    treesEquivalent: Math.round(trees * 10) / 10,
    performanceStatus,
    profile: profile ?? null,
  };
}

export function isCustomerSavingsTableMissingError(err: any): boolean {
  return (
    err?.code === "PGRST205" &&
    String(err?.message || "").toLowerCase().includes("customer_savings_profiles")
  );
}
