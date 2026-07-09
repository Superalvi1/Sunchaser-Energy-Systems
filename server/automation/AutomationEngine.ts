/**
 * CRM Automation Engine — event-driven rule matching and action execution.
 */

import type { RequestActor } from "../middleware/actor.ts";
import {
  executeAutomationAction,
  isQueueActionType,
  type AutomationActionContext,
  type AutomationActionResult,
} from "./AutomationAction.ts";
import { allAutomationConditionsPass, evaluateAutomationConditions } from "./AutomationCondition.ts";
import { createAutomationEvent } from "./AutomationEvents.ts";
import {
  createAutomationRunRecord,
  deriveRunStatus,
  type AutomationRunRecord,
} from "./AutomationHistory.ts";
import {
  assertAutomationExecuteAccess,
  assertAutomationWriteAccess,
} from "./AutomationPermissions.ts";
import {
  createAutomationQueueJob,
  markJobCompleted,
  markJobRunning,
  scheduleJobRetry,
  type AutomationQueueJob,
} from "./AutomationQueue.ts";
import { createAutomationRule, sortRulesByPriority, type AutomationRule, type AutomationRuleInput } from "./AutomationRule.ts";
import {
  createAutomationTriggerEvent,
  type AutomationTriggerEvent,
  type AutomationTriggerEventInput,
} from "./AutomationTrigger.ts";
import { createAutomationRepository, type InMemoryAutomationRepository } from "./AutomationRepository.ts";

export interface AutomationEngineOptions {
  repository?: InMemoryAutomationRepository;
  eventIdPrefix?: string;
  nowMs?: number;
}

export interface AutomationProcessResult {
  event: AutomationTriggerEvent;
  runs: AutomationRunRecord[];
  queuedJobs: AutomationQueueJob[];
}

export class AutomationEngine {
  private repo: InMemoryAutomationRepository;
  private eventCounter = 0;
  private runCounter = 0;
  private jobCounter = 0;
  private eventIdPrefix: string;
  private nowMs: number;

  constructor(options: AutomationEngineOptions = {}) {
    this.repo = options.repository ?? createAutomationRepository();
    this.eventIdPrefix = options.eventIdPrefix ?? "aevt";
    this.nowMs = options.nowMs ?? Date.parse("1970-01-01T00:00:00.000Z");
  }

  get repository(): InMemoryAutomationRepository {
    return this.repo;
  }

  setNowMs(nowMs: number): void {
    this.nowMs = nowMs;
  }

  private nextEventId(): string {
    this.eventCounter += 1;
    return `${this.eventIdPrefix}-${this.eventCounter}`;
  }

  private nextRunId(): string {
    this.runCounter += 1;
    return `run-${this.runCounter}`;
  }

  private nextJobId(): string {
    this.jobCounter += 1;
    return `job-${this.jobCounter}`;
  }

  private emit(
    type: Parameters<typeof createAutomationEvent>[0]["type"],
    actorId: string,
    companyId: string,
    entityType: string,
    entityId: string,
    payload: Record<string, string | number | boolean> = {}
  ): void {
    this.repo.pushEvent(
      createAutomationEvent({
        id: this.nextEventId(),
        type,
        companyId,
        actorId,
        entityType,
        entityId,
        payload,
      })
    );
  }

  registerRule(input: AutomationRuleInput, actor: RequestActor): AutomationRule {
    assertAutomationWriteAccess(actor);
    const rule = this.repo.saveRule(input, actor);
    this.emit("rule.created", actor.id, rule.companyId, "rule", rule.id, { name: rule.name, trigger: rule.trigger });
    return rule;
  }

  updateRule(input: AutomationRuleInput, actor: RequestActor): AutomationRule {
    assertAutomationWriteAccess(actor);
    const rule = this.repo.saveRule({ ...input, updatedAt: new Date(this.nowMs).toISOString() }, actor);
    this.emit("rule.updated", actor.id, rule.companyId, "rule", rule.id, { name: rule.name });
    return rule;
  }

  deactivateRule(ruleId: string, actor: RequestActor): AutomationRule | null {
    assertAutomationWriteAccess(actor);
    const existing = this.repo.getRule(ruleId, actor);
    if (!existing) return null;
    const rule = this.repo.saveRule({ ...existing, active: false, updatedAt: new Date(this.nowMs).toISOString() }, actor);
    this.emit("rule.deactivated", actor.id, rule.companyId, "rule", rule.id, {});
    return rule;
  }

