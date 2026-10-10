import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { hashPassword } from "../../src/lib/passwordHash.ts";
import { isReservedStaffUsername, resolveAppUserRole } from "../../dbManager.ts";
import { registerUser, UserAuthError } from "../../userAuthDb.ts";
import { hydrateActorFromJwt } from "../middleware/actor.ts";
import { createUserRateLimit } from "../middleware/rateLimit.ts";
import { passwordVersion, signAccessToken } from "./jwt.ts";

process.env.JWT_SECRET = "fixture-secret-for-session-revocation-tests-0001";
process.env.JWT_EXPIRES_IN = "8h";
delete process.env.SESSION_MAX_AGE_DAYS;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RAILWAY_POSTGREST_URL;

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

function fixtureDb() {
  const user = (id: string, username: string, role: string, status = "Approved") => ({
    id, username, name: username, email: `${username}@example.invalid`, role, account_status: status, email_verified: true, password: hashPassword("original-pw"),
  });
  return {
    users: [user("u-sales", "sales1", "Sales Executive"), user("u-susp", "susp1", "Sales Executive", "Suspended"), user("u-pend", "pend1", "Sales Executive", "Pending"), user("u-rej", "rej1", "Sales Executive", "Rejected")],
  };
}
const rowOf = (db: ReturnType<typeof fixtureDb>, username: string) => db.users.find((u) => u.username === username)!;
const tokenFor = (db: ReturnType<typeof fixtureDb>, username: string, extra: { sessionStartedAt?: number; bind?: boolean } = {}) => {
  const row = rowOf(db, username);
  return signAccessToken({ userId: row.id, username, role: row.role, sessionStartedAt: extra.sessionStartedAt, passwordVersion: extra.bind === false ? undefined : passwordVersion(row.password) });
};
const hydrate = (token: string, db: ReturnType<typeof fixtureDb>) => hydrateActorFromJwt(token, db as never);
const reason = (r: Awaited<ReturnType<typeof hydrate>>) => (r.ok ? "ok" : (r as { reason: string }).reason);

test("a password change or reset retires every token minted before it", async () => {
  const db = fixtureDb();
  const stolen = tokenFor(db, "sales1");
  assert.equal(reason(await hydrate(stolen, db)), "ok");
  rowOf(db, "sales1").password = hashPassword("new-pw-after-reset"); // what admin reset and self-service reset both do
  assert.equal(reason(await hydrate(stolen, db)), "password_changed");
  assert.equal(reason(await hydrate(tokenFor(db, "sales1"), db)), "ok", "a token minted after the change works");
});

test("setting the SAME password again still changes the stored salted hash and so retires old tokens", async () => {
  const db = fixtureDb();
  const old = tokenFor(db, "sales1");
  rowOf(db, "sales1").password = hashPassword("original-pw");
  assert.equal(reason(await hydrate(old, db)), "password_changed");
});

test("tokens issued before the password-version claim existed keep working until they expire", async () => {
  const db = fixtureDb();
  const legacy = tokenFor(db, "sales1", { bind: false });
  assert.equal(jwt.decode(legacy) && (jwt.decode(legacy) as Record<string, unknown>).pwv, undefined);
  assert.equal(reason(await hydrate(legacy, db)), "ok");
  rowOf(db, "sales1").password = hashPassword("changed");
  assert.equal(reason(await hydrate(legacy, db)), "ok", "documented limit: an unbound legacy token cannot be revoked by a password change");
});

test("renewal is re-bound to the current password: the renewed token dies with the next change", async () => {
  const db = fixtureDb();
  const first = await hydrate(tokenFor(db, "sales1"), db);
  assert.ok(first.ok && first.session);
  const renewed = signAccessToken({ userId: "u-sales", username: "sales1", role: "Sales Executive", sessionStartedAt: first.session!.startedAt!, passwordVersion: first.session!.passwordVersion });
  assert.equal(reason(await hydrate(renewed, db)), "ok");
  rowOf(db, "sales1").password = hashPassword("changed");
  assert.equal(reason(await hydrate(renewed, db)), "password_changed");
});

test("suspended, rejected and pending accounts are refused even with a valid token", async () => {
  const db = fixtureDb();
  for (const name of ["susp1", "rej1", "pend1"]) {
    const r = await hydrate(tokenFor(db, name), db);
    assert.equal(r.ok, false, name);
    if (!r.ok) assert.equal(r.status, 403, name);
  }
  rowOf(db, "sales1").account_status = "Suspended";
  assert.equal((await hydrate(tokenFor(db, "sales1"), db)).ok, false);
});

