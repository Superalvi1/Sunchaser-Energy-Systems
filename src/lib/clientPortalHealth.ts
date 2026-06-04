import type { ClientPortalPayload } from "./clientPortalTracker";
import { displayOrNoData } from "./clientPortalDisplay";

export type HealthMetric = {
  id: string;
  label: string;
  value: string;
  status: "good" | "warn" | "neutral" | "pending";
};

function statusFromText(text: string): HealthMetric["status"] {
  const t = text.toLowerCase();
  if (/active|approved|complete|good|healthy|paid/i.test(t)) return "good";
  if (/due|pending|progress|partial|expir|soon/i.test(t)) return "warn";
  if (/no data|—|unknown|n\/a/i.test(t)) return "neutral";
  return "pending";
}

export function buildCustomerHealthMetrics(
  data: ClientPortalPayload | null,
  extras?: {
    systemHealthLabel?: string;
    warrantyLabel?: string;
    serviceDue?: string;
    netMetering?: string;
  }
): HealthMetric[] {
  const dash = data?.dashboard;
  const systemHealth =
    extras?.systemHealthLabel ||
    (dash?.installationStatus?.toLowerCase().includes("complete")
      ? "System operational"
      : dash?.installationStatus || "Monitoring");
  const warranty =
    extras?.warrantyLabel || dash?.warrantySummary || "—";
  const serviceDue = extras?.serviceDue || dash?.nextServiceDue || "—";
  const netMetering =
    extras?.netMetering || dash?.netMeteringStatus || "—";

  return [
    { id: "system", label: "System Health", value: displayOrNoData(systemHealth), status: statusFromText(systemHealth) },
    { id: "warranty", label: "Warranty Status", value: displayOrNoData(warranty), status: statusFromText(warranty) },
    { id: "service", label: "Service Due Date", value: displayOrNoData(serviceDue), status: statusFromText(serviceDue) },
    { id: "netmeter", label: "Net Metering Status", value: displayOrNoData(netMetering), status: statusFromText(netMetering) },
  ];
}

export function healthScorePercent(metrics: HealthMetric[]): number {
  const weights = { good: 25, warn: 12, pending: 8, neutral: 10 };
  const sum = metrics.reduce((acc, m) => acc + (weights[m.status] || 10), 0);
  return Math.min(100, Math.round(sum));
}
