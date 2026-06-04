import type { ClientPortalPayload } from "./clientPortalTracker";

export function isProjectCompleted(
  data: ClientPortalPayload | null,
  delivery?: {
    handoverComplete?: boolean;
    delivery?: { deliveryStatus?: string; completionStage?: string };
    progress?: { steps?: { label: string; status: string }[] };
  } | null
): boolean {
  if (delivery?.handoverComplete) return true;
  const status = String(delivery?.delivery?.deliveryStatus || "").toLowerCase();
  if (status.includes("complete") || status.includes("handover")) return true;
  const stage = String(delivery?.delivery?.completionStage || "").toLowerCase();
  if (stage.includes("handover") || stage.includes("complete")) return true;

  const pct = data?.tracker?.progressPercent ?? 0;
  if (pct >= 100) return true;

  const stages = data?.tracker?.stages || [];
  return stages.some(
    (s) =>
      s.status === "completed" &&
      (s.label.toLowerCase().includes("handover") ||
        s.label.toLowerCase().includes("commissioned"))
  );
}

export function projectStatusHeadline(data: ClientPortalPayload | null): string {
  const stages = data?.tracker?.stages || [];
  const active = stages.find((s) => s.status === "active");
  if (active) return active.label;
  const lastDone = [...stages].reverse().find((s) => s.status === "completed");
  if (lastDone) return lastDone.label;
  return data?.dashboard?.projectStatus || "Your project is being prepared";
}
