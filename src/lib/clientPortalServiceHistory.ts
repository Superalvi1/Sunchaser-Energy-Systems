import type { PortalProfileRecord } from "./clientPortalPakistan";

export const SERVICE_HISTORY_TYPES = [
  "Panel Cleaning",
  "Physical Inspection",
  "Battery Health Check",
  "Breaker Replacement",
  "SPD Replacement",
  "Cable Replacement",
  "Firmware Update",
  "Warranty Repair",
  "Emergency Visit",
] as const;

export type ServiceHistoryType = (typeof SERVICE_HISTORY_TYPES)[number];

export interface MaintenanceRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  serviceDate: string;
  technicianName?: string | null;
  serviceType: string;
  description?: string | null;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  warrantyCovered: boolean;
  laborCost: number;
  partsCost: number;
  totalCost: number;
  performanceImprovementPct?: number | null;
  replacementParts?: string | null;
  componentChanged?: string | null;
  newComponentDetails?: string | null;
  createdAt: string;
}

export interface ServiceHistoryDashboard {
  totalVisits: number;
  totalCleanings: number;
  warrantyRepairs: number;
  lastServiceDate: string | null;
  nextRecommendedServiceDate: string | null;
}

export interface ServiceHistoryPayload {
  customerId: string;
  summary: ServiceHistoryDashboard;
  timeline: MaintenanceRecord[];
}

const CLEANING_TYPES = ["Panel Cleaning", "panel cleaning", "Cleaning"];

export function mapMaintenanceRecordRow(row: any): MaintenanceRecord {
  const labor = Number(row.labor_cost || 0);
  const parts = Number(row.parts_cost || 0);
  const charge = Number(row.charge_amount || 0);
  const warrantyCovered =
    row.warranty_covered != null
      ? !!row.warranty_covered
      : !!row.under_free_service;
  const description =
    row.description ||
    row.customer_visible_notes ||
    [row.component_changed, row.new_component_details].filter(Boolean).join(" — ") ||
    null;

  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    serviceDate: row.service_date,
    technicianName: row.technician_name,
    serviceType: row.service_type,
    description,
    beforePhotoUrl: row.before_photo_url,
    afterPhotoUrl: row.after_photo_url,
    warrantyCovered,
    laborCost: labor,
    partsCost: parts,
    totalCost: charge > 0 ? charge : labor + parts,
    performanceImprovementPct:
      row.performance_improvement_pct != null
        ? Number(row.performance_improvement_pct)
        : null,
    replacementParts: row.replacement_parts || row.new_component_details || null,
    componentChanged: row.component_changed,
    newComponentDetails: row.new_component_details,
    createdAt: row.created_at,
  };
}

export function buildServiceHistoryDashboard(
  logs: MaintenanceRecord[],
  profile: PortalProfileRecord | null
): ServiceHistoryDashboard {
  let lastServiceDate: string | null = null;
  for (const log of logs) {
    if (!lastServiceDate || log.serviceDate > lastServiceDate) {
      lastServiceDate = log.serviceDate;
    }
  }

  let nextRecommended = profile?.nextRecommendedServiceDate || null;
  if (!nextRecommended && lastServiceDate) {
    const d = new Date(`${lastServiceDate}T12:00:00`);
    d.setMonth(d.getMonth() + 3);
    nextRecommended = d.toISOString().slice(0, 10);
  }

  return {
    totalVisits: logs.length,
    totalCleanings: logs.filter((l) =>
      CLEANING_TYPES.some((t) => l.serviceType.toLowerCase().includes(t.toLowerCase()))
    ).length,
    warrantyRepairs: logs.filter(
      (l) =>
        l.serviceType === "Warranty Repair" ||
        l.serviceType.toLowerCase().includes("warranty")
    ).length,
    lastServiceDate,
    nextRecommendedServiceDate: nextRecommended,
  };
}

export function isPhase7ColumnsMissingError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === "42703" || msg.includes("performance_improvement_pct") || msg.includes("warranty_covered");
}
