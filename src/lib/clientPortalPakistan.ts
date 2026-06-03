import type { Lead, NetMeteringTracker, PaymentTrack, Project } from "../types";
import type { TrackerStage, TrackerStageStatus } from "./clientPortalTracker";

export type PortalTrackerType = "residential" | "industrial";

export const EQUIPMENT_TYPES = [
  { key: "solar_panels", label: "Solar Panels" },
  { key: "inverter", label: "Inverter" },
  { key: "battery", label: "Battery" },
  { key: "db_box", label: "DB Box" },
  { key: "breakers", label: "Breakers" },
  { key: "spd", label: "SPD" },
  { key: "changeover", label: "Changeover" },
  { key: "earthing", label: "Earthing" },
  { key: "cables", label: "Cables" },
  { key: "structure", label: "Structure" },
] as const;

export const INSTALLATION_PHOTO_CATEGORIES = [
  { key: "panels", label: "Panels" },
  { key: "inverter", label: "Inverter" },
  { key: "battery", label: "Battery" },
  { key: "db", label: "DB" },
  { key: "breakers", label: "Breakers" },
  { key: "earthing", label: "Earthing" },
  { key: "cable_routing", label: "Cable routing" },
  { key: "structure", label: "Structure" },
  { key: "final_site", label: "Final site photo" },
] as const;

export const AFTER_SALES_SERVICE_TYPES = [
  "Breaker changed",
  "DC cable replaced",
  "AC cable replaced",
  "SPD replaced",
  "DB tightening",
  "Earthing checked",
  "Inverter setting changed",
  "Battery setting changed",
  "Panel cleaning",
  "Fault resolved",
  "Net metering visit",
  "Monitoring app setup",
] as const;

export interface PortalProfileRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  trackerType: PortalTrackerType;
  freeServiceStartDate?: string | null;
  freeServiceEndDate?: string | null;
  freeServiceMonths: number;
  freeServiceStatus: string;
  nextRecommendedServiceDate?: string | null;
}

export interface EquipmentRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  equipmentType: string;
  equipmentLabel?: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  quantity: number;
  installationDate?: string | null;
  warrantyStart?: string | null;
  warrantyEnd?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
}

export interface InstallationPhotoRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  photoCategory: string;
  categoryLabel?: string;
  photoUrl: string;
  caption?: string | null;
  uploadedBy?: string | null;
  voiceNoteUrl?: string | null;
  createdAt: string;
}

export interface AfterSalesServiceLogRecord {
  id: string;
  customerId: string;
  projectId?: string | null;
  serviceType: string;
  componentChanged?: string | null;
  oldComponentDetails?: string | null;
  newComponentDetails?: string | null;
  quantity: number;
  reason?: string | null;
  technicianName?: string | null;
  serviceDate: string;
  underFreeService: boolean;
  chargeAmount: number;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  customerVisibleNotes?: string | null;
  internalNotes?: string | null;
  voiceNoteUrl?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface FreeServiceSummary {
  status: string;
  coveredUntil: string | null;
  servicesUsed: number;
  usageBreakdown: { serviceType: string; count: number }[];
}

function fmtDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function mkStage(
  id: string,
  label: string,
  done: boolean,
  active: boolean,
  date?: string | null
): TrackerStage {
  return {
    id,
    label,
    status: (done ? "completed" : active ? "active" : "pending") as TrackerStageStatus,
    date: done || active ? fmtDate(date) : null,
  };
}

const PROJECT_STAGE_ORDER = [
  "Advance Received",
  "Material Procurement",
  "Structure Installation",
  "Panel Installation",
  "Inverter Installation",
  "Testing & Commissioning",
  "Net Metering Approved",
  "Completed",
];

function projectStageIndex(stageName?: string): number {
  if (!stageName) return -1;
  return PROJECT_STAGE_ORDER.indexOf(stageName);
}

export function equipmentLabel(type: string): string {
  return EQUIPMENT_TYPES.find((e) => e.key === type)?.label || type;
}

export function photoCategoryLabel(cat: string): string {
  return INSTALLATION_PHOTO_CATEGORIES.find((c) => c.key === cat)?.label || cat;
}

export function mapPortalProfileRow(row: any): PortalProfileRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    trackerType: row.tracker_type === "industrial" ? "industrial" : "residential",
    freeServiceStartDate: row.free_service_start_date,
    freeServiceEndDate: row.free_service_end_date,
    freeServiceMonths: Number(row.free_service_months || 6),
    freeServiceStatus: row.free_service_status || "Not Started",
    nextRecommendedServiceDate: row.next_recommended_service_date,
  };
}

export function mapEquipmentRow(row: any): EquipmentRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    equipmentType: row.equipment_type,
    equipmentLabel: equipmentLabel(row.equipment_type),
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number,
    quantity: Number(row.quantity || 1),
    installationDate: row.installation_date,
    warrantyStart: row.warranty_start,
    warrantyEnd: row.warranty_end,
    photoUrl: row.photo_url,
    notes: row.notes,
  };
}

export function mapInstallationPhotoRow(row: any): InstallationPhotoRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    photoCategory: row.photo_category,
    categoryLabel: photoCategoryLabel(row.photo_category),
    photoUrl: row.photo_url,
    caption: row.caption,
    uploadedBy: row.uploaded_by,
    voiceNoteUrl: row.voice_note_url,
    createdAt: row.created_at,
  };
}

