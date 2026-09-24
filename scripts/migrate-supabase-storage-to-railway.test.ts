import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("storage migration is explicit, source-pinned and does not embed credentials", () => {
  const source = readFileSync(new URL("./migrate-supabase-storage-to-railway.ts", import.meta.url), "utf8");
  assert.match(source, /CONFIRM_RAILWAY_STORAGE_MIGRATION/);
  assert.match(source, /xxtdfvgkurxabpbmjban\.supabase\.co/);
  assert.equal(/service_role|SUPABASE_SERVICE_ROLE_KEY|SECRET_ACCESS_KEY\s*=/.test(source), false);
  assert.match(source, /body\.byteLength !== item\.size/);
  assert.match(source, /RAILWAY_STORAGE_MIGRATION_COMPLETE/);
});
