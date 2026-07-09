import type { ConditionExpression } from "./types.ts";

function getPath(scope: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = scope;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function evaluateCondition(
  expression: ConditionExpression,
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
      if (typeof v === "string" && typeof expression.value === "string") {
        return v.includes(expression.value);
      }
      return false;
    }
    case "and":
      return expression.expressions.every((expr) => evaluateCondition(expr, scope));
    case "or":
      return expression.expressions.some((expr) => evaluateCondition(expr, scope));
    case "not":
      return !evaluateCondition(expression.expression, scope);
    default: {
      const exhaustive: never = expression;
      throw new Error(`Unsupported condition operator: ${JSON.stringify(exhaustive)}`);
    }
  }
}