export function mapAfterSalesLogRow(row: any, staffView = false): AfterSalesServiceLogRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    projectId: row.project_id,
    serviceType: row.service_type,
    componentChanged: row.component_changed,
    oldComponentDetails: staffView ? row.old_component_details : undefined,
    newComponentDetails: row.new_component_details,
    quantity: Number(row.quantity || 1),
    reason: staffView ? row.reason : undefined,
    technicianName: row.technician_name,
    serviceDate: row.service_date,
    underFreeService: !!row.under_free_service,
    chargeAmount: Number(row.charge_amount || 0),
    beforePhotoUrl: row.before_photo_url,
    afterPhotoUrl: row.after_photo_url,
    customerVisibleNotes: row.customer_visible_notes,
    internalNotes: staffView ? row.internal_notes : undefined,
    voiceNoteUrl: row.voice_note_url,
    createdBy: staffView ? row.created_by : undefined,
    createdAt: row.created_at,
  };
}

export function computeFreeServiceSummary(
  profile: PortalProfileRecord | null,
  logs: AfterSalesServiceLogRecord[]
): FreeServiceSummary {
  const today = new Date().toISOString().slice(0, 10);
  let status = profile?.freeServiceStatus || "Not Started";
  const end = profile?.freeServiceEndDate || null;
  if (end && end < today) status = "Expired";
  else if (profile?.freeServiceStartDate && (!end || end >= today)) status = "Active";

  const counts: Record<string, number> = {};
  for (const log of logs) {
    counts[log.serviceType] = (counts[log.serviceType] || 0) + 1;
  }
  const usageBreakdown = Object.entries(counts).map(([serviceType, count]) => ({ serviceType, count }));

  return {
    status,
    coveredUntil: end,
    servicesUsed: logs.length,
    usageBreakdown,
  };
}

export function buildResidentialTracker(input: {
  lead: Lead | null;
  project: Project | null;
  payment?: PaymentTrack | null;
}): { stages: TrackerStage[]; progressPercent: number } {
  const { lead, project, payment } = input;
  const quotes = lead?.quotes || [];
  const acceptedQuote = quotes.find((q) => q.status === "Accepted");
  const quoteApproved = !!acceptedQuote;
  const paymentReceived = (payment?.advanceReceived || 0) > 0;
  const installationDone =
    lead?.status === "Installed" ||
    lead?.installation?.status === "Completed" ||
    projectStageIndex(project?.stage) >= projectStageIndex("Testing & Commissioning");
  const afterSalesActive =
    project?.stage === "Completed" || installationDone;

  const stages: TrackerStage[] = [
    mkStage("quotation-approved", "Quotation Approved", quoteApproved, !quoteApproved && !!quotes.length, acceptedQuote?.createdAt),
    mkStage("payment-received", "Payment Received", paymentReceived, quoteApproved && !paymentReceived, null),
    mkStage("installation-completed", "Installation Completed", installationDone, paymentReceived && !installationDone, project?.updatedAt),
    mkStage("after-sales-active", "After-Sales Active", afterSalesActive, installationDone && !afterSalesActive, project?.updatedAt),
  ];
  const completed = stages.filter((s) => s.status === "completed").length;
  return { stages, progressPercent: Math.round((completed / stages.length) * 100) };
}

export function buildIndustrialTracker(input: {
  lead: Lead | null;
  project: Project | null;
  netMetering?: NetMeteringTracker | null;
  payment?: PaymentTrack | null;
}): { stages: TrackerStage[]; progressPercent: number } {
  const { lead, project, netMetering, payment } = input;
  const survey = lead?.survey;
  const surveyDone = survey?.status === "Completed";
  const quoteApproved = !!(lead?.quotes || []).find((q) => q.status === "Accepted");
  const advancePaid = (payment?.advanceReceived || 0) > 0;
  const pIdx = projectStageIndex(project?.stage);
  const procurementDone = pIdx >= projectStageIndex("Material Procurement");
  const structureDone = pIdx >= projectStageIndex("Structure Installation");
  const panelDone = pIdx >= projectStageIndex("Panel Installation");
  const inverterDone = pIdx >= projectStageIndex("Inverter Installation");
  const testingDone = pIdx >= projectStageIndex("Testing & Commissioning");
  const commissioned = project?.stage === "Completed" || (testingDone && !!netMetering?.greenMeterActive);
  const handover = commissioned || project?.stage === "Net Metering Approved";

  const stages: TrackerStage[] = [
    mkStage("site-survey", "Site Survey", surveyDone, !!survey && !surveyDone, survey?.scheduledDate),
    mkStage("engineering-design", "Engineering Design", surveyDone, surveyDone && !quoteApproved, null),
    mkStage("design-approval", "Design Approval", quoteApproved, surveyDone && !quoteApproved, null),
    mkStage("advance-payment", "Advance Payment", advancePaid, quoteApproved && !advancePaid, null),
    mkStage("equipment-procurement", "Equipment Procurement", procurementDone, advancePaid && !procurementDone, project?.updatedAt),
    mkStage("structure-installation", "Structure Installation", structureDone, procurementDone && !structureDone, project?.updatedAt),
    mkStage("panel-installation", "Panel Installation", panelDone, structureDone && !panelDone, project?.updatedAt),
    mkStage("inverter-installation", "Inverter Installation", inverterDone, panelDone && !inverterDone, project?.updatedAt),
    mkStage("testing", "Testing", testingDone, inverterDone && !testingDone, project?.updatedAt),
    mkStage("commissioning", "Commissioning", commissioned, testingDone && !commissioned, project?.updatedAt),
    mkStage("net-metering-handover", "Net Metering / Handover", handover, commissioned && !handover, project?.updatedAt),
  ];
  const completed = stages.filter((s) => s.status === "completed").length;
  return { stages, progressPercent: Math.round((completed / stages.length) * 100) };
}

export function isPakistanAftersalesTableMissingError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.code === "PGRST205" &&
    (msg.includes("customer_portal_profiles") ||
      msg.includes("customer_equipment") ||
      msg.includes("installation_photos") ||
      msg.includes("after_sales_service_logs"))
  );
}
