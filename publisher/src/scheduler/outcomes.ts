/**
 * Publish outcome state machine.
 *
 * Rule: if the worker cannot prove the provider did NOT accept the post,
 * the job becomes `unknown` and MUST NOT be auto-republished.
 */

import type { JobStatus, PublishAttempt, PublishOutcome } from "../providers/types.ts";

export function jobStatusFromAttempt(attempt: PublishAttempt): JobStatus {
  switch (attempt.outcome) {
    case "accepted":
      return "published";
    case "provider_pending":
      return "provider_pending";
    case "failed":
      return "failed";
    case "unknown":
      return "unknown";
    default: {
      const _x: never = attempt.outcome;
      return _x;
    }
  }
}

export function mayStartNewPublishAttempt(status: JobStatus): boolean {
  return status === "scheduled" || status === "failed";
}

export function mayAutoRepublish(status: JobStatus): boolean {
  return status === "failed";
}

export function classifyTransportFailure(input: {
  requestSent: boolean;
  abortBeforeSend: boolean;
}): PublishOutcome {
  if (input.abortBeforeSend || !input.requestSent) return "failed";
  return "unknown";
}

export type AttemptRecord = {
  jobId: string;
  attemptNumber: number;
  idempotencyKey: string;
  startedAt: string;
  requestSentAt?: string;
  finishedAt?: string;
  outcome?: PublishOutcome;
  providerObjectId?: string;
};

export function nextIdempotencyKey(jobId: string, attemptNumber: number): string {
  return `${jobId}:${attemptNumber}`;
}
