import test from "node:test";
import assert from "node:assert/strict";
import { generateCustomerCode, setCustomerCodeExistenceClientForTests } from "../../customerCode.ts";

// The check must see codes of EVERY company: the unique index spans all of them, while a company-restricted client only sees its own rows.
test("a customer code taken by another company is never handed out (the existence check uses the unrestricted client)", async () => {
  process.env.RAILWAY_POSTGREST_URL = "http://127.0.0.1:1"; process.env.SUPABASE_SERVICE_ROLE_KEY = "x"; // isSupabaseActive() true, never called
  const asked: string[] = [];
  const taken = new Set<string>();
  // a fake that "has" every code on its first N asks (as another company's customers would), then none
  let remaining = 5;
  const fake: any = { from: () => ({ select: () => ({ eq: (_c: string, code: string) => ({ maybeSingle: async () => { asked.push(code); return { data: remaining-- > 0 ? { id: "x" } : null, error: null }; } }) }) }) };
  setCustomerCodeExistenceClientForTests(() => fake);
  try {
    const code = await generateCustomerCode();
    assert.match(code, /^SES-\d{6}$/);
    assert.equal(asked.length, 6, "five codes reported taken, the sixth was free");
    assert.equal(asked[5], code);
    assert.ok(!taken.has(code));
  } finally { setCustomerCodeExistenceClientForTests(null); }
});

// ---------------------------------------------------------------------------------------------------------------------------- insert-time safety
import { insertWithUniqueCustomerCode, isCustomerCodeConflict, CUSTOMER_CODE_INSERT_ATTEMPTS } from "../../customerCode.ts";

const dup = (what = "customers_customer_code_idx") => ({ code: "23505", message: `duplicate key value violates unique constraint "${what}"`, details: `Key (customer_code)=(SES-111111) already exists.` });
const freeClient = () => { process.env.RAILWAY_POSTGREST_URL = "http://127.0.0.1:1"; process.env.SUPABASE_SERVICE_ROLE_KEY = "x"; const fake: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }; setCustomerCodeExistenceClientForTests(() => fake); };

test("only a 23505 on the customer-code index counts as a code conflict", () => {
  assert.equal(isCustomerCodeConflict(dup()), true);
  assert.equal(isCustomerCodeConflict({ code: "23505", message: 'duplicate key value violates unique constraint "customers_pkey"', details: "Key (id)=(cust-1) already exists." }), false, "a clash on the id is not retried");
  assert.equal(isCustomerCodeConflict({ code: "42703", message: 'column "customer_code" of relation "customers" does not exist' }), false, "a missing column is not a duplicate");
  assert.equal(isCustomerCodeConflict({ code: "23502", message: 'null value in column "customer_code"' }), false);
  assert.equal(isCustomerCodeConflict(null), false);
});

test("forced collisions: the insert is retried with a NEW code each time and succeeds", async () => {
  freeClient();
  try {
    for (const forced of [1, 2, CUSTOMER_CODE_INSERT_ATTEMPTS - 1]) {
      const tried: string[] = [];
      const r = await insertWithUniqueCustomerCode(async (code) => { tried.push(code); return { error: tried.length <= forced ? dup() : null }; });
      assert.equal(r.error, null);
      assert.equal(tried.length, forced + 1);
      assert.equal(r.attempts, forced + 1);
      assert.equal(r.customerCode, tried[tried.length - 1], "the code that was stored is the last one drawn");
      assert.ok(tried.every((c) => /^SES-\d{6}$/.test(c)));
    }
  } finally { setCustomerCodeExistenceClientForTests(null); }
});

test("forced collisions beyond the bound: stops after the bounded number of attempts and returns the conflict (no endless loop)", async () => {
  freeClient();
  try {
    let calls = 0;
    const r = await insertWithUniqueCustomerCode(async () => { calls++; return { error: dup() }; });
    assert.equal(calls, CUSTOMER_CODE_INSERT_ATTEMPTS);
    assert.equal(isCustomerCodeConflict(r.error), true);
    assert.equal(r.attempts, CUSTOMER_CODE_INSERT_ATTEMPTS);
  } finally { setCustomerCodeExistenceClientForTests(null); }
});

test("any other error is returned at once and never retried; a given first code is used first", async () => {
  freeClient();
  try {
    let calls = 0;
    const r = await insertWithUniqueCustomerCode(async () => { calls++; return { error: { code: "23505", message: 'violates unique constraint "customers_pkey"', details: "Key (id)=(x)" } }; });
    assert.equal(calls, 1);
    const first: string[] = [];
    await insertWithUniqueCustomerCode(async (code) => { first.push(code); return { error: null }; }, { first: "SES-123456" });
    assert.deepEqual(first, ["SES-123456"]);
    assert.ok(r.error);
  } finally { setCustomerCodeExistenceClientForTests(null); }
});

test("simultaneous inserts of one code space: with a store that enforces uniqueness every caller ends with a distinct code", async () => {
  freeClient();
  try {
    // a tiny code space is forced through the generator by pre-filling `first` with the SAME code for all callers, so they all collide at once
    const store = new Set<string>();
    const insert = async (code: string) => { await new Promise((r) => setTimeout(r, Math.random() * 3)); if (store.has(code)) return { error: dup() }; store.add(code); return { error: null }; };
    const results = await Promise.all(Array.from({ length: 40 }, () => insertWithUniqueCustomerCode(insert, { first: "SES-999999" })));
    assert.ok(results.every((r) => !r.error), "no caller failed");
    assert.equal(new Set(results.map((r) => r.customerCode)).size, 40, "40 distinct codes");
    assert.equal(store.size, 40);
    assert.ok(results.filter((r) => r.attempts > 1).length >= 39, "39 of the 40 had to retry");
  } finally { setCustomerCodeExistenceClientForTests(null); }
});
