// Journey 9: server-side logout and session revocation (real HTTP against the disposable stack).
//
// Server must be started with a short rotation grace and fast re-probe, and a raised refresh limit, e.g.
//   SESSION_REFRESH_GRACE_SECONDS=3 SESSION_REVOCATION_REPROBE_MS=300 REFRESH_RATE_LIMIT_MAX=500 node dist/server.cjs
// Environment: E2E_BASE_URL, E2E_PSQL, TEST_PW (see lib.mjs); E2E_STACK_DIR + POSTGREST_BIN + E2E_PGRST_PID let the
// script stop/restart PostgREST for the lookup-failure scenario (otherwise that one scenario is reported as SKIP).
// The script drops/re-creates the revocation objects on the DISPOSABLE database to test both deploy orders.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { STATE, BASE, sql, check, save, PW } from "./lib.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const PSQL = (process.env.E2E_PSQL || "").split(" ").filter(Boolean);
const { execFileSync } = await import("node:child_process");
const psqlFile = (f) => execFileSync("psql", [...PSQL, "-v", "ON_ERROR_STOP=1", "-q", "-f", ROOT + f], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const GRACE_MS = Number(process.env.E2E_GRACE_SECONDS || 3) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

async function call(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : method === "POST" ? "{}" : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const login = async (username = "t_sales") => (await call(null, "POST", "/api/auth/login", { username, password: PW })).json.token;
const me = (t) => call(t, "GET", "/api/auth/me").then((r) => r.status);
const health = async () => (await (await fetch(BASE + "/health")).json()).sessionRevocationActive;
async function waitForActive(want, ms = 15000) {
  const end = Date.now() + ms;
  let tok = await login("t_accounts");
  while (Date.now() < end) {
    await me(tok); // a request triggers the (fast) re-probe
    if ((await health()) === want) return true;
    await sleep(300);
  }
  return false;
}

// --- Phase A: migration NOT applied (code deployed before the SQL) -----------------------------------------------
psqlFile("scripts/session-revocation-rollback.sql");
sql("notify pgrst, 'reload schema'");
await sleep(1500);
const admin0 = await login("t_admin");
const legacyStyle = await login("t_sales");
check("A1 migration absent: login/requests work as before", (await me(legacyStyle)) === 200);
await waitForActive(false, 5000);
check("A2 migration absent: /health states revocation is INACTIVE", (await health()) === false);
const lo = await call(legacyStyle, "POST", "/api/auth/logout");
check("A3 migration absent: logout answers 200 but says revoked:false (no pretending)", lo.status === 200 && lo.json.revoked === false && lo.json.reason === "revocation_inactive", JSON.stringify(lo.json));
check("A4 migration absent: token keeps working (old behaviour, not a 500)", (await me(legacyStyle)) === 200);
const loAll = await call(legacyStyle, "POST", "/api/auth/logout-all");
check("A5 migration absent: logout-all is refused with a clear 503, not a silent success", loAll.status === 503 && /not available/i.test(loAll.json.error || ""), JSON.stringify(loAll));
const rf = await call(legacyStyle, "POST", "/api/auth/refresh");
check("A6 migration absent: refresh still works", rf.status === 200 && Boolean(rf.json.token));
const sus0 = await call(admin0, "PATCH", "/api/admin/users/u-test-sales", { accountStatus: "Suspended" });
const susMe = await me(legacyStyle);
await call(admin0, "PATCH", "/api/admin/users/u-test-sales", { accountStatus: "Approved" });
check("A7 migration absent: admin suspend still works and suspended token is refused", sus0.status === 200 && susMe === 403, `${sus0.status}/${susMe}`);

// --- Apply migration twice (idempotent) and confirm the running server activates without a restart -------------------
const preTok = await login("t_sales"); // issued BEFORE the migration: carries a jti, no `se`
psqlFile("scripts/session-revocation-schema.sql");
psqlFile("scripts/session-revocation-schema.sql");
check("M1 migration applies twice without error", true);
check("M2 server activates revocation without restart", await waitForActive(true));
check("M3 token issued before the migration still works after it", (await me(preTok)) === 200);

// --- Phase B: core behaviour -----------------------------------------------------------------------------------------
{
  const a = await login(), b = await login();
  check("B1 every login token has a unique jti", b64(a).jti && b64(a).jti !== b64(b).jti);
  check("B2 before logout both tokens work", (await me(a)) === 200 && (await me(b)) === 200);
  const out = await call(a, "POST", "/api/auth/logout");
  check("B3 POST /api/auth/logout answers 200 revoked:true", out.status === 200 && out.json.revoked === true, JSON.stringify(out.json));
  check("B4 logged-out token is refused (401) on reuse", (await me(a)) === 401);
  check("B5 device B (second login) is still signed in", (await me(b)) === 200);
  check("B6 logout is idempotent: second logout with dead token is 401, nothing breaks", (await call(a, "POST", "/api/auth/logout")).status === 401 && (await me(b)) === 200);
  const rfAfter = await call(a, "POST", "/api/auth/refresh");
  check("B7 a logged-out token cannot be refreshed (401, no token)", rfAfter.status === 401 && !rfAfter.json.token);
  const c = await login();
  check("B8 signing in again after logout works", (await me(c)) === 200);
  const rows = Number(sql(`select count(*) from public.revoked_sessions where jti='s:${b64(a).sid}'`));
  check("B9 exactly one revoked_sessions row (the session family) for the logged-out sign-in", rows === 1);
}

// --- Phase C: logout-all -------------------------------------------------------------------------------------------------
{
  const a = await login(), b = await login(), accountsTok = await login("t_accounts");
  const r = await call(a, "POST", "/api/auth/logout-all");
  check("C1 logout-all answers 200", r.status === 200, JSON.stringify(r.json));
  check("C2 logout-all kills BOTH of the caller's sessions", (await me(a)) === 401 && (await me(b)) === 401);
  check("C3 another user is unaffected", (await me(accountsTok)) === 200);
  const fresh = await login();
  check("C4 a new sign-in after logout-all works and carries the new epoch", (await me(fresh)) === 200 && b64(fresh).se >= 1);
  check("C5 refresh of a logout-all'd token is refused", (await call(a, "POST", "/api/auth/refresh")).status === 401);
}

// --- Phase D: refresh rotation ---------------------------------------------------------------------------------------------
{
  const old = await login();
  const r1 = await call(old, "POST", "/api/auth/refresh");
  const fresh = r1.json.token;
  check("D1 refresh returns a NEW token with a different jti (same session family and start)", r1.status === 200 && b64(fresh).jti !== b64(old).jti && b64(fresh).sid === b64(old).sid && b64(fresh).sst === b64(old).iat);
  check("D2 inside the grace window the old token still works (in-flight requests)", (await me(old)) === 200);
  const parallel = await Promise.all([call(old, "POST", "/api/auth/refresh"), call(old, "POST", "/api/auth/refresh")]);
  check("D3 two parallel refreshes with the same old token inside grace both succeed", parallel.every((p) => p.status === 200));
  await sleep(GRACE_MS + 800);
  check("D4 after the grace period the old token is dead (401)", (await me(old)) === 401);
  check("D5 the rotated-out token cannot be refreshed again", (await call(old, "POST", "/api/auth/refresh")).status === 401);
  check("D6 the new token works", (await me(fresh)) === 200);
  const second = await call(fresh, "POST", "/api/auth/refresh");
  check("D7 chained rotation works (refresh of the refreshed token)", second.status === 200 && b64(second.json.token).jti !== b64(fresh).jti);
  // logout using the OLD token inside the grace window must also end the successor
  const o2 = await login();
  const n2 = (await call(o2, "POST", "/api/auth/refresh")).json.token;
  const lg = await call(o2, "POST", "/api/auth/logout");
  check("D8 logout with a just-rotated token ends it at once and its successor too (same session family)", lg.status === 200 && (await me(o2)) === 401 && (await me(n2)) === 401);
  // rotating with a revoked token never resurrects it
  const o3 = await login();
  await call(o3, "POST", "/api/auth/logout");
  const rr = await call(o3, "POST", "/api/auth/refresh");
  check("D9 refresh cannot resurrect a revoked token", rr.status === 401 && !rr.json.token);
}

// --- Phase E: admin actions --------------------------------------------------------------------------------------------------
{
  const admin = await login("t_admin");
  const s1 = await login(), s2 = await login();
  const susp = await call(admin, "PATCH", "/api/admin/users/u-test-sales", { accountStatus: "Suspended" });
  check("E1 suspended user is refused", susp.status === 200 && (await me(s1)) === 403);
  const appr = await call(admin, "PATCH", "/api/admin/users/u-test-sales", { accountStatus: "Approved" });
  check("E2 after RE-APPROVAL the old tokens stay dead (401)", appr.status === 200 && (await me(s1)) === 401 && (await me(s2)) === 401);
  const post = await login();
  check("E3 a token issued after re-approval works", (await me(post)) === 200);
  const rev = await call(admin, "POST", "/api/admin/users/u-test-sales/revoke-sessions");
  check("E4 admin 'revoke sessions' kills every session of the user without suspending", rev.status === 200 && (await me(post)) === 401 && (await login()) !== undefined);
  const nonAdmin = await call(await login("t_accounts"), "POST", "/api/admin/users/u-test-sales/revoke-sessions");
  check("E5 a non-admin cannot revoke other users' sessions", nonAdmin.status === 403 || nonAdmin.status === 401, String(nonAdmin.status));
  const pend = await login();
  await call(admin, "PATCH", "/api/admin/users/u-test-sales", { accountStatus: "Pending" });
  await call(admin, "PATCH", "/api/admin/users/u-test-sales", { accountStatus: "Approved" });
  check("E6 role-status change to Pending also retires tokens", (await me(pend)) === 401);
  // password reset still kills tokens
  const pwTok = await login("t_accounts");
  const chg = await call(admin, "PATCH", "/api/admin/users/u-test-accounts", { password: PW });
  check("E7 admin password reset still kills earlier tokens", chg.status === 200 && (await me(pwTok)) === 401);
  check("E8 customer role can log out (portal user)", await (async () => { const t = await login("t_portal_a"); const r = await call(t, "POST", "/api/auth/logout"); return r.status === 200 && (await me(t)) === 401; })());
}

// --- Phase F: concurrency ----------------------------------------------------------------------------------------------------
{
  const t = await login();
  await call(t, "POST", "/api/auth/logout");
  const burst = await Promise.all(Array.from({ length: 50 }, () => me(t)));
  check("F1 50 parallel requests with a just-revoked token are all 401", burst.every((s) => s === 401), JSON.stringify([...new Set(burst)]));
  const t2 = await login();
  const inflight = Array.from({ length: 30 }, () => me(t2));
  const lg = call(t2, "POST", "/api/auth/logout");
  const settled = await Promise.all([...inflight, lg.then((r) => r.status)]);
  const afterLogout = await Promise.all(Array.from({ length: 30 }, () => me(t2)));
  check("F2 concurrent logout + requests: no 5xx; every request after the logout completed is 401", settled.slice(0, 30).every((s) => s === 200 || s === 401) && settled[30] === 200 && afterLogout.every((s) => s === 401), JSON.stringify({ during: [...new Set(settled.slice(0, 30))], after: [...new Set(afterLogout)] }));
  const t3 = await login();
  const rfl = Array.from({ length: 5 }, () => call(t3, "POST", "/api/auth/refresh"));
  const lg3 = call(t3, "POST", "/api/auth/logout");
  const res3 = await Promise.all([...rfl, lg3]);
  const successors = res3.slice(0, 5).filter((r) => r.status === 200).map((r) => r.json.token);
  await sleep(300);
  const alive = await Promise.all(successors.map(me));
  check("F3 logout racing 5 parallel refreshes: only 200/401, and EVERY token minted by those refreshes is dead afterwards (session family)", res3.every((r) => [200, 401].includes(r.status)) && (await me(t3)) === 401 && alive.every((s) => s === 401), JSON.stringify({ statuses: res3.map((r) => r.status), successorStatuses: alive }));
}

// --- Phase G: revocation lookup failure is fail-closed -----------------------------------------------------------------
{
  const live = await login();
  const dead = await login();
  await call(dead, "POST", "/api/auth/logout");
  check("G0 precondition: revocation active", (await health()) === true);
  // G1: only the revoked_sessions lookup fails (permission denied for the app's role; users table still readable)
  sql("revoke select on public.revoked_sessions from service_role");
  const liveS = await me(live), deadS = await me(dead), burst = await Promise.all(Array.from({ length: 10 }, () => me(dead)));
  sql("grant select on public.revoked_sessions to service_role");
  check("G1 revocation lookup error: fail-CLOSED - valid and revoked tokens both get 503, the revoked one is never allowed", liveS === 503 && deadS === 503 && burst.every((s) => s === 503), `${liveS}/${deadS}/${[...new Set(burst)]}`);
  await sleep(300);
  check("G2 once the store answers again, a revoked token is 401 and a good one 200", (await me(dead)) === 401 && (await me(live)) === 200);
  const lo = await (async () => { sql("revoke insert on public.revoked_sessions from service_role"); const r = await call(live, "POST", "/api/auth/logout"); sql("grant insert on public.revoked_sessions to service_role"); return r.status; })();
  check("G3 logout while the store is failing is refused (503), not reported as success", lo === 503, String(lo));
  // G4: whole data API down
  const pid = Number(process.env.E2E_PGRST_PID || 0);
  if (pid && process.env.POSTGREST_BIN && process.env.E2E_STACK_DIR) {
    process.kill(pid, "SIGTERM");
    await sleep(1200);
    const down = await Promise.all([me(live), me(dead)]);
    const h = (await fetch(BASE + "/health")).status;
    check("G4 data API stopped: authenticated requests get 503 (never 200 for a revoked token), /health still answers", down.every((s) => s === 503) && h === 200, JSON.stringify({ down, h }));
    const child = spawn(process.env.POSTGREST_BIN, [`${process.env.E2E_STACK_DIR}/pgrst.conf`], { detached: true, stdio: "ignore" });
    child.unref();
    fs.writeFileSync(`${STATE}/pgrst.pid`, String(child.pid));
    await sleep(2500);
    check("G5 after the data API returns: revoked token 401, valid token 200", (await me(dead)) === 401 && (await me(live)) === 200);
  } else {
    console.log("SKIP: G4/G5 need E2E_PGRST_PID, POSTGREST_BIN and E2E_STACK_DIR");
  }
}

// --- Phase H: rollback and re-apply -------------------------------------------------------------------------------------------
{
  const tok = await login();
  await call(tok, "POST", "/api/auth/logout");
  psqlFile("scripts/session-revocation-rollback.sql");
  sql("notify pgrst, 'reload schema'");
  await sleep(1500);
  const after = await me(tok);
  check("H1 after rollback the app keeps serving (no 500/503) and /health says INACTIVE; the logged-out token works again (documented rollback effect)", after === 200 && (await health()) === false, `${after}/${await health()}`);
  psqlFile("scripts/session-revocation-schema.sql");
  await sleep(1500);
  check("H2 re-apply restores enforcement", await waitForActive(true));
  check("H3 purge-eligible rows exist only for expired tokens (none expired yet)", Number(sql("select count(*) from public.revoked_sessions where expires_at < now()")) === 0);
}

save(`${STATE}/j9-results.json`);
