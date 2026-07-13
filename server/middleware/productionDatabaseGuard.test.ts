/**
 * P0 production database fail-fast tests.
 */
import assert from "node:assert/strict";
import {
  assertProductionDatabaseReady,
  isLocalDatabaseJsonFallbackAllowed,
} from "./productionDatabaseGuard.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

test("production fails fast when Supabase is inactive", () => {
  assert.throws(
    () =>
      assertProductionDatabaseReady({
        nodeEnv: "production",
        supabaseActive: false,
      }),
    (err: unknown) =>
      err instanceof Error && /FATAL: Production requires an active Supabase/i.test(err.message)
  );
});

test("production allows startup when Supabase is active", () => {
  assert.doesNotThrow(() =>
    assertProductionDatabaseReady({
      nodeEnv: "production",
      supabaseActive: true,
    })
  );
});

test("development/test may use local database.json fallback", () => {
  assert.doesNotThrow(() =>
    assertProductionDatabaseReady({
      nodeEnv: "development",
      supabaseActive: false,
    })
  );
  assert.equal(isLocalDatabaseJsonFallbackAllowed("development"), true);
  assert.equal(isLocalDatabaseJsonFallbackAllowed("test"), true);
  assert.equal(isLocalDatabaseJsonFallbackAllowed("production"), false);
});

console.log(`\nProduction database guard tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