test("role comes from the database on every request, never from the token", async () => {
  const db = fixtureDb();
  const token = tokenFor(db, "sales1");
  rowOf(db, "sales1").role = "Super Admin";
  const up = await hydrate(token, db);
  assert.ok(up.ok && up.actor.role === "Super Admin");
  rowOf(db, "sales1").role = "Customer";
  const down = await hydrate(token, db);
  assert.ok(down.ok && down.actor.role === "Customer");
  const forged = jwt.sign({ userId: "u-sales", username: "sales1", role: "Super Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  const f = await hydrate(forged, db);
  assert.ok(f.ok && f.actor.role === "Customer");
});

test("a deleted user is rejected, and a re-created username does not inherit the old token", async () => {
  const db = fixtureDb();
  const token = tokenFor(db, "sales1");
  db.users = db.users.filter((u) => u.username !== "sales1");
  assert.equal(reason(await hydrate(token, db)), "user_not_found");
  db.users.push({ ...fixtureDb().users[0], id: "u-sales-NEW" });
  assert.equal(reason(await hydrate(token, db)), "token_user_mismatch");
});

test("the absolute session limit is enforced on every request, not only on /api/auth/refresh", async () => {
  const db = fixtureDb();
  const row = rowOf(db, "sales1");
  const mint = (claims: Record<string, unknown>) => jwt.sign({ userId: row.id, username: "sales1", role: row.role, pwv: passwordVersion(row.password), ...claims }, process.env.JWT_SECRET!);
  assert.equal(reason(await hydrate(mint({ sst: nowSec() - 31 * DAY, iat: nowSec(), exp: nowSec() + 3600 }), db)), "session_too_old");
  assert.equal(reason(await hydrate(mint({ iat: nowSec() - 45 * DAY, exp: nowSec() + 355 * DAY }), db)), "session_too_old");
  assert.equal(reason(await hydrate(mint({ sst: nowSec() + 3600, iat: nowSec(), exp: nowSec() + 3600 }), db)), "future_start");
  assert.equal(reason(await hydrate(mint({ iat: nowSec() }), db)), "missing_exp");
  assert.equal(reason(await hydrate(mint({ sst: nowSec() - 29 * DAY, iat: nowSec(), exp: nowSec() + 3600 }), db)), "ok");
  assert.equal(reason(await hydrate(mint({ iat: nowSec() - 1, exp: nowSec() - 1 }), db)), "invalid_jwt", "expired");
});

test("a token with neither sst nor iat has an unknown age and is refused", async () => {
  const db = fixtureDb();
  const row = rowOf(db, "sales1");
  const token = jwt.sign({ userId: row.id, username: "sales1", role: row.role, exp: nowSec() + 3600 }, process.env.JWT_SECRET!, { noTimestamp: true });
  assert.equal(reason(await hydrate(token, db)), "unknown_start");
});

function limiterFixture(max: number, windowMs: number) {
  const limit = createUserRateLimit({ windowMs, max, message: "slow down" });
  const hit = (userId?: string) => {
    let status = 200, retry: string | undefined, passed = false;
    const req = { actor: userId ? { id: userId } : undefined } as unknown as Request;
    const res = { setHeader: (_k: string, v: string) => { retry = v; }, status(c: number) { status = c; return this; }, json() { return this; } } as unknown as Response;
    limit(req, res, (() => { passed = true; }) as NextFunction);
    return { status, retry, passed };
  };
  return hit;
}

test("renewal rate limit is per authenticated user, returns 429 with Retry-After and resets after the window", async () => {
  const hit = limiterFixture(3, 40);
  assert.deepEqual([hit("a").passed, hit("a").passed, hit("a").passed], [true, true, true]);
  const blocked = hit("a");
  assert.equal(blocked.passed, false);
  assert.equal(blocked.status, 429);
  assert.match(String(blocked.retry), /^\d+$/);
  assert.equal(hit("b").passed, true, "another user has its own budget");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(hit("a").passed, true, "window elapsed");
});

test("a stored Customer role is never promoted by username, and reserved staff usernames cannot be self-registered", async () => {
  assert.equal(resolveAppUserRole("allauddin", "Customer"), "Customer");
  assert.equal(resolveAppUserRole("RAZA", "Customer"), "Customer");
  assert.equal(resolveAppUserRole("allauddin", "Admin"), "Super Admin", "existing production mapping is unchanged");
  assert.equal(resolveAppUserRole("raza", "Sales Manager"), "Director");
  assert.equal(resolveAppUserRole("someone", "Technician"), "Technician");
  assert.equal(isReservedStaffUsername(" Allauddin "), true);
  assert.equal(isReservedStaffUsername("constructor"), false);
  assert.equal(isReservedStaffUsername("ordinary"), false);
  const empty = { users: [] as never[] };
  await assert.rejects(
    () => registerUser({ username: "Allauddin", password: "pw-12345678", name: "X", email: "x@example.invalid", role: "Customer" }, empty as never),
    (e: unknown) => e instanceof UserAuthError && /already taken/.test(e.message)
  );
  assert.equal(empty.users.length, 0);
});
