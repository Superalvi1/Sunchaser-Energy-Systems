import type { JobStatus, ReconcileDecision } from "../providers/types.ts";

export type ReconcileTargetStatus = Extract<
  JobStatus,
  "processing" | "unknown" | "failed" | "provider_pending"
>;

export const RECONCILE_ELIGIBLE: readonly ReconcileTargetStatus[] = [
  "processing",
  "unknown",
  "failed",
  "provider_pending",
] as const;

export type ReconcilePolicy = {
  /** Stale processing lock older than this is eligible. */
  staleProcessingMs: number;
  /** Unknown jobs wait this long before first reconcile. */
  unknownGraceMs: number;
  /** Stop polling provider_pending after this. */
  pendingTimeoutMs: number;
};

export const DEFAULT_RECONCILE_POLICY: ReconcilePolicy = {
  staleProcessingMs: 15 * 60 * 1000,
  unknownGraceMs: 2 * 60 * 1000,
  pendingTimeoutMs: 6 * 60 * 60 * 1000,
};

export function decisionToStatus(decision: ReconcileDecision): JobStatus {
  switch (decision) {
    case "definitely_published":
      return "published";
    case "definitely_failed":
      return "failed";
    case "still_processing":
      return "provider_pending";
    case "manual_review":
      return "needs_review";
    default: {
      const _x: never = decision;
      return _x;
    }
  }
}
