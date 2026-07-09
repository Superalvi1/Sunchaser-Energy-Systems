export type WorkflowStatus = "running" | "waiting" | "completed" | "failed";

export type WorkflowContext = Record<string, unknown>;

export type ConditionExpression =
  | { op: "eq"; field: string; value: unknown }
  | { op: "neq"; field: string; value: unknown }
  | { op: "gt"; field: string; value: number }
  | { op: "gte"; field: string; value: number }
  | { op: "lt"; field: string; value: number }
  | { op: "lte"; field: string; value: number }
  | { op: "in"; field: string; values: unknown[] }
  | { op: "notIn"; field: string; values: unknown[] }
  | { op: "exists"; field: string }
  | { op: "notExists"; field: string }
  | { op: "contains"; field: string; value: unknown }
  | { op: "and"; expressions: ConditionExpression[] }
  | { op: "or"; expressions: ConditionExpression[] }
  | { op: "not"; expression: ConditionExpression };

export type BackoffStrategy = "fixed" | "linear" | "exponential";

export interface RetryPolicyConfig {
  maxAttempts: number;
  backoff: BackoffStrategy;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export type StepType = "trigger" | "condition" | "action" | "approval" | "delay";

interface StepBase {
  id: string;
  type: StepType;
  next?: string | null;
}

export interface TriggerStep extends StepBase {
  type: "trigger";
  event: string;
}

export interface ConditionStep extends StepBase {
  type: "condition";
  expression: ConditionExpression;
  onTrue?: string | null;
  onFalse?: string | null;
}

export interface ActionStep extends StepBase {
  type: "action";
  handler: string;
  input?: unknown;
  retry?: RetryPolicyConfig;
  onFailure?: string | null;
  escalationHandler?: string;
}

export interface ApprovalStep extends StepBase {
  type: "approval";
  approvers: string[];
  quorum?: number;
  timeoutMs?: number;
  onTimeout?: string | null;
  onRejected?: string | null;
  escalationHandler?: string;
}

export interface DelayStep extends StepBase {
  type: "delay";
  durationMs: number;
}

export type WorkflowStep = TriggerStep | ConditionStep | ActionStep | ApprovalStep | DelayStep;

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  startStepId: string;
  steps: WorkflowStep[];
}

export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalVote {
  approver: string;
  decision: ApprovalDecision;
  timestamp: number;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "timedOut";

export interface ApprovalState {
  stepId: string;
  approvers: string[];
  quorum: number;
  votes: ApprovalVote[];
  status: ApprovalStatus;
  requestedAt: number;
  timeoutMs?: number;
}

export interface DelayState {
  stepId: string;
  scheduledAt: number;
  resumeAt: number;
}

export interface PendingRetry {
  stepId: string;
  attempt: number;
  nextAttemptAt: number;
  lastError?: string;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  currentStepId: string | null;
  context: WorkflowContext;
  results: Record<string, unknown>;
  history: string[];
  pendingApproval?: ApprovalState;
  pendingDelay?: DelayState;
  pendingRetry?: PendingRetry;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEntry {
  seq: number;
  timestamp: number;
  instanceId: string;
  type: string;
  stepId?: string;
  data?: Record<string, unknown>;
}
