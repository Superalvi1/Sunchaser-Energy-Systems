// A password-reset or verification link is a secret for the account owner. The public endpoints must never hand it
// to the caller. Run: node --import tsx --test userAuthDb.resetLink.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RAILWAY_POSTGREST_URL;
const { registerUser, requestPasswordReset } = await import("./userAuthDb.ts");

const emptyDb = () => ({ users: [] as any[], customers: [] as any[], leads: [] as any[], tickets: [], netMeteringHistory: [], inventory: [], projects: [], netMeteringTrackers: {}, paymentTracks: {}, activityLogs: [] });

test("forgot-password never returns the reset link, and answers the same for unknown addresses", async () => {
  const db = emptyDb();
  await registerUser({ username: "owner1", password: "Owner-Pass-123!", name: "Owner One", email: "owner1@example.test", role: "Customer", phone: "03001234567" }, db as any);
  const known = await requestPasswordReset("owner1@example.test", db as any);
  const unknown = await requestPasswordReset("nobody@example.test", db as any);
  assert.equal("resetUrl" in known, false, "the reset link must not be in the response");
  assert.equal(JSON.stringify(known).includes("token="), false);
  assert.deepEqual(known, unknown, "known and unknown addresses must be indistinguishable");
  assert.ok(db.users[0].reset_token, "the token is still stored so the owner's link works");
});

test("registration does not return the verification link in production", async () => {
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const db = emptyDb();
    const result = await registerUser({ username: "owner2", password: "Owner-Pass-123!", name: "Owner Two", email: "owner2@example.test", role: "Sales Executive" }, db as any);
    assert.ok(!result.verificationUrl, "the verification link must not be returned to the registrant");
    assert.equal(JSON.stringify(result).includes("token="), false);
  } finally { process.env.NODE_ENV = saved; }
});
