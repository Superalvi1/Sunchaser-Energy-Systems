import test from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER_CODE_INSERT_ATTEMPTS, insertWithUniqueCustomerCode, isCustomerCodeConflict } from "./customerCode.ts";

// No database is configured here, so codes come from the local-store branch (generateCustomerCode(undefined) finds no customers).
const dup = (what = "customers_customer_code_idx") => ({ code: "23505", message: `duplicate key value violates unique constraint "${what}"`, details: "Key (customer_code)=(SES-111111) already exists." });

test("only a 23505 on the customer-code index counts as a code conflict", () => {
  assert.equal(isCustomerCodeConflict(dup()), true);
  assert.equal(isCustomerCodeConflict({ code: "23505", message: 'violates unique constraint "customers_pkey"', details: "Key (id)=(cust-1) already exists." }), false);
  assert.equal(isCustomerCodeConflict({ code: "42703", message: 'column "customer_code" does not exist' }), false);
  assert.equal(isCustomerCodeConflict(null), false);
});

test("forced collisions: the insert is retried with a NEW code each time and succeeds", async () => {
  for (const forced of [1, 2, CUSTOMER_CODE_INSERT_ATTEMPTS - 1]) {
    const tried: string[] = [];
    const r = await insertWithUniqueCustomerCode(async (code) => { tried.push(code); return { error: tried.length <= forced ? dup() : null }; });
    assert.equal(r.error, null);
    assert.equal(tried.length, forced + 1);
    assert.equal(r.customerCode, tried[tried.length - 1]);
    assert.ok(tried.every((c) => /^SES-\d{6}$/.test(c)));
  }
});

test("beyond the bound it stops and returns the conflict; any other error is returned at once", async () => {
  let calls = 0;
  const r = await insertWithUniqueCustomerCode(async () => { calls++; return { error: dup() }; });
  assert.equal(calls, CUSTOMER_CODE_INSERT_ATTEMPTS);
  assert.equal(isCustomerCodeConflict(r.error), true);
  calls = 0;
  await insertWithUniqueCustomerCode(async () => { calls++; return { error: { code: "23505", message: 'violates unique constraint "customers_pkey"', details: "Key (id)=(x)" } }; });
  assert.equal(calls, 1);
});

test("simultaneous inserts that all start from the same code end with 40 distinct codes", async () => {
  const store = new Set<string>();
  const insert = async (code: string) => { await new Promise((r) => setTimeout(r, Math.random() * 3)); if (store.has(code)) return { error: dup() }; store.add(code); return { error: null }; };
  const results = await Promise.all(Array.from({ length: 40 }, () => insertWithUniqueCustomerCode(insert, { first: "SES-999999" })));
  assert.ok(results.every((r) => !r.error));
  assert.equal(new Set(results.map((r) => r.customerCode)).size, 40);
});
