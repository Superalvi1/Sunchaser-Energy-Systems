import { test } from "node:test";
import assert from "node:assert/strict";
import { pilotRecipientAllowed } from "../src/pilotScope.mjs";

test("worker fails closed with no scope in production", () => {
  assert.equal(pilotRecipientAllowed("923001111111", { NODE_ENV: "production" }), false);
  assert.equal(pilotRecipientAllowed("923001111111", { MOOS_PILOT_SCOPE_REQUIRED: "true" }), false);
});
test("worker allows only one approved Pakistan mobile", () => {
  const e = { NODE_ENV: "production", MOOS_TEST_ONLY_RECIPIENT_E164: "+923218486752" };
  assert.equal(pilotRecipientAllowed("923218486752",e),true);
  assert.equal(pilotRecipientAllowed("03218486752",e),true);
  assert.equal(pilotRecipientAllowed("923001111111",e),false);
  assert.equal(pilotRecipientAllowed("not a phone",e),false);
});
test("invalid scope rejects all",()=>{
  assert.equal(pilotRecipientAllowed("923218486752",{NODE_ENV:"production",MOOS_TEST_ONLY_RECIPIENT_E164:"invalid"}),false);
});
