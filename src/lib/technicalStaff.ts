export const TECHNICAL_JOB_TYPES = [
  "Site Survey",
  "Installation",
  "Panel Cleaning",
  "Physical Inspection",
  "Battery Health Check",
  "Warranty Claim",
  "Breaker Replacement",
  "Inverter Fault",
  "Emergency Visit",
] as const;

export type TechnicalJobType = (typeof TECHNICAL_JOB_TYPES)[number];

export const TECHNICAL_JOB_STATUSES = [
  "Assigned",
  "En Route",
  "Started",
  "Completed",
  "Needs Follow-up",
] as const;

export type TechnicalJobStatus = (typeof TECHNICAL_JOB_STATUSES)[number];

export const TECHNICAL_STAFF_ROLES = [
  "Survey Engineer",
  "Installation Team",
  "Service Technician",
  "Technician",
] as const;

export type TechnicalStaffRole = (typeof TECHNICAL_STAFF_ROLES)[number];

export const SAFETY_CHECKLIST_ITEMS = [
  { key: "acBreakerChecked", label: "AC breaker checked" },
  { key: "dcBreakerChecked", label: "DC breaker checked" },
  { key: "earthingChecked", label: "Earthing checked" },
  { key: "inverterWorking", label: "Inverter working" },
  { key: "batteryChecked", label: "Battery charging/discharging checked" },
  { key: "dbPhotosUploaded", label: "DB photos uploaded" },
  { key: "customerBriefed", label: "Customer briefed" },
  { key: "siteCleaned", label: "Site cleaned" },
] as const;

export const EQUIPMENT_CAPTURE_TYPES = [
  "Panel",
  "Inverter",
  "Battery",
  "SPD",
  "Breaker",
  "Cable",
  "DB",
  "Earthing",
  "Structure",
] as const;

export function isTechnicalStaffRole(role: string): boolean {
  return (TECHNICAL_STAFF_ROLES as readonly string[]).includes(role);
}

export function isStaffWizardRole(role: string): boolean {
  return role !== "Customer" && !isTechnicalStaffRole(role);
}

export type TechnicalJobCard = {
  id: string;
  customerId: string | null;
  projectId: string | null;
  customerName: string;
  customerPhone: string;
  siteAddress: string;
  jobType: TechnicalJobType | string;
  priority: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  status: TechnicalJobStatus | string;
  assignedTechnician: string;
  assignedUserId: string | null;
  serviceRequestId?: string | null;
  warrantyClaimId?: string | null;
  supportTicketId?: string | null;
  notes?: string | null;
};

export type TechnicalJobsDashboard = {
  todayAssigned: number;
  pendingSurveys: number;
  installationTasks: number;
  serviceVisits: number;
  warrantyVisits: number;
  emergencyTickets: number;
  completedJobs: number;
  jobs: TechnicalJobCard[];
};
