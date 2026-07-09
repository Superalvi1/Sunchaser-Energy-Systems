/**
 * Automation rule conditions — deterministic predicate evaluation.
 * Malformed runtime input fails closed (returns false); never throws.
 */

export type AutomationConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "exists"
  | "notExists"
  | "contains"
  | "and"
  | "or"
  | "not";

export type AutomationConditionExpression =
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
  | { op: "contains"; field: string; value: string }
  | { op: "and"; expressions: AutomationConditionExpression[] }
  | { op: "or"; expressions: AutomationConditionExpression[] }
  | { op: "not"; expression: AutomationConditionExpression };

export interface AutomationConditionResult {
  expression: AutomationConditionExpression;
  passed: boolean;
}

const VALID_OPS = new Set<string>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "exists",
  "notExists",
  "contains",
  "and",
  "or",
  "not",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Defensive shape check before operator evaluation — rejects malformed runtime input. */
export function isValidAutomationConditionExpression(
  value: unknown
): value is AutomationConditionExpression {
  if (!isPlainObject(value)) return false;
  const op = value.op;
  if (typeof op !== "string" || !VALID_OPS.has(op)) return false;

  switch (op) {
    case "eq":
    case "neq":
      return isNonEmptyString(value.field) && "value" in value;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return isNonEmptyString(value.field) && typeof value.value === "number";
    case "in":
    case "notIn":
      return isNonEmptyString(value.field) && Array.isArray(value.values);
    case "exists":
    case "notExists":
      return isNonEmptyString(value.field);
    case "contains":
      return isNonEmptyString(value.field) && typeof value.value === "string";
    case "and":
    case "or": {
      if (!Array.isArray(value.expressions)) return false;
      return value.expressions.every((expr) => isValidAutomationConditionExpression(expr));
    }
    case "not":
      return isValidAutomationConditionExpression(value.expression);
    default:
      return false;
  }
}

function getPath(scope: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = scope;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateValidCondition(
  expression: AutomationConditionExpression,
  scope: Record<string, unknown>
): boolean {
  switch (expression.op) {
    case "eq":
      return getPath(scope, expression.field) === expression.value;
    case "neq":
      return getPath(scope, expression.field) !== expression.value;
    case "gt": {
      const v = getPath(scope, expression.field);
      return typeof v === "number" && v > expression.value;
    }
    case "gte": {
      const v = getPath(scope, expression.field);
      return typeof v === "number" && v >= expression.value;
    }
    case "lt": {
      const v = getPath(scope, expression.field);
      return typeof v === "number" && v < expression.value;
    }
    case "lte": {
      const v = getPath(scope, expression.field);
      return typeof v === "number" && v <= expression.value;
    }
    case "in": {
      const v = getPath(scope, expression.field);
      return expression.values.includes(v);
    }
    case "notIn": {
      const v = getPath(scope, expression.field);
      return !expression.values.includes(v);
    }
    case "exists":
      return getPath(scope, expression.field) !== undefined;
    case "notExists":
      return getPath(scope, expression.field) === undefined;
    case "contains": {
      const v = getPath(scope, expression.field);
      if (Array.isArray(v)) return v.includes(expression.value);
      if (typeof v === "string") return v.includes(expression.value);
      return false;
    }
    case "and":
      return expression.expressions.every((expr) => evaluateAutomationCondition(expr, scope));
    case "or":
      return expression.expressions.some((expr) => evaluateAutomationCondition(expr, scope));
    case "not":
      return !evaluateAutomationCondition(expression.expression, scope);
    default:
      return false;
  }
}

export function evaluateAutomationCondition(
  expression: AutomationConditionExpression,
  scope: Record<string, unknown>
): boolean {
  if (!isValidAutomationConditionExpression(expression)) return false;
  return evaluateValidCondition(expression, scope);
}

export function evaluateAutomationConditions(
  expressions: AutomationConditionExpression[],
  scope: Record<string, unknown>
): AutomationConditionResult[] {
  return expressions.map((expression) => ({
    expression,
    passed: evaluateAutomationCondition(expression, scope),
  }));
}

export function allAutomationConditionsPass(
  expressions: AutomationConditionExpression[],
  scope: Record<string, unknown>
): boolean {
  if (expressions.length === 0) return true;
  return expressions.every((expr) => evaluateAutomationCondition(expr, scope));
}
