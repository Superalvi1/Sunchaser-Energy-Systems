import test from "node:test";
import assert from "node:assert/strict";
import { declareGlobalOnlyProcess, getIsolationMode, resetIsolationModeForTests } from "./isolationMode.ts";

test("the mode a process declares to the database follows the flag; a global-only job says so", () => {
  resetIsolationModeForTests();
  assert.equal(getIsolationMode({} as NodeJS.ProcessEnv), "single");
  assert.equal(getIsolationMode({ MULTI_COMPANY_ENABLED: "true" } as NodeJS.ProcessEnv), "multi");
  declareGlobalOnlyProcess("test job", {} as NodeJS.ProcessEnv);
  assert.equal(getIsolationMode({} as NodeJS.ProcessEnv), "global-only");
  resetIsolationModeForTests();
});

test("a multi-company process can never declare itself global-only, and a declaration needs a reason", () => {
  resetIsolationModeForTests();
  assert.throws(() => declareGlobalOnlyProcess("a cron job", { MULTI_COMPANY_ENABLED: "true" } as NodeJS.ProcessEnv), /not a global-only job/);
  assert.throws(() => declareGlobalOnlyProcess("", {} as NodeJS.ProcessEnv), /needs a reason/);
  assert.equal(getIsolationMode({} as NodeJS.ProcessEnv), "single");
  resetIsolationModeForTests();
});
