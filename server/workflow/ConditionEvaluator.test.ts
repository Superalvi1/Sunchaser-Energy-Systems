import assert from "node:assert/strict";
import { evaluateCondition } from "./ConditionEvaluator.ts";
import type { ConditionExpression } from "./types.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

const scope = {
  amount: 500,
  status: "open",
  tags: ["urgent", "vip"],
  customer: { name: "Acme", tier: "gold", address: { city: "Metropolis" } },
  note: "please expedite this order",
  falsy: 0,
  nullField: null,
};

// eq
await test("eq matches equal string values", () => {
  assert.equal(evaluateCondition({ op: "eq", field: "status", value: "open" }, scope), true);
});
await test("eq rejects unequal string values", () => {
  assert.equal(evaluateCondition({ op: "eq", field: "status", value: "closed" }, scope), false);
});
await test("eq matches equal numeric values", () => {
  assert.equal(evaluateCondition({ op: "eq", field: "amount", value: 500 }, scope), true);
});
await test("eq uses strict equality (no coercion)", () => {
  assert.equal(evaluateCondition({ op: "eq", field: "amount", value: "500" }, scope), false);
});
await test("eq resolves nested dot-path fields", () => {
  assert.equal(evaluateCondition({ op: "eq", field: "customer.tier", value: "gold" }, scope), true);
});
await test("eq resolves deeply nested dot-path fields", () => {
  assert.equal(
    evaluateCondition({ op: "eq", field: "customer.address.city", value: "Metropolis" }, scope),
    true
  );
});
await test("eq on a missing field compares against undefined", () => {
  assert.equal(evaluateCondition({ op: "eq", field: "missing", value: undefined }, scope), true);
});
await test("eq treats 0 as a real value, not missing", () => {
  assert.equal(evaluateCondition({ op: "eq", field: "falsy", value: 0 }, scope), true);
});
await test("eq treats null as a real, distinct value", () => {
  assert.equal(evaluateCondition({ op: "eq", field: "nullField", value: null }, scope), true);
});

// neq
await test("neq is the negation of eq", () => {
  assert.equal(evaluateCondition({ op: "neq", field: "status", value: "closed" }, scope), true);
  assert.equal(evaluateCondition({ op: "neq", field: "status", value: "open" }, scope), false);
});

// gt / gte / lt / lte
await test("gt is true when field exceeds threshold", () => {
  assert.equal(evaluateCondition({ op: "gt", field: "amount", value: 100 }, scope), true);
});
await test("gt is false when field equals threshold", () => {
  assert.equal(evaluateCondition({ op: "gt", field: "amount", value: 500 }, scope), false);
});
await test("gt is false when field is below threshold", () => {
  assert.equal(evaluateCondition({ op: "gt", field: "amount", value: 900 }, scope), false);
});
await test("gte is true when field equals threshold", () => {
  assert.equal(evaluateCondition({ op: "gte", field: "amount", value: 500 }, scope), true);
});
await test("gte is true when field exceeds threshold", () => {
  assert.equal(evaluateCondition({ op: "gte", field: "amount", value: 499 }, scope), true);
});
await test("gte is false when field is below threshold", () => {
  assert.equal(evaluateCondition({ op: "gte", field: "amount", value: 501 }, scope), false);
});
await test("lt is true when field is below threshold", () => {
  assert.equal(evaluateCondition({ op: "lt", field: "amount", value: 501 }, scope), true);
});
await test("lt is false when field equals threshold", () => {
  assert.equal(evaluateCondition({ op: "lt", field: "amount", value: 500 }, scope), false);
});
await test("lte is true when field equals threshold", () => {
  assert.equal(evaluateCondition({ op: "lte", field: "amount", value: 500 }, scope), true);
});
await test("lte is false when field exceeds threshold", () => {
  assert.equal(evaluateCondition({ op: "lte", field: "amount", value: 499 }, scope), false);
});
await test("gt on a non-numeric field is false rather than throwing", () => {
  assert.equal(evaluateCondition({ op: "gt", field: "status", value: 1 }, scope), false);
});
await test("gt on a missing field is false rather than throwing", () => {
  assert.equal(evaluateCondition({ op: "gt", field: "missing", value: 1 }, scope), false);
});

// in / notIn
await test("in is true when field value is a member of the list", () => {
  assert.equal(evaluateCondition({ op: "in", field: "status", values: ["open", "pending"] }, scope), true);
});
await test("in is false when field value is not a member of the list", () => {
  assert.equal(evaluateCondition({ op: "in", field: "status", values: ["closed"] }, scope), false);
});
await test("in against an empty list is always false", () => {
  assert.equal(evaluateCondition({ op: "in", field: "status", values: [] }, scope), false);
});
await test("notIn is the negation of in", () => {
  assert.equal(evaluateCondition({ op: "notIn", field: "status", values: ["closed"] }, scope), true);
  assert.equal(evaluateCondition({ op: "notIn", field: "status", values: ["open"] }, scope), false);
});

