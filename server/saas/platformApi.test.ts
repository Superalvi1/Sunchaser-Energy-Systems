import test from "node:test";
import assert from "node:assert/strict";
import { cleanCompanyInput, cleanOverrides, PlatformInputError, temporaryPassword } from "./platformApi.ts";

test("company input: id derived from the name, validated, never the founding company", () => {
  const c = cleanCompanyInput({ name: "Green Sun Energy", ownerName: "Ali", ownerUsername: "Ali.Khan", ownerEmail: "ALI@Green.test", storageLimitMb: 512 });
  assert.equal(c.id, "green_sun_energy"); assert.equal(c.username, "ali.khan"); assert.equal(c.email, "ali@green.test"); assert.equal(c.trialDays, 14); assert.equal(c.planId, "pilot");
  assert.throws(() => cleanCompanyInput({ name: "X", id: "sunchaser", ownerName: "a", ownerUsername: "abc", ownerEmail: "a@b.co", storageLimitMb: 5 }), PlatformInputError);
  assert.throws(() => cleanCompanyInput({ name: "X Co", ownerName: "a", ownerUsername: "a b", ownerEmail: "a@b.co", storageLimitMb: 5 }), PlatformInputError);
  assert.throws(() => cleanCompanyInput({ name: "X Co", ownerName: "a", ownerUsername: "abc", ownerEmail: "nope", storageLimitMb: 5 }), PlatformInputError);
  assert.throws(() => cleanCompanyInput({ name: "X Co", ownerName: "a", ownerUsername: "abc", ownerEmail: "a@b.co", trialDays: 4000, storageLimitMb: 5 }), PlatformInputError);
});
test("limit overrides: known keys, whole numbers", () => {
  assert.deepEqual(cleanOverrides({ max_leads: 5, max_staff: "3", max_documents: null }), { max_leads: 5, max_staff: 3 });
  assert.throws(() => cleanOverrides({ max_x: 1 }), PlatformInputError);
  assert.throws(() => cleanOverrides({ max_leads: -1 }), PlatformInputError);
});
test("temporary passwords are long and different each time", () => {
  const a = temporaryPassword(), b = temporaryPassword();
  assert.ok(a.length >= 14 && a !== b);
});

test("company input: an explicit storage limit is required - no unlimited default, none from a blank, zero, negative, fractional or absurd value", () => {
  const base = { name: "Green Sun Energy", ownerName: "Ali", ownerUsername: "ali", ownerEmail: "ali@green.test" };
  assert.equal(cleanCompanyInput({ ...base, storageLimitMb: 512 }).storageLimitMb, 512);
  assert.equal(cleanCompanyInput({ ...base, storageLimitMb: "256" }).storageLimitMb, 256, "a number typed into a form arrives as text");
  for (const bad of [undefined, null, "", 0, -5, 1.5, "abc", 2_000_000]) {
    assert.throws(() => cleanCompanyInput({ ...base, storageLimitMb: bad }), (e: any) => e instanceof PlatformInputError && /storage limit/i.test(e.message), JSON.stringify(bad));
  }
});
