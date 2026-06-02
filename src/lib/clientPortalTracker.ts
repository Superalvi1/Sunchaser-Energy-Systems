import { Lead, NetMeteringTracker, PaymentTrack, Project } from "../types";

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
  };
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

  const stages: TrackerStage[] = [
    stage("lead-created", STAGE_LABELS[0], !!lead, false, lead?.createdAt),
    stage("site-survey", STAGE_LABELS[1], surveyDone, surveyActive, survey?.scheduledDate),
    stage("design-approval", STAGE_LABELS[2], surveyDone, surveyActive && !surveyDone, survey?.scheduledDate),
    stage("quotation-approved", STAGE_LABELS[3], quoteApproved, !!latestQuote && !quoteApproved, acceptedQuote?.createdAt || latestQuote?.createdAt),
    stage("advance-received", STAGE_LABELS[4], advanceReceived, quoteApproved && !advanceReceived, null),
    stage("equipment-procurement", STAGE_LABELS[5], procurementDone, advanceReceived && !procurementDone, project?.updatedAt),
    stage("installation-scheduled", STAGE_LABELS[6], installationScheduled, procurementDone && !installationScheduled, installation?.scheduledDate),
    stage("installation-completed", STAGE_LABELS[7], installationDone, installationScheduled && !installationDone, project?.updatedAt),
    stage("net-metering-submitted", STAGE_LABELS[8], netMeteringSubmitted, installationDone && !netMeteringSubmitted, null),
    stage("net-metering-approved", STAGE_LABELS[9], netMeteringApproved, netMeteringSubmitted && !netMeteringApproved, null),
    stage("commissioned", STAGE_LABELS[10], commissioned, netMeteringApproved && !commissioned, project?.updatedAt),
  ];

  const completedCount = stages.filter((s) => s.status === "completed").length;
  const progressPercent = Math.round((completedCount / stages.length) * 100);

  const systemSizeKw =
    project?.systemSizekW ??
    acceptedQuote?.systemSizekW ??
    latestQuote?.systemSizekW ??
    null;

  const dashboard: ClientPortalDashboard = {
    systemSizeKw,
    projectStatus: project?.stage || lead?.status || "Not available yet",
    quotationStatus: acceptedQuote
      ? "Approved"
      : latestQuote
        ? latestQuote.status
        : "Pending",
    installationStatus: installation?.status || (lead?.status === "Installed" ? "Completed" : "Not available yet"),
    netMeteringStatus: netMeteringApproved
      ? "Approved"
      : netMeteringSubmitted
        ? "Submitted"
        : netMetering?.documentsCollected
          ? "Documents collected"
          : "Pending",
    warrantySummary: "Warranty details will appear here once your system is commissioned.",
    openTicketsCount,
    nextServiceDue: "Next service schedule will be shared after handover.",
  };

  return {
    customer,
    lead,
    project,
    dashboard,
    tracker: { stages, progressPercent },
  };
}
