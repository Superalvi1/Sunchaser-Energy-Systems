export const SUPPORT_CATEGORIES = [
  "Inverter Fault",
  "Battery Issue",
  "Low Generation",
  "Cleaning Request",
  "Net Metering Issue",
  "Monitoring Offline",
  "Warranty Follow-up",
  "Billing Issue",
  "General Inquiry",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_PRIORITIES = ["Low", "Medium", "High", "Emergency"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_STATUSES = [
  "New",
  "In Review",
  "Technician Assigned",
  "Visit Scheduled",
  "In Progress",
  "Resolved",
  "Closed",
] as const;

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export interface SupportTicketUpdate {
  id: string;
  ticketId: string;
  status?: string | null;
  note?: string | null;
  visibility: "customer" | "internal" | "system";
  createdBy: string;
  createdAt: string;
}

export interface SupportTicketRecord {
  id: string;
  ticketNumber: string;
  customerId?: string | null;
  customerName: string;
  email: string;
  category: string;
  priority: SupportPriority | string;
  subject: string;
  description: string;
  faultCode?: string | null;
  photoUrl?: string | null;
  preferredVisitDate?: string | null;
  assignedTechnician?: string | null;
  scheduledVisitDate?: string | null;
  status: SupportStatus | string;
  customerVisibleNotes?: string | null;
  internalNotes?: string | null;
  resolutionSummary?: string | null;
  createdAt: string;
  updatedAt: string;
  timeline: SupportTicketUpdate[];
}

export function ticketNumberFromId(id: string): string {
  const suffix = id.replace(/^ticket-st-/i, "").slice(-8).toUpperCase();
  return `ST-${suffix}`;
}

export function mapSupportTicketRow(row: any, timeline: SupportTicketUpdate[] = []): SupportTicketRecord {
  return {
    id: row.id,
    ticketNumber: ticketNumberFromId(row.id),
    customerId: row.customer_id,
    customerName: row.customer_name,
    email: row.email,
    category: row.category || "General Inquiry",
    priority: row.priority || "Medium",
    subject: row.subject,
    description: row.description || "",
    faultCode: row.fault_code,
    photoUrl: row.photo_url,
    preferredVisitDate: row.preferred_visit_date,
    assignedTechnician: row.assigned_technician,
    scheduledVisitDate: row.scheduled_visit_date,
    status: row.status || "New",
    customerVisibleNotes: row.customer_visible_notes,
    internalNotes: row.internal_notes,
    resolutionSummary: row.resolution_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    timeline,
  };
}

export function mapSupportTicketUpdateRow(row: any): SupportTicketUpdate {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    status: row.status,
    note: row.note,
    visibility: row.visibility,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function customerTimeline(updates: SupportTicketUpdate[]): SupportTicketUpdate[] {
  return updates.filter((u) => u.visibility === "customer" || u.visibility === "system");
}
