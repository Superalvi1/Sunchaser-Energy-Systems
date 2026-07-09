/**
 * Automation run history — append-only audit trail.
 * Stored records are deep-cloned and deep-frozen; reads return defensive copies.
 */

import { AUTOMATION_DEFAULT_TIMESTAMP } from "./AutomationTrigger.ts";
import type { AutomationActionResult } from "./AutomationAction.ts";
import type { AutomationConditionResult } from "./AutomationCondition.ts";

export const AUTOMATION_RUN_STATUSES = [
  "matched",
  "skipped",
  "executed",
  "partial",
  "failed",
] as const;

export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export interface AutomationRunRecord {
  id: string;
  companyId: string;
  ruleId: string;
  ruleName: string;
  triggerEventId: string;
  trigger: string;
  status: AutomationRunStatus;
  conditionResults: AutomationConditionResult[];
  actionResults: AutomationActionResult[];
  startedAt: string;
  completedAt: string;
  actorId: string;
}

export type AutomationRunRecordInput = Omit<AutomationRunRecord, "startedAt" | "completedAt"> & {
  startedAt?: string;
  completedAt?: string;
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function sealConditionResult(result: AutomationConditionResult): Readonly<AutomationConditionResult> {
  return deepFreeze({
    expression: structuredClone(result.expression),
    passed: result.passed,
  });
}

function sealActionResult(result: AutomationActionResult): Readonly<AutomationActionResult> {
  return deepFreeze({
    actionId: result.actionId,
    type: result.type,
    status: result.status,
    message: result.message,
    output: structuredClone(result.output),
  });
}

function sealRunRecord(record: AutomationRunRecord): Readonly<AutomationRunRecord> {
  return deepFreeze({
    id: record.id,
    companyId: record.companyId,
    ruleId: record.ruleId,
    ruleName: record.ruleName,
    triggerEventId: record.triggerEventId,
    trigger: record.trigger,
    status: record.status,
    conditionResults: record.conditionResults.map((r) => sealConditionResult(r)),
    actionResults: record.actionResults.map((r) => sealActionResult(r)),
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    actorId: record.actorId,
  });
}

function cloneRunRecord(record: AutomationRunRecord): AutomationRunRecord {
  return sealRunRecord(structuredClone(record)) as AutomationRunRecord;
}

export function isAutomationRunStatus(value: string): value is AutomationRunStatus {
  return (AUTOMATION_RUN_STATUSES as readonly string[]).includes(value);
}

export function createAutomationRunRecord(input: AutomationRunRecordInput): AutomationRunRecord {
  const ts = input.startedAt ?? AUTOMATION_DEFAULT_TIMESTAMP;
  return {
    id: input.id.trim(),
    companyId: input.companyId.trim(),
    ruleId: input.ruleId.trim(),
    ruleName: input.ruleName.trim(),
    triggerEventId: input.triggerEventId.trim(),
    trigger: input.trigger.trim(),
    status: input.status,
    conditionResults: [...input.conditionResults],
    actionResults: [...input.actionResults],
    startedAt: ts,
    completedAt: input.completedAt ?? ts,
    actorId: input.actorId.trim(),
  };
}

export function deriveRunStatus(actionResults: AutomationActionResult[]): AutomationRunStatus {
  if (actionResults.length === 0) return "skipped";
  const completed = actionResults.filter((r) => r.status === "completed" || r.status === "queued").length;
  if (completed === actionResults.length) return "executed";
  if (completed === 0) return "failed";
  return "partial";
}

export class AutomationHistory {
  private readonly records: Readonly<AutomationRunRecord>[] = [];
  private frozen = false;

  append(record: AutomationRunRecord): AutomationRunRecord {
    if (this.frozen) throw new Error("AutomationHistory is frozen");
    const sealed = sealRunRecord(record);
    this.records.push(sealed);
    return cloneRunRecord(sealed);
  }

  list(): readonly AutomationRunRecord[] {
    return this.records.map((record) => cloneRunRecord(record));
  }

  listByRule(ruleId: string): AutomationRunRecord[] {
    return this.records.filter((r) => r.ruleId === ruleId).map((record) => cloneRunRecord(record));
  }

  listByTriggerEvent(triggerEventId: string): AutomationRunRecord[] {
    return this.records
      .filter((r) => r.triggerEventId === triggerEventId)
      .map((record) => cloneRunRecord(record));
  }

  get(id: string): AutomationRunRecord | null {
    const record = this.records.find((r) => r.id === id);
    return record ? cloneRunRecord(record) : null;
  }

  get length(): number {
    return this.records.length;
  }

  freeze(): void {
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }
}

export function createAutomationHistory(): AutomationHistory {
  return new AutomationHistory();
}
