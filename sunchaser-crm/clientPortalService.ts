export const SERVICE_TYPES = [
  "Cleaning",
  "Inspection",
  "Warranty Visit",
  "Emergency Visit",
  "Battery Health Check",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_STATUSES = [
  "Submitted",
  "Assigned",
  "Scheduled",
  "En Route",
  "Completed",
  "Cancelled",
] as const;

export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const SERVICE_TIME_SLOTS = [
  "Morning (8am–12pm)",
  "Afternoon (12pm–4pm)",
  "Evening (4pm–7pm)",
] as const;

export interface ServiceMaintenanceSummary {
  lastCleaningDate: string | null;
  nextRecommendedCleaningDate: string | null;
  /** Primary status label for the customer service hub */
  status: string;
  /** @deprecated alias of status — kept for backward compatibility */
  serviceStatus: string;
  openRequestsCount: number;
  latestRequest: ServiceRequestRecord | null;
  availableServiceTypes: readonly ServiceType[];
}

export interface ServiceRequestRecord {
  id: string;
  requestNumber: string;
  customerId: string;
  projectId?: string | null;
  serviceType: ServiceType | string;
  status: ServiceStatus | string;
  preferredDate?: string | null;
  preferredTime?: string | null;
  notes?: string | null;
  assignedTechnician?: string | null;
  scheduledVisitDate?: string | null;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  completionNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function serviceRequestNumberFromId(id: string): string {
  const suffix = id.replace(/^svc-req-/i, "").slice(-8).toUpperCase();
  return `SV-${suffix}`;
}

export function mapServiceRequestRow(row: any): ServiceRequestRecord {
  return {
    id: row.id,
    requestNumber: serviceRequestNumberFromId(row.id),
    customerId: row.customer_id,
    projectId: row.project_id,
    serviceType: row.service_type,
    status: row.status || "Submitted",
    preferredDate: row.preferred_date,
    preferredTime: row.preferred_time,
    notes: row.notes,
    assignedTechnician: row.assigned_technician,
    scheduledVisitDate: row.scheduled_visit_date,
    beforePhotoUrl: row.before_photo_url,
    afterPhotoUrl: row.after_photo_url,
    completionNotes: row.completion_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

const CLEANING_INTERVAL_MONTHS = 6;

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildServiceMaintenanceSummary(
  requests: ServiceRequestRecord[]
): ServiceMaintenanceSummary {
  const cleaningCompleted = requests
    .filter((r) => r.serviceType === "Cleaning" && r.status === "Completed")
    .map((r) => {
      const visit = parseDateOnly(r.scheduledVisitDate || r.updatedAt?.slice(0, 10));
      return visit;
    })
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime());

  const lastCleaningDate = cleaningCompleted[0] ? formatDateOnly(cleaningCompleted[0]) : null;
  let nextRecommendedCleaningDate: string | null = null;
  if (lastCleaningDate) {
    const next = parseDateOnly(lastCleaningDate)!;
    next.setMonth(next.getMonth() + CLEANING_INTERVAL_MONTHS);
    nextRecommendedCleaningDate = formatDateOnly(next);
  }

  const active = requests.find(
    (r) => r.status !== "Completed" && r.status !== "Cancelled"
  );
  const status = active
    ? active.status
    : lastCleaningDate
      ? "Up to date"
      : "No service history";

  const openRequestsCount = requests.filter(
    (r) => r.status !== "Completed" && r.status !== "Cancelled"
  ).length;

  return {
    lastCleaningDate,
    nextRecommendedCleaningDate,
    status,
    serviceStatus: status,
    openRequestsCount,
    latestRequest: requests[0] || null,
    availableServiceTypes: SERVICE_TYPES,
  };
}

export function buildEmptyServicePortalPayload(customerId: string) {
  const summary = buildServiceMaintenanceSummary([]);
  return {
    customerId,
    summary,
    requests: [] as ServiceRequestRecord[],
  };
}

export function isServiceRequestsTableMissingError(err: any): boolean {
  return (
    err?.code === "PGRST205" &&
    String(err?.message || "").toLowerCase().includes("service_requests")
  );
}
