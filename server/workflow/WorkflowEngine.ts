import type {
  ApprovalDecision,
  ApprovalStep,
  ActionStep,
  ConditionStep,
  DelayStep,
  TriggerStep,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStep,
} from "./types.ts";
import type { Clock } from "./Clock.ts";
import { AuditLog } from "./AuditLog.ts";
import { ActionHandlerRegistry } from "./ActionHandlerRegistry.ts";
import { ApprovalManager } from "./ApprovalManager.ts";
import { DelayScheduler } from "./DelayScheduler.ts";
import { EscalationManager } from "./EscalationManager.ts";
import { RetryPolicy } from "./RetryPolicy.ts";
import { evaluateCondition } from "./ConditionEvaluator.ts";
import { InvalidTransitionError, UnknownStepError, WorkflowDefinitionError, WorkflowError } from "./errors.ts";

export interface WorkflowEngineOptions {
  clock: Clock;
  audit: AuditLog;
  actions: ActionHandlerRegistry;
  random?: () => number;
  maxStepsPerRun?: number;
}

const DEFAULT_MAX_STEPS_PER_RUN = 10_000;

let instanceCounter = 0;

export class WorkflowEngine {
  private readonly clock: Clock;
  private readonly audit: AuditLog;
  private readonly actions: ActionHandlerRegistry;
  private readonly approvals: ApprovalManager;
  private readonly delays: DelayScheduler;
  private readonly escalations: EscalationManager;
  private readonly random: () => number;
  private readonly maxStepsPerRun: number;

  constructor(options: WorkflowEngineOptions) {
    this.clock = options.clock;
    this.audit = options.audit;
    this.actions = options.actions;
    this.approvals = new ApprovalManager(this.clock);
    this.delays = new DelayScheduler(this.clock);
    this.escalations = new EscalationManager(this.actions, this.audit);
    this.random = options.random ?? Math.random;
    this.maxStepsPerRun = options.maxStepsPerRun ?? DEFAULT_MAX_STEPS_PER_RUN;
  }

  static validateDefinition(definition: WorkflowDefinition): void {
    const ids = new Set<string>();
    for (const step of definition.steps) {
      if (ids.has(step.id)) {
        throw new WorkflowDefinitionError(`Duplicate step id: "${step.id}"`);
      }
      ids.add(step.id);
    }
    if (!ids.has(definition.startStepId)) {
      throw new WorkflowDefinitionError(
        `startStepId "${definition.startStepId}" is not a defined step`
      );
    }
    const referenced: Array<string | null | undefined> = [];
    for (const step of definition.steps) {
      referenced.push(step.next);
      if (step.type === "condition") {
        referenced.push(step.onTrue, step.onFalse);
      }
      if (step.type === "action") {
        referenced.push(step.onFailure);
      }
      if (step.type === "approval") {
        referenced.push(step.onTimeout, step.onRejected);
      }
    }
    for (const ref of referenced) {
      if (ref && !ids.has(ref)) {
        throw new WorkflowDefinitionError(`Reference to unknown step id: "${ref}"`);
      }
    }
  }

  private getStep(definition: WorkflowDefinition, stepId: string): WorkflowStep {
    const step = definition.steps.find((s) => s.id === stepId);
    if (!step) throw new UnknownStepError(stepId);
    return step;
  }

  private scope(instance: WorkflowInstance): Record<string, unknown> {
    return { ...instance.context, results: instance.results };
  }

