import type { SocialProvider } from "../providers/SocialProvider.ts";
import type {
  ConnectedAccount,
  JobStatus,
  PublishJob,
  ProviderPublishHandle,
  ReconcileResult,
} from "../providers/types.ts";
import {
  DEFAULT_RECONCILE_POLICY,
  type ReconcilePolicy,
  type ReconcileTargetStatus,
} from "./types.ts";

export type ReconcileJobRecord = {
  job: PublishJob;
  status: JobStatus;
  account: ConnectedAccount;
  handle: ProviderPublishHandle;
  processingSince?: string;
  unknownSince?: string;
  pendingSince?: string;
};

export type ReconcileSkip = {
  skipped: true;
  reason: string;
  jobId: string;
};

export async function reconcileOne(
  provider: SocialProvider,
  record: ReconcileJobRecord,
  now = new Date(),
  policy: ReconcilePolicy = DEFAULT_RECONCILE_POLICY
): Promise<ReconcileResult | ReconcileSkip> {
  if (!isEligible(record.status)) {
    return { skipped: true, reason: `status ${record.status} is not eligible`, jobId: record.job.jobId };
  }

  if (record.status === "processing") {
    const since = record.processingSince ? new Date(record.processingSince).getTime() : 0;
    if (now.getTime() - since < policy.staleProcessingMs) {
      return { skipped: true, reason: "processing lock still fresh", jobId: record.job.jobId };
    }
  }
  if (record.status === "unknown") {
    const since = record.unknownSince ? new Date(record.unknownSince).getTime() : 0;
    if (now.getTime() - since < policy.unknownGraceMs) {
      return { skipped: true, reason: "unknown grace period", jobId: record.job.jobId };
    }
  }
  if (record.status === "provider_pending") {
    const since = record.pendingSince ? new Date(record.pendingSince).getTime() : now.getTime();
    if (now.getTime() - since > policy.pendingTimeoutMs) {
      return {
        decision: "manual_review",
        nextJobStatus: "needs_review",
        detail: "provider_pending exceeded timeout",
        republishAllowed: false,
      };
    }
  }

  const result = await provider.reconcilePublish(record.job, record.account, record.handle);
  if (result.republishAllowed !== false) {
    return {
      ...result,
      republishAllowed: false,
      detail: `${result.detail} (forced republishAllowed=false)`,
    };
  }
  return result;
}

function isEligible(status: JobStatus): status is ReconcileTargetStatus {
  return (
    status === "processing" ||
    status === "unknown" ||
    status === "failed" ||
    status === "provider_pending"
  );
}
