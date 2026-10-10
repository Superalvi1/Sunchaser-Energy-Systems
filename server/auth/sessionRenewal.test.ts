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

// ---- Absolute lifetime, JWT_EXPIRES_IN parsing and the password-version claim -------------------------------------

import {
  assertProductionJwtConfig,
  jwtLifetimeSeconds,
  passwordVersion,
  passwordVersionMatches,
  sessionLimitViolation,
  verifySessionToken,
} from "./jwt.ts";

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("JWT_EXPIRES_IN: hours, days and minutes parse; a bare number means seconds (not milliseconds)", () => {
  assert.equal(jwtLifetimeSeconds("8h"), 8 * 3600);
  assert.equal(jwtLifetimeSeconds("30d"), 30 * DAY);
  assert.equal(jwtLifetimeSeconds("45m"), 45 * 60);
  assert.equal(jwtLifetimeSeconds("3600"), 3600, 'bare "3600" must be one hour, not 3.6 seconds');
  assert.equal(jwtLifetimeSeconds("2592000"), 30 * DAY);
  assert.throws(() => jwtLifetimeSeconds("abc"));
  assert.throws(() => jwtLifetimeSeconds(""));
  const token = withEnv({ JWT_EXPIRES_IN: "3600" }, () => signAccessToken({ userId: "u1", username: "staff", role: "Admin" }));
  const d = jwt.decode(token) as { iat: number; exp: number };
  assert.equal(d.exp - d.iat, 3600);
});

test("production start-up rejects an unusable JWT_EXPIRES_IN instead of failing every login later", () => {
  const prod = { NODE_ENV: "production", JWT_SECRET: "a-long-synthetic-secret-for-the-startup-check-0001" };
  withEnv({ ...prod, JWT_EXPIRES_IN: "8h" }, () => assertProductionJwtConfig());
  withEnv({ ...prod, JWT_EXPIRES_IN: "3600" }, () => assertProductionJwtConfig());
  for (const bad of ["abc", "0", "-5", "", undefined]) {
    assert.throws(() => withEnv({ ...prod, JWT_EXPIRES_IN: bad }, () => assertProductionJwtConfig()), /JWT_EXPIRES_IN/, String(bad));
  }
});

test("no token outlives the absolute session limit, whatever JWT_EXPIRES_IN says", () => {
  withEnv({ JWT_EXPIRES_IN: "400d", SESSION_MAX_AGE_DAYS: "30" }, () => {
    const login = signAccessToken({ userId: "u1", username: "staff", role: "Admin" });
    const d = jwt.decode(login) as { iat: number; exp: number };
    assert.ok(d.exp - d.iat <= 30 * DAY + 1, "a sign-in token is clamped to the 30-day limit");
  });
  withEnv({ JWT_EXPIRES_IN: "30d", SESSION_MAX_AGE_DAYS: "30" }, () => {
    const startedAt = nowSec() - 29 * DAY;
    const renewed = signAccessToken({ userId: "u1", username: "staff", role: "Admin", sessionStartedAt: startedAt });
    const d = jwt.decode(renewed) as { sst: number; exp: number };
    assert.equal(d.sst, startedAt);
    assert.ok(d.exp <= startedAt + 30 * DAY, "a renewal late in the session ends exactly at the limit");
    assert.ok(d.exp > nowSec(), "and is still usable now");
  });
  withEnv({ JWT_EXPIRES_IN: "8h", SESSION_MAX_AGE_DAYS: "30" }, () => {
    const startedAt = nowSec() - (30 * DAY - 3600);
    const d = jwt.decode(signAccessToken({ userId: "u1", username: "staff", role: "Admin", sessionStartedAt: startedAt })) as { exp: number };
    assert.equal(d.exp, startedAt + 30 * DAY, "8h token with one hour of session left is shortened to one hour");
    assert.throws(() => signAccessToken({ userId: "u1", username: "staff", role: "Admin", sessionStartedAt: nowSec() - 31 * DAY }), /absolute lifetime/);
  });
});

test("the absolute limit is checked for every request, including unknown or future start times", () => {
  const max = 30 * DAY;
  const now = 2_000_000_000;
  const ok = { startedAt: now - 3600, expiresAt: now + 3600 };
  assert.equal(sessionLimitViolation(ok, now, max), null);
  assert.equal(sessionLimitViolation({ startedAt: now - 31 * DAY, expiresAt: now + 3600 }, now, max), "session_too_old", "old session, exp still in the future");
  assert.equal(sessionLimitViolation({ startedAt: now - 30 * DAY, expiresAt: now + 3600 }, now, max), null, "exactly at the limit is still allowed");
  assert.equal(sessionLimitViolation({ startedAt: now + 3600, expiresAt: now + 7200 }, now, max), "future_start");
  assert.equal(sessionLimitViolation({ startedAt: now + 20, expiresAt: now + 7200 }, now, max), null, "a few seconds of clock skew between instances is tolerated");
  assert.equal(sessionLimitViolation({ startedAt: null, expiresAt: now + 3600 }, now, max), "unknown_start");
  assert.equal(sessionLimitViolation({ startedAt: now, expiresAt: null }, now, max), "missing_exp");
  assert.equal(canRenewSession(now + 20, now, max), true);
  assert.equal(canRenewSession(now + 3600, now, max), false);
});

test("password version changes with every stored hash, hides the hash and depends on the server secret", () => {
  const a = "s1:aaaaaaaa:bbbbbbbb";
  const b = "s1:cccccccc:dddddddd";
  const va = passwordVersion(a)!;
  assert.match(va, /^[0-9a-f]{16}$/);
  assert.equal(passwordVersion(a), va, "stable for an unchanged hash");
  assert.notEqual(passwordVersion(b), va, "a new hash (even for the same password, new salt) is a new version");
  assert.ok(!a.includes(va) && !va.includes("aaaaaaaa"));
  assert.equal(passwordVersion(""), null);
  assert.equal(passwordVersion(undefined), null);
  assert.equal(passwordVersionMatches(va, va), true);
  assert.equal(passwordVersionMatches(va, passwordVersion(b)), false);
  assert.equal(passwordVersionMatches(va, null), false);
  const other = withEnv({ JWT_SECRET: "another-synthetic-secret-for-the-version-test-0002" }, () => passwordVersion(a));
  assert.notEqual(other, va, "rotating JWT_SECRET also retires every bound token");
});

test("sign-in and renewal carry the password version; verification exposes start time, expiry and version", () => {
  const pwv = passwordVersion("s1:aa:bb")!;
  const token = signAccessToken({ userId: "u1", username: "staff", role: "Admin", passwordVersion: pwv });
  const v = verifySessionToken(token);
  assert.equal(v.passwordVersion, pwv);
  assert.equal(v.startedAt, (jwt.decode(token) as { iat: number }).iat);
  assert.ok(v.expiresAt! > nowSec());
  const legacy = verifySessionToken(signAccessToken({ userId: "u1", username: "staff", role: "Admin" }));
  assert.equal(legacy.passwordVersion, null, "tokens without the claim stay verifiable");
});

test("tokens signed with another algorithm are refused even with the right secret", () => {
  const hs512 = jwt.sign({ userId: "u1", username: "staff", role: "Admin" }, process.env.JWT_SECRET!, { algorithm: "HS512", expiresIn: "1h" });
  assert.throws(() => verifySessionToken(hs512));
});