  async start(
    definition: WorkflowDefinition,
    context: WorkflowContext = {},
    instanceId?: string
  ): Promise<WorkflowInstance> {
    WorkflowEngine.validateDefinition(definition);
    instanceCounter += 1;
    const now = this.clock.now();
    const instance: WorkflowInstance = {
      id: instanceId ?? `wfi-${instanceCounter}`,
      workflowId: definition.id,
      status: "running",
      currentStepId: definition.startStepId,
      context: { ...context },
      results: {},
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    this.audit.record(instance.id, "workflow.started", undefined, { workflowId: definition.id });
    return this.advance(instance, definition);
  }

  async tick(instance: WorkflowInstance, definition: WorkflowDefinition): Promise<WorkflowInstance> {
    if (instance.status !== "waiting") return instance;

    if (instance.pendingDelay) {
      if (this.delays.isDue(instance.pendingDelay)) {
        const step = this.getStep(definition, instance.pendingDelay.stepId) as DelayStep;
        this.audit.record(instance.id, "delay.resumed", step.id);
        instance.pendingDelay = undefined;
        instance.status = "running";
        instance.currentStepId = step.next ?? null;
        return this.advance(instance, definition);
      }
      return instance;
    }

    if (instance.pendingRetry) {
      if (this.clock.now() >= instance.pendingRetry.nextAttemptAt) {
        instance.status = "running";
        return this.advance(instance, definition);
      }
      return instance;
    }

    if (instance.pendingApproval) {
      if (this.approvals.isTimedOut(instance.pendingApproval)) {
        const step = this.getStep(definition, instance.pendingApproval.stepId) as ApprovalStep;
        this.audit.record(instance.id, "approval.timedOut", step.id);
        instance.pendingApproval = undefined;
        await this.escalations.escalate({
          instanceId: instance.id,
          stepId: step.id,
          reason: "approvalTimeout",
          handler: step.escalationHandler,
          context: this.scope(instance) as WorkflowContext,
        });
        instance.status = "running";
        instance.currentStepId = step.onTimeout ?? null;
        return this.advance(instance, definition);
      }
      return instance;
    }

    return instance;
  }

  async decide(
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
    approver: string,
    decision: ApprovalDecision
  ): Promise<WorkflowInstance> {
    if (!instance.pendingApproval) {
      throw new InvalidTransitionError(`Instance "${instance.id}" has no pending approval`);
    }
    const step = this.getStep(definition, instance.pendingApproval.stepId) as ApprovalStep;
    const state = this.approvals.vote(instance.pendingApproval, approver, decision);
    instance.pendingApproval = state.status === "pending" ? state : undefined;
    this.audit.record(instance.id, "approval.voted", step.id, {
      approver,
      decision,
      status: state.status,
    });

    if (state.status === "pending") {
      return instance;
    }

    if (state.status === "approved") {
      instance.status = "running";
      instance.currentStepId = step.next ?? null;
      return this.advance(instance, definition);
    }

    this.audit.record(instance.id, "approval.rejected", step.id);
    await this.escalations.escalate({
      instanceId: instance.id,
      stepId: step.id,
      reason: "approvalRejected",
      handler: step.escalationHandler,
      context: this.scope(instance) as WorkflowContext,
    });
    instance.status = "running";
    instance.currentStepId = step.onRejected ?? null;
    return this.advance(instance, definition);
  }

  private async advance(
    instance: WorkflowInstance,
    definition: WorkflowDefinition
  ): Promise<WorkflowInstance> {
    let steps = 0;
    while (instance.status === "running") {
      steps += 1;
      if (steps > this.maxStepsPerRun) {
        throw new WorkflowError(
          `Exceeded ${this.maxStepsPerRun} step transitions in a single run — check for an unguarded cycle in the workflow definition`
        );
      }

      if (!instance.currentStepId) {
        instance.status = "completed";
        instance.updatedAt = this.clock.now();
        this.audit.record(instance.id, "workflow.completed");
        break;
      }

      const step = this.getStep(definition, instance.currentStepId);
      instance.history.push(step.id);

      if (step.type === "trigger") {
        this.processTrigger(instance, step);
      } else if (step.type === "condition") {
        this.processCondition(instance, step);
      } else if (step.type === "action") {
        await this.processAction(instance, step);
      } else if (step.type === "approval") {
        this.processApproval(instance, step);
      } else if (step.type === "delay") {
        this.processDelay(instance, step);
      }

      instance.updatedAt = this.clock.now();
    }
    return instance;
  }

  private processTrigger(instance: WorkflowInstance, step: TriggerStep): void {
    this.audit.record(instance.id, "trigger.fired", step.id, { event: step.event });
    instance.currentStepId = step.next ?? null;
  }

  private processCondition(instance: WorkflowInstance, step: ConditionStep): void {
    const result = evaluateCondition(step.expression, this.scope(instance));
    this.audit.record(instance.id, "condition.evaluated", step.id, { result });
    const target = result ? step.onTrue ?? step.next : step.onFalse ?? step.next;
    instance.currentStepId = target ?? null;
  }

  private processApproval(instance: WorkflowInstance, step: ApprovalStep): void {
    const state = this.approvals.request(step.id, step.approvers, step.quorum, step.timeoutMs);
    instance.pendingApproval = state;
    instance.status = "waiting";
    this.audit.record(instance.id, "approval.requested", step.id, {
      approvers: step.approvers,
      quorum: state.quorum,
    });
  }

  private processDelay(instance: WorkflowInstance, step: DelayStep): void {
    const state = this.delays.schedule(step.id, step.durationMs);
    instance.pendingDelay = state;
    instance.status = "waiting";
    this.audit.record(instance.id, "delay.scheduled", step.id, { durationMs: step.durationMs });
  }

  private async processAction(instance: WorkflowInstance, step: ActionStep): Promise<void> {
    const attempt =
      (instance.pendingRetry?.stepId === step.id ? instance.pendingRetry.attempt : 0) + 1;
    instance.pendingRetry = undefined;
    try {
      const result = await this.actions.invoke(
        step.handler,
        step.input,
        this.scope(instance) as WorkflowContext
      );
      instance.results[step.id] = result;
      this.audit.record(instance.id, "action.succeeded", step.id, { attempt });
      instance.currentStepId = step.next ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.audit.record(instance.id, "action.failed", step.id, { attempt, error: message });
      const policy = step.retry ? new RetryPolicy(step.retry) : undefined;
      if (policy && policy.shouldRetry(attempt)) {
        const delay = policy.computeDelay(attempt, this.random);
        instance.pendingRetry = {
          stepId: step.id,
          attempt,
          nextAttemptAt: this.clock.now() + delay,
          lastError: message,
        };
        instance.status = "waiting";
        this.audit.record(instance.id, "retry.scheduled", step.id, { attempt, delayMs: delay });
        return;
      }

      await this.escalations.escalate({
        instanceId: instance.id,
        stepId: step.id,
        reason: "retryExhausted",
        handler: step.escalationHandler,
        context: this.scope(instance) as WorkflowContext,
      });

      if (step.onFailure) {
        instance.currentStepId = step.onFailure;
      } else {
        instance.status = "failed";
        instance.failureReason = message;
        this.audit.record(instance.id, "workflow.failed", step.id, { error: message });
      }
    }
  }
}
