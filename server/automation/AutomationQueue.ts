/**
 * Automation job queue — retry-ready outbound action processing.
 */

import { AUTOMATION_DEFAULT_TIMESTAMP } from "./AutomationTrigger.ts";
import type { AutomationActionType } from "./AutomationAction.ts";

export const AUTOMATION_QUEUE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "dead_letter",
] as const;

export type AutomationQueueStatus = (typeof AUTOMATION_QUEUE_STATUSES)[number];

export type AutomationBackoffStrategy = "fixed" | "linear" | "exponential";

export interface AutomationRetryPolicy {
  maxAttempts: number;
  backoff: AutomationBackoffStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface AutomationQueueJob {
  id: string;
  companyId: string;
  ruleId: string;
  actionId: string;
  actionType: AutomationActionType;
  triggerEventId: string;
  status: AutomationQueueStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AutomationQueueJobInput = Omit<
  AutomationQueueJob,
  "status" | "attempts" | "nextRetryAt" | "lastError" | "createdAt" | "updatedAt"
> & {
  status?: AutomationQueueStatus;
  attempts?: number;
  nextRetryAt?: string | null;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const DEFAULT_AUTOMATION_RETRY_POLICY: AutomationRetryPolicy = {
  maxAttempts: 3,
  backoff: "exponential",
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
};

export function isAutomationQueueStatus(value: string): value is AutomationQueueStatus {
  return (AUTOMATION_QUEUE_STATUSES as readonly string[]).includes(value);
}

export function createAutomationQueueJob(input: AutomationQueueJobInput): AutomationQueueJob {
  const ts = input.createdAt ?? AUTOMATION_DEFAULT_TIMESTAMP;
  return {
    id: input.id.trim(),
    companyId: input.companyId.trim(),
    ruleId: input.ruleId.trim(),
    actionId: input.actionId.trim(),
    actionType: input.actionType,
    triggerEventId: input.triggerEventId.trim(),
    status: input.status ?? "pending",
    attempts: input.attempts ?? 0,
    maxAttempts: input.maxAttempts > 0 ? input.maxAttempts : DEFAULT_AUTOMATION_RETRY_POLICY.maxAttempts,
    nextRetryAt: input.nextRetryAt ?? null,
    lastError: String(input.lastError ?? "").trim(),
    payload: { ...(input.payload ?? {}) },
    createdAt: ts,
    updatedAt: input.updatedAt ?? ts,
  };
}

export function computeRetryDelayMs(
  attemptsMade: number,
  policy: AutomationRetryPolicy = DEFAULT_AUTOMATION_RETRY_POLICY
): number {
  let delay: number;
  switch (policy.backoff) {
    case "fixed":
      delay = policy.baseDelayMs;
      break;
    case "linear":
      delay = policy.baseDelayMs * attemptsMade;
      break;
    case "exponential":
      delay = policy.baseDelayMs * 2 ** Math.max(0, attemptsMade - 1);
      break;
    default:
      delay = policy.baseDelayMs;
  }
  return Math.min(Math.max(0, delay), policy.maxDelayMs);
}

export function shouldRetryJob(job: AutomationQueueJob): boolean {
  return job.attempts < job.maxAttempts && job.status !== "dead_letter" && job.status !== "completed";
}

export function scheduleJobRetry(
  job: AutomationQueueJob,
  error: string,
  nowMs: number,
  policy: AutomationRetryPolicy = DEFAULT_AUTOMATION_RETRY_POLICY
): AutomationQueueJob {
  const attempts = job.attempts + 1;
  const at = new Date(nowMs + computeRetryDelayMs(attempts, policy)).toISOString();
  const status: AutomationQueueStatus = attempts >= job.maxAttempts ? "dead_letter" : "failed";
  return {
    ...job,
    attempts,
    status: attempts >= job.maxAttempts ? "dead_letter" : status,
    nextRetryAt: attempts >= job.maxAttempts ? null : at,
    lastError: error,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function markJobRunning(job: AutomationQueueJob, nowMs: number): AutomationQueueJob {
  return { ...job, status: "running", updatedAt: new Date(nowMs).toISOString() };
}

export function markJobCompleted(job: AutomationQueueJob, nowMs: number): AutomationQueueJob {
  return {
    ...job,
    status: "completed",
    nextRetryAt: null,
    lastError: "",
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export class AutomationQueue {
  private jobs: AutomationQueueJob[] = [];

  enqueue(job: AutomationQueueJob): AutomationQueueJob {
    this.jobs.push({ ...job });
    return job;
  }

  list(): readonly AutomationQueueJob[] {
    return [...this.jobs];
  }

  listPending(nowMs: number): AutomationQueueJob[] {
    return this.jobs.filter((job) => {
      if (job.status === "pending") return true;
      if (job.status === "failed" && job.nextRetryAt) {
        return Date.parse(job.nextRetryAt) <= nowMs;
      }
      return false;
    });
  }

  update(job: AutomationQueueJob): void {
    const idx = this.jobs.findIndex((j) => j.id === job.id);
    if (idx === -1) throw new Error(`Queue job not found: ${job.id}`);
    this.jobs[idx] = { ...job };
  }

  get(id: string): AutomationQueueJob | null {
    return this.jobs.find((j) => j.id === id) ?? null;
  }

  get length(): number {
    return this.jobs.length;
  }
}

export function createAutomationQueue(): AutomationQueue {
  return new AutomationQueue();
}
