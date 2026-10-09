import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import jwt from "jsonwebtoken";
import { hashPassword } from "../../src/lib/passwordHash.ts";
import { hydrateActorFromJwt } from "../middleware/actor.ts";
import { revokeAllSessions, updateUserByAdmin, rejectUser } from "../../userAuthDb.ts";
import { passwordVersion, sessionKeysFor, sessionKeysOfToken, signAccessToken } from "./jwt.ts";
import {
  isSessionRevoked,
  revocationStatus,
  revokeSessionNow,
  rotateSession,
  setRevocationBackendForTests,
  purgeExpiredRevocations,
  type RevocationBackend,
  type RevocationRow,
} from "./revocation.ts";

process.env.JWT_SECRET = "fixture-secret-for-session-logout-tests-000001";
process.env.JWT_EXPIRES_IN = "8h";
process.env.SESSION_REVOCATION_REPROBE_MS = "0";
delete process.env.SESSION_REVOCATION_DISABLED;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RAILWAY_POSTGREST_URL;

/** In-memory stand-in for public.revoked_sessions with switchable failure modes. */
function fakeBackend() {
  const rows = new Map<string, RevocationRow>();
  const mode = { fail: "" as "" | "missing" | "pg42P01" | "boom" };
  let lookups = 0;
  const gate = () => {
    if (mode.fail === "missing") throw Object.assign(new Error("Could not find the table 'public.revoked_sessions' in the schema cache"), { code: "PGRST205" });
    if (mode.fail === "pg42P01") throw Object.assign(new Error('relation "public.revoked_sessions" does not exist'), { code: "42P01" });
    if (mode.fail === "boom") throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
  };
  const backend: RevocationBackend = {
    async find(keys) { lookups++; gate(); return keys.map((k) => rows.get(k)).filter(Boolean) as RevocationRow[]; },
    async insertIfAbsent(row) { gate(); if (!rows.has(row.jti)) rows.set(row.jti, { ...row }); },
    async pullForward(key, iso) { gate(); const r = rows.get(key); if (r && Date.parse(r.revoked_at) > Date.parse(iso)) r.revoked_at = iso; },
    async purgeExpired(nowIso) { gate(); let n = 0; for (const [k, r] of rows) if (r.expires_at < nowIso) { rows.delete(k); n++; } return n; },
  };
  return { backend, rows, mode, lookups: () => lookups };
}

const user = (id: string, username: string, role: string, status = "Approved") => ({
  id, username, name: username, email: `${username}@example.invalid`, role, account_status: status, email_verified: true, password: hashPassword("original-pw"),
});
const fixtureDb = () => ({ users: [user("u-admin", "admin1", "Super Admin"), user("u-sales", "sales1", "Sales Executive")] });
type Db = ReturnType<typeof fixtureDb>;
const rowOf = (db: Db, username: string) => db.users.find((u) => u.username === username)!;
const tokenFor = (db: Db, username: string, extra: { sessionEpoch?: number; sessionId?: string } = {}) => {
  const r = rowOf(db, username);
  return signAccessToken({ userId: r.id, username, role: r.role, passwordVersion: passwordVersion(r.password), ...extra });
};
const reason = async (token: string, db: Db) => {
  const r = await hydrateActorFromJwt(token, db as never);
  return r.ok ? "ok" : `${(r as { status: number }).status}:${(r as { reason: string }).reason}`;
};
const claims = (t: string) => jwt.decode(t) as Record<string, unknown>;
const logout = (t: string, db?: any) => revokeSessionNow(sessionKeysOfToken(t).logoutKey, "u-sales", claims(t).exp as number, db);
/** What POST /api/auth/refresh does: new token in the same family, old token scheduled to die after the grace. */
async function refresh(db: Db, old: string, graceSeconds = 30, nowMs = Date.now()) {
  const fresh = tokenFor(db, "sales1", { sessionId: String(claims(old).sid) });
  const out = await rotateSession(sessionKeysOfToken(old), "u-sales", claims(old).exp as number, graceSeconds, undefined, nowMs);
  return { fresh, ...out };
}

afterEach(() => setRevocationBackendForTests(null));

