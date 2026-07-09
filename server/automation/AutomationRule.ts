/**
 * Automation rule definition — trigger + conditions + actions.
 */

import type { AutomationActionDefinition } from "./AutomationAction.ts";
import { validateAutomationActionDefinition } from "./AutomationAction.ts";
import type { AutomationConditionExpression } from "./AutomationCondition.ts";
import {
  AUTOMATION_DEFAULT_TIMESTAMP,
  isAutomationTriggerType,
  isNonEmptyString,
  type AutomationTriggerType,
} from "./AutomationTrigger.ts";

export interface AutomationRule {
  id: string;
  companyId: string;
  name: string;
  description: string;
  trigger: AutomationTriggerType;
  conditions: AutomationConditionExpression[];
  actions: AutomationActionDefinition[];
  active: boolean;
  priority: number;
  maxRetries: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRuleInput = Omit<AutomationRule, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};

export function validateAutomationRule(
  input: AutomationRuleInput
): { ok: true; rule: AutomationRule } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required");
  if (!isNonEmptyString(input.companyId)) errors.push("companyId is required");
  if (!isNonEmptyString(input.name)) errors.push("name is required");
  if (!isAutomationTriggerType(input.trigger)) errors.push("trigger is invalid");
  if (!isNonEmptyString(input.createdBy)) errors.push("createdBy is required");
  if (!Array.isArray(input.actions) || input.actions.length === 0) errors.push("actions required");
  if (input.priority < 0) errors.push("priority must be non-negative");
  if (input.maxRetries < 0) errors.push("maxRetries must be non-negative");

  const normalizedActions: AutomationActionDefinition[] = [];
  for (const action of input.actions ?? []) {
    const validated = validateAutomationActionDefinition(action);
    if (!validated.ok) {
      errors.push(...validated.errors);
    } else {
      normalizedActions.push(validated.action);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const ts = input.createdAt ?? input.updatedAt ?? AUTOMATION_DEFAULT_TIMESTAMP;
  return {
    ok: true,
    rule: {
      id: input.id.trim(),
      companyId: input.companyId.trim(),
      name: input.name.trim(),
      description: String(input.description ?? "").trim(),
      trigger: input.trigger,
      conditions: [...(input.conditions ?? [])],
      actions: normalizedActions,
      active: input.active !== false,
      priority: Number(input.priority) || 0,
      maxRetries: Number(input.maxRetries) || 3,
      createdBy: input.createdBy.trim(),
      createdAt: input.createdAt ?? ts,
      updatedAt: input.updatedAt ?? ts,
    },
  };
}

export function createAutomationRule(input: AutomationRuleInput): AutomationRule {
  const result = validateAutomationRule(input);
  if (!result.ok) throw new Error(`Invalid rule: ${result.errors.join("; ")}`);
  return result.rule;
}

export function sortRulesByPriority(rules: AutomationRule[]): AutomationRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });
}
