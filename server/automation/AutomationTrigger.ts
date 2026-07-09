/**
 * CRM automation triggers — event types and trigger event envelopes.
 */

export const AUTOMATION_DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const AUTOMATION_TRIGGER_TYPES = [
  "lead_created",
  "lead_updated",
  "quote_created",
  "quote_accepted",
  "invoice_overdue",
  "project_stage_changed",
  "ticket_opened",
  "ticket_closed",
  "delivery_completed",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export const AUTOMATION_ENTITY_TYPES = [
  "lead",
  "quote",
  "invoice",
  "project",
  "ticket",
  "delivery",
] as const;

export type AutomationEntityType = (typeof AUTOMATION_ENTITY_TYPES)[number];

export interface AutomationTriggerEvent {
  id: string;
  trigger: AutomationTriggerType;
  companyId: string;
  entityType: AutomationEntityType;
  entityId: string;
  actorId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type AutomationTriggerEventInput = Omit<AutomationTriggerEvent, "occurredAt"> & {
  occurredAt?: string;
};

export function isAutomationTriggerType(value: string): value is AutomationTriggerType {
  return (AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(value);
}

export function isAutomationEntityType(value: string): value is AutomationEntityType {
  return (AUTOMATION_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateAutomationTriggerEvent(
  input: AutomationTriggerEventInput
): { ok: true; event: AutomationTriggerEvent } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.entityId)) errors.push("entityId is required");
  if (!isNonEmptyString(input.actorId)) errors.push("actorId is required");
  if (!isAutomationTriggerType(input.trigger)) errors.push("trigger is invalid");
  if (!isAutomationEntityType(input.entityType)) errors.push("entityType is invalid");
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    event: {
      id: input.id.trim(),
      trigger: input.trigger,
      companyId: input.companyId.trim(),
      entityType: input.entityType,
      entityId: input.entityId.trim(),
      actorId: input.actorId.trim(),
      payload: { ...(input.payload ?? {}) },
      occurredAt: input.occurredAt ?? AUTOMATION_DEFAULT_TIMESTAMP,
    },
  };
}

export function createAutomationTriggerEvent(input: AutomationTriggerEventInput): AutomationTriggerEvent {
  const result = validateAutomationTriggerEvent(input);
  if (!result.ok) throw new Error(`Invalid trigger event: ${result.errors.join("; ")}`);
  return result.event;
}

export function triggerEntityTypeFor(trigger: AutomationTriggerType): AutomationEntityType {
  switch (trigger) {
    case "lead_created":
    case "lead_updated":
      return "lead";
    case "quote_created":
    case "quote_accepted":
      return "quote";
    case "invoice_overdue":
      return "invoice";
    case "project_stage_changed":
      return "project";
    case "ticket_opened":
    case "ticket_closed":
      return "ticket";
    case "delivery_completed":
      return "delivery";
    default: {
      const exhaustive: never = trigger;
      throw new Error(`Unknown trigger: ${String(exhaustive)}`);
    }
  }
}