test("every issued token carries a unique jti and a session id; pre-jti tokens are keyed by a hash of the token", () => {
  const db = fixtureDb();
  const a = tokenFor(db, "sales1");
  const b = tokenFor(db, "sales1");
  assert.match(String(claims(a).jti), /^[0-9a-f-]{36}$/);
  assert.notEqual(claims(a).jti, claims(b).jti);
  assert.notEqual(claims(a).sid, claims(b).sid, "separate sign-ins are separate sessions");
  const k = sessionKeysOfToken(a);
  assert.deepEqual(k.checkKeys, [claims(a).jti, `s:${claims(a).sid}`]);
  assert.equal(k.logoutKey, `s:${claims(a).sid}`);
  const legacy = jwt.sign({ userId: "u-sales", username: "sales1", role: "Sales Executive" }, process.env.JWT_SECRET!, { expiresIn: "8h" });
  assert.match(sessionKeysFor(legacy, { jti: null, sid: null }).logoutKey, /^h:[0-9a-f]{40}$/);
  assert.equal(sessionKeysFor(legacy, { jti: null, sid: null }).logoutKey, sessionKeysFor(legacy, { jti: null, sid: null }).logoutKey);
  assert.equal("se" in claims(a), false, "epoch 0 is not written to the token");
});

test("logout revokes only that session: the same user's other sign-in keeps working", async () => {
  const f = fakeBackend();
  setRevocationBackendForTests(f.backend);
  const db = fixtureDb();
  const phone = tokenFor(db, "sales1");
  const laptop = tokenFor(db, "sales1");
  assert.equal(await reason(phone, db), "ok");
  assert.equal((await logout(phone)).stored, true);
  assert.equal(await reason(phone, db), "401:session_revoked");
  assert.equal(await reason(laptop, db), "ok");
  assert.equal(await reason(tokenFor(db, "sales1"), db), "ok", "a new sign-in works");
  await logout(phone);
  assert.equal(f.rows.size, 1, "logout is idempotent");
});

test("a token issued before jti existed can still be logged out (hash key) and others are unaffected", async () => {
  const f = fakeBackend();
  setRevocationBackendForTests(f.backend);
  const db = fixtureDb();
  const legacy = jwt.sign({ userId: "u-sales", username: "sales1", role: "Sales Executive" }, process.env.JWT_SECRET!, { expiresIn: "8h" });
  const legacy2 = jwt.sign({ userId: "u-sales", username: "sales1", role: "Sales Executive", x: 1 }, process.env.JWT_SECRET!, { expiresIn: "8h" });
  assert.equal(await reason(legacy, db), "ok", "deploy order: old tokens keep working");
  await logout(legacy);
  assert.equal(await reason(legacy, db), "401:session_revoked");
  assert.equal(await reason(legacy2, db), "ok");
});

test("sign out of all devices kills every earlier token (even legacy ones) but not later sign-ins", async () => {
  setRevocationBackendForTests(fakeBackend().backend);
  const db = fixtureDb();
  const a = tokenFor(db, "sales1");
  const b = tokenFor(db, "sales1");
  const legacy = jwt.sign({ userId: "u-sales", username: "sales1", role: "Sales Executive" }, process.env.JWT_SECRET!, { expiresIn: "8h" });
  const other = tokenFor(db, "admin1");
  await revokeAllSessions("u-sales", db as never);
  assert.equal((rowOf(db, "sales1") as any).session_epoch, 1);
  for (const t of [a, b, legacy]) assert.equal(await reason(t, db), "401:session_revoked");
  const fresh = tokenFor(db, "sales1", { sessionEpoch: 1 });
  assert.equal(claims(fresh).se, 1);
  assert.equal(await reason(fresh, db), "ok");
  assert.equal(await reason(other, db), "ok", "other users untouched");
});

test("suspend/reject/pending and the explicit admin action bump the epoch; re-approval does not resurrect old tokens", async () => {
  setRevocationBackendForTests(fakeBackend().backend);
  const db = fixtureDb();
  const before = tokenFor(db, "sales1");
  await updateUserByAdmin("u-admin", "admin1", "u-sales", { accountStatus: "Suspended" }, db as never);
  assert.equal((rowOf(db, "sales1") as any).session_epoch, 1);
  assert.match(await reason(before, db), /^403:/);
  await updateUserByAdmin("u-admin", "admin1", "u-sales", { accountStatus: "Approved" }, db as never);
  assert.equal(await reason(before, db), "401:session_revoked", "approved again, old token stays dead");
  await updateUserByAdmin("u-admin", "admin1", "u-sales", { revokeSessions: true }, db as never);
  assert.equal((rowOf(db, "sales1") as any).session_epoch, 2);
  await updateUserByAdmin("u-admin", "admin1", "u-sales", { accountStatus: "Pending" }, db as never);
  assert.equal((rowOf(db, "sales1") as any).session_epoch, 3);
  await updateUserByAdmin("u-admin", "admin1", "u-sales", { name: "Renamed" }, db as never);
  assert.equal((rowOf(db, "sales1") as any).session_epoch, 3, "ordinary edits sign nobody out");
  await rejectUser("u-admin", "admin1", "u-sales", "no", db as never);
  assert.equal((rowOf(db, "sales1") as any).session_epoch, 4);
});

