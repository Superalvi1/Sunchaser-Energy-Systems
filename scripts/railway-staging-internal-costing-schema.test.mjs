import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("./railway-staging-internal-costing-schema.sql", import.meta.url),
  "utf8"
);
const dbAdapter = fs.readFileSync(
  new URL("../internalCostingDb.ts", import.meta.url),
  "utf8"
);

for (const table of [
  "public.internal_costing_sheets",
  "public.investors",
  "public.inventory_purchases",
]) {
  assert.match(sql, new RegExp(table.replaceAll(".", "\\.")));
}
assert.match(sql, /created_by_user_id text/);
assert.match(sql, /internal_costing_sheets enable row level security/i);
assert.match(sql, /internal_costing_sheets force row level security/i);
assert.match(sql, /inventory_purchases enable row level security/i);
assert.match(sql, /inventory_purchases force row level security/i);
assert.match(sql, /grant select, insert, update, delete[\s\S]+service_role/i);
assert.match(sql, /notify pgrst, 'reload schema'/i);

assert.match(dbAdapter, /created_by_user_id: userId/);
assert.doesNotMatch(
  dbAdapter,
  /Internal costing tables are not ready\. Run scripts\/internal-costing-investor-schema\.sql on Supabase\./
);

console.log("Railway staging internal costing schema contract: PASS");
