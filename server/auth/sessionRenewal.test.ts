import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { canRenewSession, sessionMaxAgeSeconds, sessionStartedAtSeconds, signAccessToken } from "./jwt.ts";

process.env.JWT_SECRET = "fixture-secret-for-session-renewal-tests-0001";
process.env.JWT_EXPIRES_IN = "8h";

test("a renewed token keeps the original sign-in time", () => {
  const first = signAccessToken({ userId: "u1", username: "staff", role: "Admin" });
  const started = sessionStartedAtSeconds(first)!;
  assert.equal(started, (jwt.decode(first) as { iat: number }).iat);
  const renewed = signAccessToken({ userId: "u1", username: "staff", role: "Admin", sessionStartedAt: started - 3600 });
  assert.equal(sessionStartedAtSeconds(renewed), started - 3600);
});

test("sessions renew until the absolute limit, then require sign-in", () => {
  const max = sessionMaxAgeSeconds({ SESSION_MAX_AGE_DAYS: "30" } as NodeJS.ProcessEnv);
  assert.equal(max, 30 * 86400);
  const now = 2_000_000_000;
  assert.equal(canRenewSession(now - 29 * 86400, now, max), true);
  assert.equal(canRenewSession(now - 31 * 86400, now, max), false);
  assert.equal(canRenewSession(null, now, max), false);
  assert.equal(canRenewSession(now + 60, now, max), false, "a future start time is invalid");
  assert.equal(sessionMaxAgeSeconds({ SESSION_MAX_AGE_DAYS: "nonsense" } as NodeJS.ProcessEnv), 30 * 86400);
});