test("a password reset still retires earlier tokens", async () => {
  setRevocationBackendForTests(fakeBackend().backend);
  const db = fixtureDb();
  const t = tokenFor(db, "sales1");
  rowOf(db, "sales1").password = hashPassword("new-pw");
  assert.equal(await reason(t, db), "401:password_changed");
});

test("refresh rotation: new jti in the same family; old token works during the grace window, then dies", async () => {
  const f = fakeBackend();
  setRevocationBackendForTests(f.backend);
  const db = fixtureDb();
  const oldTok = tokenFor(db, "sales1");
  const t0 = Date.now();
  const r = await refresh(db, oldTok, 30, t0);
  assert.deepEqual({ stored: r.stored, alreadyRevoked: r.alreadyRevoked }, { stored: true, alreadyRevoked: false });
  assert.notEqual(claims(r.fresh).jti, claims(oldTok).jti);
  assert.equal(claims(r.fresh).sid, claims(oldTok).sid);
  assert.equal(await reason(oldTok, db), "ok", "in-flight requests with the old token still succeed inside the grace window");
  const keys = sessionKeysOfToken(oldTok).checkKeys;
  assert.equal(await isSessionRevoked(keys, undefined, t0 + 29_000), false);
  assert.equal(await isSessionRevoked(keys, undefined, t0 + 30_000), true, "dead once the grace has elapsed");
  assert.equal(await reason(r.fresh, db), "ok", "the successor is unaffected by the old token's rotation");
  // A grace that has already elapsed (rotation happened 31 s ago):
  const g = fakeBackend();
  setRevocationBackendForTests(g.backend);
  const old2 = tokenFor(db, "sales1");
  await refresh(db, old2, 30, Date.now() - 31_000);
  assert.equal(await reason(old2, db), "401:session_revoked");
});

test("refresh cannot resurrect a logged-out session, and a logout racing a refresh still kills the new token", async () => {
  setRevocationBackendForTests(fakeBackend().backend);
  const db = fixtureDb();
  const oldTok = tokenFor(db, "sales1");
  await logout(oldTok);
  const r = await refresh(db, oldTok);
  assert.equal(r.alreadyRevoked, true, "caller must refuse to hand out the new token");
  // Refresh first, logout after (with the OLD token): the successor shares the family, so it dies too.
  const old2 = tokenFor(db, "sales1");
  const r2 = await refresh(db, old2);
  assert.equal(await reason(r2.fresh, db), "ok");
  await logout(old2);
  assert.equal(await reason(old2, db), "401:session_revoked");
  assert.equal(await reason(r2.fresh, db), "401:session_revoked", "successor revoked via the session family");
  // Five parallel refreshes then a logout: every descendant dies.
  const old3 = tokenFor(db, "sales1");
  const kids = await Promise.all(Array.from({ length: 5 }, () => refresh(db, old3)));
  await logout(old3);
  for (const k of kids) assert.equal(await reason(k.fresh, db), "401:session_revoked");
});

test("logout inside the grace window pulls the scheduled revocation forward", async () => {
  const f = fakeBackend();
  setRevocationBackendForTests(f.backend);
  const legacy = jwt.sign({ userId: "u-sales", username: "sales1", role: "Sales Executive" }, process.env.JWT_SECRET!, { expiresIn: "8h" });
  const db = fixtureDb();
  const keys = sessionKeysOfToken(legacy);
  await rotateSession(keys, "u-sales", null, 30);
  assert.equal(await reason(legacy, db), "ok");
  await revokeSessionNow(keys.logoutKey, "u-sales", null);
  assert.equal(await reason(legacy, db), "401:session_revoked");
});

test("migration NOT applied: requests behave as before, one clear warning, status INACTIVE; applying it activates without a restart", async () => {
  const f = fakeBackend();
  f.mode.fail = "missing";
  setRevocationBackendForTests(f.backend);
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  try {
    const db = fixtureDb();
    const t = tokenFor(db, "sales1");
    assert.equal(await reason(t, db), "ok");
    assert.equal(await reason(t, db), "ok");
    assert.equal(revocationStatus().active, false);
    assert.equal(revocationStatus().state, "inactive");
    assert.equal((await logout(t)).stored, false, "logout reports that nothing was recorded");
    assert.equal(warnings.filter((w) => w.includes("[SessionRevocation] INACTIVE")).length, 1, "exactly one warning");
    assert.match(warnings.find((w) => w.includes("[SessionRevocation]")) || "", /session-revocation-schema\.sql/);
    f.mode.fail = "";
    assert.equal(await reason(t, db), "ok");
    assert.equal(revocationStatus().active, true);
    await logout(t);
    assert.equal(await reason(t, db), "401:session_revoked");
  } finally {
    console.warn = realWarn;
  }
});

