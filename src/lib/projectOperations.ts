import { isSuperAdmin } from "./roles";

export const PIPELINE_STAGES = [
  { key: "lead_won", label: "Lead Won" },
  { key: "quotation_approved", label: "Quotation Approved" },
  { key: "advance_received", label: "Advance Received" },
  { key: "site_survey", label: "Site Survey" },
  { key: "material_ordered", label: "Material Ordered" },
  { key: "installation_scheduled", label: "Installation Scheduled" },
  { key: "installation_completed", label: "Installation Completed" },
  { key: "inspection", label: "Inspection" },
  { key: "net_metering_submitted", label: "Net Metering Submitted" },
  { key: "net_metering_approved", label: "Net Metering Approved" },
  { key: "completed", label: "Completed" },
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];

export type KanbanColumnKey = "survey" | "procurement" | "installation" | "net_metering" | "completed";

export type DelayTone = "green" | "amber" | "red";

export type OperationsProjectCard = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  projectTitle: string;
  systemSizeKw: number | null;
  location: string | null;
  assignedTeam: string;
  assignedUserId: string | null;
  pipelineStage: PipelineStageKey;
  kanbanColumn: KanbanColumnKey;
  deliveryStatus: string;
  completionStage: string;
  daysInStage: number;
  delayTone: DelayTone;
  leadId: string | null;
  quotationId: string | null;
  updatedAt: string;
  createdAt: string;
  expectedInstallationDate: string | null;
  isOverdue: boolean;
};

export type ProjectOperationsDashboard = {
  summary: {
    projectsInProgress: number;
    waitingSurvey: number;
    waitingMaterial: number;
    waitingInstallation: number;
    waitingNetMetering: number;
    completedThisMonth: number;
    overdueProjects: number;
  };
  ceoSummary: {
    projectsActive: number;
    projectsDelayed: number;
    awaitingNetMetering: number;
    completedThisMonth: number;
    estimatedRevenueInProgress: number;
  };
  pipelineCounts: Record<PipelineStageKey, number>;
  kanban: Record<KanbanColumnKey, OperationsProjectCard[]>;
  delays: OperationsProjectCard[];
  teamPerformance: Array<{
    team: string;
    assigned: number;
    completed: number;
    avgCompletionDays: number | null;
  }>;
  projects: OperationsProjectCard[];
};

export type ProjectOperationsDetail = {
  project: OperationsProjectCard;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    email: string | null;
  } | null;
  equipment: {
    panels: string | null;
    inverter: string | null;
    battery: string | null;
  };
  timeline: Array<{
    id: string;
    previousStatus: string | null;
    newStatus: string;
    updatedBy: string | null;
    notes: string | null;
    createdAt: string;
  }>;
  links: {
    quotationId: string | null;
    leadId: string | null;
    customerId: string;
    invoiceIds: string[];
  };
  netMetering: {
    documentsCollected: boolean;
    applicationSubmitted: boolean;
    discoInspection: boolean;
    demandNotice: boolean;
    meterInstallation: boolean;
    greenMeterActive: boolean;
  } | null;
};

export function canViewProjectOperations(username: string, role: string): boolean {
  if (isSuperAdmin(username, role)) return true;
  const r = String(role || "");
  return ["Director", "Admin", "Accounts Manager", "Sales Manager"].includes(r);
}

export function isOperationsCeoMode(username: string, role: string): boolean {
  return isSuperAdmin(username, role) || role === "Director";
}

export function delayTone(days: number): DelayTone {
  if (days <= 7) return "green";
  if (days <= 14) return "amber";
  return "red";
}

export function daysSince(dateIso: string | null | undefined): number {
  if (!dateIso) return 0;
  const then = new Date(String(dateIso).slice(0, 10));
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86400000));
}