// exists / notExists
await test("exists is true for a present field", () => {
  assert.equal(evaluateCondition({ op: "exists", field: "status" }, scope), true);
});
await test("exists is false for a missing field", () => {
  assert.equal(evaluateCondition({ op: "exists", field: "missing" }, scope), false);
});
await test("exists is true for a field explicitly set to null", () => {
  assert.equal(evaluateCondition({ op: "exists", field: "nullField" }, scope), true);
});
await test("exists is true for a nested field", () => {
  assert.equal(evaluateCondition({ op: "exists", field: "customer.tier" }, scope), true);
});
await test("exists is false when an intermediate path segment is missing", () => {
  assert.equal(evaluateCondition({ op: "exists", field: "customer.missing.deep" }, scope), false);
});
await test("notExists is the negation of exists", () => {
  assert.equal(evaluateCondition({ op: "notExists", field: "missing" }, scope), true);
  assert.equal(evaluateCondition({ op: "notExists", field: "status" }, scope), false);
});

// contains
await test("contains matches an element in an array field", () => {
  assert.equal(evaluateCondition({ op: "contains", field: "tags", value: "urgent" }, scope), true);
});
await test("contains is false when the element is absent from the array", () => {
  assert.equal(evaluateCondition({ op: "contains", field: "tags", value: "low-priority" }, scope), false);
});
await test("contains matches a substring in a string field", () => {
  assert.equal(evaluateCondition({ op: "contains", field: "note", value: "expedite" }, scope), true);
});
await test("contains is false for a substring not present", () => {
  assert.equal(evaluateCondition({ op: "contains", field: "note", value: "cancel" }, scope), false);
});
await test("contains is false against a non-array, non-string field", () => {
  assert.equal(evaluateCondition({ op: "contains", field: "amount", value: 5 }, scope), false);
});
await test("contains is false against a missing field", () => {
  assert.equal(evaluateCondition({ op: "contains", field: "missing", value: "x" }, scope), false);
});

// and / or / not
await test("and is true when every sub-expression is true", () => {
  const expr: ConditionExpression = {
    op: "and",
    expressions: [
      { op: "eq", field: "status", value: "open" },
      { op: "gt", field: "amount", value: 100 },
    ],
  };
  assert.equal(evaluateCondition(expr, scope), true);
});
await test("and is false when any sub-expression is false", () => {
  const expr: ConditionExpression = {
    op: "and",
    expressions: [
      { op: "eq", field: "status", value: "open" },
      { op: "gt", field: "amount", value: 10_000 },
    ],
  };
  assert.equal(evaluateCondition(expr, scope), false);
});
await test("and over an empty list is vacuously true", () => {
  assert.equal(evaluateCondition({ op: "and", expressions: [] }, scope), true);
});
await test("or is true when any sub-expression is true", () => {
  const expr: ConditionExpression = {
    op: "or",
    expressions: [
      { op: "eq", field: "status", value: "closed" },
      { op: "gt", field: "amount", value: 100 },
    ],
  };
  assert.equal(evaluateCondition(expr, scope), true);
});
await test("or is false when every sub-expression is false", () => {
  const expr: ConditionExpression = {
    op: "or",
    expressions: [
      { op: "eq", field: "status", value: "closed" },
      { op: "gt", field: "amount", value: 10_000 },
    ],
  };
  assert.equal(evaluateCondition(expr, scope), false);
});
await test("or over an empty list is vacuously false", () => {
  assert.equal(evaluateCondition({ op: "or", expressions: [] }, scope), false);
});
await test("not inverts a true sub-expression", () => {
  assert.equal(
    evaluateCondition({ op: "not", expression: { op: "eq", field: "status", value: "open" } }, scope),
    false
  );
});
await test("not inverts a false sub-expression", () => {
  assert.equal(
    evaluateCondition({ op: "not", expression: { op: "eq", field: "status", value: "closed" } }, scope),
    true
  );
});
await test("expressions can nest and/or/not arbitrarily deep", () => {
  const expr: ConditionExpression = {
    op: "and",
    expressions: [
      { op: "eq", field: "customer.tier", value: "gold" },
      {
        op: "not",
        expression: {
          op: "or",
          expressions: [
            { op: "eq", field: "status", value: "closed" },
            { op: "lt", field: "amount", value: 10 },
          ],
        },
      },
    ],
  };
  assert.equal(evaluateCondition(expr, scope), true);
});
await test("dot-path traversal through a non-object short-circuits to undefined", () => {
  assert.equal(evaluateCondition({ op: "exists", field: "amount.nested" }, scope), false);
});
await test("dot-path traversal through null short-circuits to undefined", () => {
  assert.equal(evaluateCondition({ op: "exists", field: "nullField.nested" }, scope), false);
});

console.log(`\nConditionEvaluator tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