test("a relation-missing error (PostgREST 42P01 or PGRST205) is 'not migrated' even after the store was active (deliberate rollback)", async () => {
  for (const kind of ["missing", "pg42P01"] as const) {
    const f = fakeBackend();
    setRevocationBackendForTests(f.backend);
    const db = fixtureDb();
    const t = tokenFor(db, "sales1");
    assert.equal(await reason(t, db), "ok");
    assert.equal(revocationStatus().active, true);
    const realWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
    try {
      f.mode.fail = kind;
      assert.equal(await reason(t, db), "ok");
      assert.equal(revocationStatus().active, false);
      assert.equal(warnings.filter((w) => w.includes("[SessionRevocation] INACTIVE")).length, 1);
    } finally {
      console.warn = realWarn;
    }
  }
});

test("operator switch SESSION_REVOCATION_DISABLED skips lookups and says INACTIVE", async () => {
  const f = fakeBackend();
  setRevocationBackendForTests(f.backend);
  process.env.SESSION_REVOCATION_DISABLED = "1";
  try {
    const db = fixtureDb();
    const t = tokenFor(db, "sales1");
    f.rows.set(sessionKeysOfToken(t).logoutKey, { jti: sessionKeysOfToken(t).logoutKey, user_id: "u-sales", expires_at: "2999-01-01T00:00:00Z", revoked_at: "2000-01-01T00:00:00Z" });
    assert.equal(await reason(t, db), "ok");
    assert.equal(revocationStatus().active, false);
    assert.equal(f.lookups(), 0);
  } finally {
    delete process.env.SESSION_REVOCATION_DISABLED;
  }
});

test("any other lookup failure is FAIL-CLOSED (503) - never lets a revoked token through, before or after the store was known to work", async () => {
  const f = fakeBackend();
  setRevocationBackendForTests(f.backend);
  const db = fixtureDb();
  const revoked = tokenFor(db, "sales1");
  await logout(revoked);
  f.mode.fail = "boom";
  assert.equal(await reason(revoked, db), "503:revocation_lookup_failed");
  assert.equal(await reason(tokenFor(db, "sales1"), db), "503:revocation_lookup_failed", "even tokens that are fine are refused, not guessed");
  f.mode.fail = "";
  assert.equal(await reason(revoked, db), "401:session_revoked");
  // Unknown state + a non-"relation missing" error at first use is also a refusal.
  const g = fakeBackend();
  g.mode.fail = "boom";
  setRevocationBackendForTests(g.backend);
  assert.equal(await reason(tokenFor(db, "sales1"), db), "503:revocation_lookup_failed");
  await assert.rejects(() => logout(tokenFor(db, "sales1")), (e: any) => e.statusCode === 503, "logout never reports success it did not store");
});

test("exactly one revocation lookup per authenticated request", async () => {
  const f = fakeBackend();
  setRevocationBackendForTests(f.backend);
  const db = fixtureDb();
  const t = tokenFor(db, "sales1");
  await reason(t, db);
  const before = f.lookups();
  await reason(t, db);
  await reason(t, db);
  assert.equal(f.lookups() - before, 2);
});

test("50 parallel requests with a just-revoked token are all refused; concurrent logout never lets later requests pass", async () => {
  setRevocationBackendForTests(fakeBackend().backend);
  const db = fixtureDb();
  const t = tokenFor(db, "sales1");
  await logout(t);
  const res = await Promise.all(Array.from({ length: 50 }, () => reason(t, db)));
  assert.equal(res.filter((r) => r === "401:session_revoked").length, 50);
  const t2 = tokenFor(db, "sales1");
  const before = Promise.all(Array.from({ length: 10 }, () => reason(t2, db)));
  const lo = logout(t2);
  await Promise.all([before, lo]);
  const after = await Promise.all(Array.from({ length: 20 }, () => reason(t2, db)));
  assert.ok(after.every((r) => r === "401:session_revoked"));
});

test("purge removes only rows whose session has already ended", async () => {
  const f = fakeBackend();
  setRevocationBackendForTests(f.backend);
  const now = Date.now();
  await revokeSessionNow("old", "u", Math.floor(now / 1000) - 10);
  await revokeSessionNow("live", "u", Math.floor(now / 1000) + 3600);
  assert.equal(await purgeExpiredRevocations(undefined, now), 1);
  assert.deepEqual([...f.rows.keys()], ["live"]);
});

test("local database.json mode keeps revocations in the same store (no external table needed)", async () => {
  setRevocationBackendForTests(null);
  const db: any = fixtureDb();
  const t = tokenFor(db, "sales1");
  const r = await hydrateActorFromJwt(t, db);
  assert.equal(r.ok, true);
  await logout(t, db);
  assert.equal((await hydrateActorFromJwt(t, db) as any).reason, "session_revoked");
  assert.equal(db.revokedSessions.length, 1);
});
