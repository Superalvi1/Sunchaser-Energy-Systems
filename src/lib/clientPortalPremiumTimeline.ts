import type { ClientPortalPayload } from "./clientPortalTracker";
import type { TrackerStageStatus } from "./clientPortalTracker";

export type PremiumTimelineStage = {
  id: string;
  label: string;
  status: TrackerStageStatus;
  date?: string | null;
};

const PREMIUM_LABELS = [
  "Quotation Approved",
  "Advance Received",
  "Material Delivered",
  "Installation Started",
  "Installation Completed",
  "Net Metering",
  "Warranty Active",
] as const;

function stageStatus(done: boolean, active: boolean): TrackerStageStatus {
  if (done) return "completed";
  if (active) return "active";
  return "pending";
}

function findTrackerDate(stages: { label: string; date?: string | null }[], needles: string[]): string | null {
  const hit = stages.find((s) => needles.some((n) => s.label.toLowerCase().includes(n.toLowerCase())));
  return hit?.date || null;
}

/** Client-side premium 7-step timeline (no backend change). */
export function buildPremiumProjectTimeline(
  data: ClientPortalPayload | null,
  delivery?: { progress?: { steps?: { label: string; status: string }[] } } | null
): PremiumTimelineStage[] {
  const tracker = data?.tracker?.stages || [];
  const dash = data?.dashboard;
  const lead = data?.lead;
  const project = data?.project;

  const quoteDone =
    dash?.quotationStatus?.toLowerCase().includes("approv") ||
    tracker.some((s) => s.status === "completed" && /quot/i.test(s.label));
  const advanceDone =
    tracker.some((s) => s.status === "completed" && /payment|advance/i.test(s.label)) ||
    dash?.installationStatus?.toLowerCase().includes("progress");
  const materialDone =
    tracker.some((s) => s.status === "completed" && /procurement|material|equipment/i.test(s.label)) ||
    project?.stage === "Material Procurement" ||
    (delivery?.progress?.steps || []).some(
      (s) => /material|deliver/i.test(s.label) && s.status === "completed"
    );
  const installStarted =
    tracker.some((s) => s.status === "completed" && /install.*start|structure|panel/i.test(s.label)) ||
    ["Structure Installation", "Panel Installation", "Inverter Installation", "Testing & Commissioning"].includes(
      project?.stage || ""
    );
  const installDone =
    dash?.installationStatus?.toLowerCase().includes("complete") ||
    lead?.status === "Installed" ||
    tracker.some((s) => s.status === "completed" && /installation completed|commission/i.test(s.label));
  const netMeterDone =
    dash?.netMeteringStatus?.toLowerCase().includes("approv") ||
    tracker.some((s) => s.status === "completed" && /net meter/i.test(s.label));
  const warrantyDone =
    dash?.warrantySummary?.toLowerCase().includes("active") ||
    installDone && netMeterDone;

  const flags = [quoteDone, advanceDone, materialDone, installStarted, installDone, netMeterDone, warrantyDone];
  const firstPending = flags.findIndex((f) => !f);

  return PREMIUM_LABELS.map((label, i) => {
    const done = flags[i];
    const active = !done && (firstPending === -1 ? false : i === firstPending);
    const dateMap: Record<string, string[]> = {
      "Quotation Approved": ["quot", "approv"],
      "Advance Received": ["payment", "advance"],
      "Material Delivered": ["procurement", "material"],
      "Installation Started": ["install", "structure", "panel"],
      "Installation Completed": ["installation completed", "commission"],
      "Net Metering": ["net meter"],
      "Warranty Active": ["warranty", "handover"],
    };
    return {
      id: `premium-${i}`,
      label,
      status: stageStatus(done, active),
      date: findTrackerDate(tracker, dateMap[label] || []),
    };
  });
}

export function premiumTimelinePercent(stages: PremiumTimelineStage[]): number {
  const done = stages.filter((s) => s.status === "completed").length;
  return Math.round((done / stages.length) * 100);
}
