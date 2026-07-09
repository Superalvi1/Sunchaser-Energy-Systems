/**
 * In-memory automation repository.
 */

import type { RequestActor } from "../middleware/actor.ts";
import type { AutomationRule, AutomationRuleInput } from "./AutomationRule.ts";
import { createAutomationRule, validateAutomationRule } from "./AutomationRule.ts";
import type { AutomationTriggerEvent, AutomationTriggerType } from "./AutomationTrigger.ts";
import { createAutomationEvent, type AutomationEvent } from "./AutomationEvents.ts";
import {
  assertAutomationReadAccess,
  assertAutomationWriteAccess,
} from "./AutomationPermissions.ts";
import { createAutomationHistory, type AutomationHistory, type AutomationRunRecord } from "./AutomationHistory.ts";
import { createAutomationQueue, type AutomationQueue, type AutomationQueueJob } from "./AutomationQueue.ts";

export interface AutomationRepository {
  saveRule(input: AutomationRuleInput, actor: RequestActor): AutomationRule;
  getRule(id: string, actor: RequestActor): AutomationRule | null;
  listRules(companyId: string, actor: RequestActor): AutomationRule[];
  listActiveRulesByTrigger(companyId: string, trigger: AutomationTriggerType): AutomationRule[];

  saveTriggerEvent(event: AutomationTriggerEvent): AutomationTriggerEvent;
  getTriggerEvent(id: string): AutomationTriggerEvent | null;

  getQueue(): AutomationQueue;
  getHistory(): AutomationHistory;

  appendRun(record: AutomationRunRecord): AutomationRunRecord;
  listRuns(ruleId?: string): AutomationRunRecord[];

  pushEvent(event: AutomationEvent): AutomationEvent;
  listEvents(entityId?: string): AutomationEvent[];
}

export class InMemoryAutomationRepository implements AutomationRepository {
  private rules = new Map<string, AutomationRule>();
  private triggerEvents = new Map<string, AutomationTriggerEvent>();
  private queue = createAutomationQueue();
  private history = createAutomationHistory();
  private events: AutomationEvent[] = [];

  saveRule(input: AutomationRuleInput, actor: RequestActor): AutomationRule {
    assertAutomationWriteAccess(actor);
    const validated = validateAutomationRule(input);
    if (!validated.ok) throw new Error(`Invalid rule: ${validated.errors.join("; ")}`);
    this.rules.set(validated.rule.id, validated.rule);
    return validated.rule;
  }

  getRule(id: string, actor: RequestActor): AutomationRule | null {
    assertAutomationReadAccess(actor);
    return this.rules.get(id) ?? null;
  }

  listRules(companyId: string, actor: RequestActor): AutomationRule[] {
    assertAutomationReadAccess(actor);
    return [...this.rules.values()].filter((r) => r.companyId === companyId);
  }

  listActiveRulesByTrigger(companyId: string, trigger: AutomationTriggerType): AutomationRule[] {
    return [...this.rules.values()].filter(
      (r) => r.companyId === companyId && r.trigger === trigger && r.active
    );
  }

  saveTriggerEvent(event: AutomationTriggerEvent): AutomationTriggerEvent {
    this.triggerEvents.set(event.id, event);
    return event;
  }

  getTriggerEvent(id: string): AutomationTriggerEvent | null {
    return this.triggerEvents.get(id) ?? null;
  }

  getQueue(): AutomationQueue {
    return this.queue;
  }

  getHistory(): AutomationHistory {
    return this.history;
  }

  appendRun(record: AutomationRunRecord): AutomationRunRecord {
    return this.history.append(record);
  }

  listRuns(ruleId?: string): AutomationRunRecord[] {
    if (!ruleId) return this.history.list();
    return this.history.listByRule(ruleId);
  }

  pushEvent(event: AutomationEvent): AutomationEvent {
    const sealed = createAutomationEvent(event);
    this.events.push(sealed);
    return sealed;
  }

  listEvents(entityId?: string): AutomationEvent[] {
    if (!entityId) return [...this.events];
    return this.events.filter((e) => e.entityId === entityId);
  }
}

export function createAutomationRepository(): InMemoryAutomationRepository {
  return new InMemoryAutomationRepository();
}