  processTrigger(input: AutomationTriggerEventInput, actor: RequestActor): AutomationProcessResult {
    assertAutomationExecuteAccess(actor);
    const event = createAutomationTriggerEvent(input);
    this.repo.saveTriggerEvent(event);

    this.emit("trigger.received", actor.id, event.companyId, event.entityType, event.entityId, {
      trigger: event.trigger,
    });

    const rules = sortRulesByPriority(
      this.repo.listActiveRulesByTrigger(event.companyId, event.trigger)
    );

    const runs: AutomationRunRecord[] = [];
    const queuedJobs: AutomationQueueJob[] = [];
    const scope = { ...event.payload, entityId: event.entityId, entityType: event.entityType, trigger: event.trigger };

    for (const rule of rules) {
      const conditionResults = evaluateAutomationConditions(rule.conditions, scope);
      const passed = allAutomationConditionsPass(rule.conditions, scope);

      if (!passed) {
        const run = createAutomationRunRecord({
          id: this.nextRunId(),
          companyId: event.companyId,
          ruleId: rule.id,
          ruleName: rule.name,
          triggerEventId: event.id,
          trigger: event.trigger,
          status: "skipped",
          conditionResults,
          actionResults: [],
          actorId: actor.id,
        });
        this.repo.appendRun(run);
        runs.push(run);
        this.emit("rule.skipped", actor.id, event.companyId, "rule", rule.id, { triggerEventId: event.id });
        continue;
      }

      this.emit("rule.matched", actor.id, event.companyId, "rule", rule.id, { triggerEventId: event.id });

      const actionResults: AutomationActionResult[] = [];
      for (const action of rule.actions) {
        const context: AutomationActionContext = {
          companyId: event.companyId,
          entityType: event.entityType,
          entityId: event.entityId,
          triggerEventId: event.id,
          ruleId: rule.id,
          payload: scope,
        };

        const result = executeAutomationAction(action, context);
        actionResults.push(result);

        if (result.status === "queued" || isQueueActionType(action.type)) {
          const job = createAutomationQueueJob({
            id: this.nextJobId(),
            companyId: event.companyId,
            ruleId: rule.id,
            actionId: action.id,
            actionType: action.type,
            triggerEventId: event.id,
            maxAttempts: rule.maxRetries,
            payload: { ...action.params, ...result.output },
          });
          this.repo.getQueue().enqueue(job);
          queuedJobs.push(job);
          this.emit("action.queued", actor.id, event.companyId, "action", action.id, { jobId: job.id });
        } else if (result.status === "completed") {
          this.emit("action.executed", actor.id, event.companyId, "action", action.id, { message: result.message });
        } else {
          this.emit("action.failed", actor.id, event.companyId, "action", action.id, { message: result.message });
        }
      }

      const run = createAutomationRunRecord({
        id: this.nextRunId(),
        companyId: event.companyId,
        ruleId: rule.id,
        ruleName: rule.name,
        triggerEventId: event.id,
        trigger: event.trigger,
        status: deriveRunStatus(actionResults),
        conditionResults,
        actionResults,
        actorId: actor.id,
        completedAt: new Date(this.nowMs).toISOString(),
      });
      this.repo.appendRun(run);
      runs.push(run);
      this.emit("run.completed", actor.id, event.companyId, "run", run.id, { status: run.status });
    }

    return { event, runs, queuedJobs };
  }

  processQueue(): { processed: number; completed: number; retried: number; deadLetter: number } {
    const queue = this.repo.getQueue();
    const pending = queue.listPending(this.nowMs);
    let processed = 0;
    let completed = 0;
    let retried = 0;
    let deadLetter = 0;

    for (const job of pending) {
      processed += 1;
      const running = markJobRunning(job, this.nowMs);
      queue.update(running);

      // Stub processors always succeed for queue_* actions in architecture phase.
      const success = job.actionType.startsWith("queue_");
      if (success) {
        queue.update(markJobCompleted(running, this.nowMs));
        completed += 1;
        this.emit("queue.processed", "system", job.companyId, "queue_job", job.id, { status: "completed" });
      } else {
        const retriedJob = scheduleJobRetry(running, "processing_failed", this.nowMs);
        queue.update(retriedJob);
        if (retriedJob.status === "dead_letter") deadLetter += 1;
        else retried += 1;
      }
    }

    return { processed, completed, retried, deadLetter };
  }
}

export function createAutomationEngine(options?: AutomationEngineOptions): AutomationEngine {
  return new AutomationEngine(options);
}
