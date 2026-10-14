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
