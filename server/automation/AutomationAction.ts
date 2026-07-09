/**
 * Automation actions — CRM side-effects and outbound queue stubs.
 */

export const AUTOMATION_ACTION_TYPES = [
  "assign_user",
  "change_stage",
  "create_task",
  "schedule_reminder",
  "queue_email",
  "queue_whatsapp",
  "queue_notification",
  "queue_webhook",
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export type AutomationActionStatus = "completed" | "queued" | "failed";

export interface AutomationActionDefinition {
  id: string;
  type: AutomationActionType;
  params: Record<string, string | number | boolean>;
}

export interface AutomationActionContext {
  companyId: string;
  entityType: string;
  entityId: string;
  triggerEventId: string;
  ruleId: string;
  payload: Record<string, unknown>;
}

export interface AutomationActionResult {
  actionId: string;
  type: AutomationActionType;
  status: AutomationActionStatus;
  message: string;
  output: Record<string, string | number | boolean>;
}

export function isAutomationActionType(value: string): value is AutomationActionType {
  return (AUTOMATION_ACTION_TYPES as readonly string[]).includes(value);
}

export function validateAutomationActionDefinition(
  action: AutomationActionDefinition
): { ok: true; action: AutomationActionDefinition } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!action.id?.trim()) errors.push("action.id is required");
  if (!isAutomationActionType(action.type)) errors.push("action.type is invalid");
  if (!action.params || typeof action.params !== "object") errors.push("action.params is required");
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    action: {
      id: action.id.trim(),
      type: action.type,
      params: { ...action.params },
    },
  };
}

function requireParam(
  params: Record<string, string | number | boolean>,
  key: string
): string | null {
  const value = params[key];
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return String(value).trim();
}

export function executeAutomationAction(
  action: AutomationActionDefinition,
  context: AutomationActionContext
): AutomationActionResult {
  const base = {
    actionId: action.id,
    type: action.type,
    output: {} as Record<string, string | number | boolean>,
  };

  switch (action.type) {
    case "assign_user": {
      const userId = requireParam(action.params, "userId");
      if (!userId) {
        return { ...base, status: "failed", message: "userId is required", output: {} };
      }
      return {
        ...base,
        status: "completed",
        message: "user_assigned",
        output: { userId, entityId: context.entityId },
      };
    }
    case "change_stage": {
      const stage = requireParam(action.params, "stage");
      if (!stage) {
        return { ...base, status: "failed", message: "stage is required", output: {} };
      }
      return {
        ...base,
        status: "completed",
        message: "stage_changed",
        output: { stage, entityId: context.entityId },
      };
    }
    case "create_task": {
      const title = requireParam(action.params, "title");
      if (!title) {
        return { ...base, status: "failed", message: "title is required", output: {} };
      }
      const assigneeId = requireParam(action.params, "assigneeId") ?? "";
      return {
        ...base,
        status: "completed",
        message: "task_created",
        output: { title, assigneeId, entityId: context.entityId },
      };
    }
    case "schedule_reminder": {
      const remindAt = requireParam(action.params, "remindAt");
      if (!remindAt) {
        return { ...base, status: "failed", message: "remindAt is required", output: {} };
      }
      return {
        ...base,
        status: "completed",
        message: "reminder_scheduled",
        output: { remindAt, entityId: context.entityId },
      };
    }
    case "queue_email":
    case "queue_whatsapp":
    case "queue_notification":
    case "queue_webhook": {
      const template = requireParam(action.params, "template") ?? action.type;
      return {
        ...base,
        status: "queued",
        message: `${action.type}_stub`,
        output: {
          template,
          entityId: context.entityId,
          companyId: context.companyId,
        },
      };
    }
    default: {
      const exhaustive: never = action.type;
      return { ...base, status: "failed", message: `unknown_action:${String(exhaustive)}`, output: {} };
    }
  }
}

export function isQueueActionType(type: AutomationActionType): boolean {
  return (
    type === "queue_email" ||
    type === "queue_whatsapp" ||
    type === "queue_notification" ||
    type === "queue_webhook"
  );
}
