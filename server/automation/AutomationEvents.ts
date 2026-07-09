/**
 * Automation domain events.
 */

import { AUTOMATION_DEFAULT_TIMESTAMP } from "./AutomationTrigger.ts";

export type AutomationEventType =
  | "rule.created"
  | "rule.updated"
  | "rule.deactivated"
  | "trigger.received"
  | "rule.matched"
  | "rule.skipped"
  | "action.executed"
  | "action.queued"
  | "action.failed"
  | "queue.processed"
  | "run.completed";

export const AUTOMATION_EVENT_TYPES: readonly AutomationEventType[] = [
  "rule.created",
  "rule.updated",
  "rule.deactivated",
  "trigger.received",
  "rule.matched",
  "rule.skipped",
  "action.executed",
  "action.queued",
  "action.failed",
  "queue.processed",
  "run.completed",
] as const;

export interface AutomationEvent {
  id: string;
  type: AutomationEventType;
  companyId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  payload: Record<string, string | number | boolean>;
}

export type AutomationEventInput = Omit<AutomationEvent, "occurredAt"> & { occurredAt?: string };

export function createAutomationEvent(input: AutomationEventInput): AutomationEvent {
  return {
    id: input.id.trim(),
    type: input.type,
    companyId: input.companyId.trim(),
    actorId: input.actorId.trim(),
    entityType: input.entityType.trim(),
    entityId: input.entityId.trim(),
    occurredAt: input.occurredAt ?? AUTOMATION_DEFAULT_TIMESTAMP,
    payload: { ...input.payload },
  };
}

export function isAutomationEventType(value: string): value is AutomationEventType {
  return (AUTOMATION_EVENT_TYPES as readonly string[]).includes(value);
}

export function sortAutomationEventsDesc(events: AutomationEvent[]): AutomationEvent[] {
  return [...events].sort((a, b) => {
    const diff = b.occurredAt.localeCompare(a.occurredAt);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}
