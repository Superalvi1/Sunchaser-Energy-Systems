import { Lead, NetMeteringTracker, PaymentTrack, Project } from "../types";
import { NO_DATA } from "./clientPortalDisplay";
import {
  buildIndustrialTracker,
  buildResidentialTracker,
  type PortalTrackerType,
  type PortalProfileRecord,
  type FreeServiceSummary,
} from "./clientPortalPakistan";

export type TrackerStageStatus = "completed" | "active" | "pending";

export interface TrackerStage {
  id: string;
  label: string;
  status: TrackerStageStatus;
  date?: string | null;
}

export interface ClientPortalDashboard {
  systemSizeKw: number | null;
  projectStatus: string;
  quotationStatus: string;
  installationStatus: string;
  netMeteringStatus: string;
  warrantySummary: string;
  openTicketsCount: number;
  nextServiceDue: string;
  solarSavingsAnnual: string;
}

export interface ClientPortalPayload {
  customer: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    address?: string;
  } | null;
  lead: Lead | null;
  project: Project | null;
  dashboard: ClientPortalDashboard;
  tracker: {
    stages: TrackerStage[];
    progressPercent: number;
    trackerType?: PortalTrackerType;
  };
  portalProfile?: PortalProfileRecord | null;
  freeService?: FreeServiceSummary | null;
}

const STAGE_LABELS = [
  "Lead Created",
  "Site Survey",
  "Design Approval",
  "Quotation Approved",
  "Advance Received",
  "Equipment Procurement",
  "Installation Scheduled",
  "Installation Completed",
  "Net Metering Submitted",
  "Net Metering Approved",
  "Commissioned / Handover Completed",
] as const;

function fmtDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function stage(
  id: string,
  label: string,
  done: boolean,
  active: boolean,
  date?: string | null
): TrackerStage {
  return {
    id,
    label,
    status: done ? "completed" : active ? "active" : "pending",
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

export function buildClientPortalPayload(input: {
  customer: ClientPortalPayload["customer"];
  lead: Lead | null;
  project: Project | null;
  netMetering?: NetMeteringTracker | null;
  payment?: PaymentTrack | null;
  openTicketsCount?: number;
  trackerType?: PortalTrackerType;
}): ClientPortalPayload {
  const { customer, lead, project } = input;
  const netMetering = input.netMetering || null;
  const payment = input.payment || null;
  const openTicketsCount = input.openTicketsCount ?? 0;

  const quotes = lead?.quotes || [];
  const acceptedQuote = quotes.find((q) => q.status === "Accepted");
  const latestQuote = quotes.length > 0 ? quotes[quotes.length - 1] : null;
  const survey = lead?.survey;
  const installation = lead?.installation;

  const surveyDone = survey?.status === "Completed";
  const surveyActive =
    !!survey &&
    !surveyDone &&
    (survey.status === "In Progress" || survey.status === "Pending" || !!survey.scheduledDate);

  const quoteApproved = !!acceptedQuote;
  const advanceReceived = (payment?.advanceReceived || 0) > 0;
  const procurementDone = projectStageIndex(project?.stage) >= projectStageIndex("Material Procurement");
  const installationScheduled =
    installation?.status === "Scheduled" ||
    installation?.status === "In Progress" ||
    projectStageIndex(project?.stage) >= projectStageIndex("Structure Installation");
  const installationDone =
    lead?.status === "Installed" ||
    installation?.status === "Completed" ||
    projectStageIndex(project?.stage) >= projectStageIndex("Testing & Commissioning");
  const netMeteringSubmitted = !!netMetering?.applicationSubmitted;
  const netMeteringApproved =
    !!netMetering?.greenMeterActive || project?.stage === "Net Metering Approved";
  const commissioned =
    project?.stage === "Completed" ||
    (installationDone && netMeteringApproved);

  const trackerType = input.trackerType || "residential";
  const trackerBuilt =
    trackerType === "industrial"
      ? buildIndustrialTracker({ lead, project, netMetering, payment })
      : buildResidentialTracker({ lead, project, payment });
  const stages = trackerBuilt.stages;
  const progressPercent = trackerBuilt.progressPercent;

  const systemSizeKw =
    project?.systemSizekW ??
    acceptedQuote?.systemSizekW ??
    latestQuote?.systemSizekW ??
    null;

  const savingsNum = acceptedQuote?.estimatedAnnualSavings ?? latestQuote?.estimatedAnnualSavings;
  const solarSavingsAnnual =
    savingsNum != null && !Number.isNaN(Number(savingsNum))
      ? `Est. ${Number(savingsNum).toLocaleString()} / year`
      : NO_DATA;

  const dashboard: ClientPortalDashboard = {
    systemSizeKw,
    projectStatus: project?.stage || lead?.status || NO_DATA,
    quotationStatus: acceptedQuote
      ? "Approved"
      : latestQuote
        ? latestQuote.status
        : NO_DATA,
    installationStatus:
      installation?.status || (lead?.status === "Installed" ? "Completed" : NO_DATA),
    netMeteringStatus: netMeteringApproved
      ? "Approved"
      : netMeteringSubmitted
        ? "Submitted"
        : netMetering?.documentsCollected
          ? "Documents collected"
          : NO_DATA,
    warrantySummary: NO_DATA,
    openTicketsCount,
    nextServiceDue: NO_DATA,
    solarSavingsAnnual,
  };

  return {
    customer,
    lead,
    project,
    dashboard,
    tracker: { stages, progressPercent, trackerType },
  };
}
