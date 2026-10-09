/**
 * Server-side session revocation store (public.revoked_sessions) with a safe degraded mode.
 *
 * Contract:
 *  - Rows are keyed by `jti` (see sessionKeysFor in jwt.ts): a token id, a session family "s:<sid>" or a hash "h:...".
 *    A row means "dead from revoked_at on". revoked_at in the FUTURE is the refresh-rotation grace: the rotated-out
 *    token keeps working for a few seconds so requests already in flight with it do not fail.
 *  - Every authenticated request costs ONE indexed primary-key query (`jti IN (token id, family)`).
 *  - If the table does not exist (migration not applied, or deliberately rolled back) every check says "not revoked" -
 *    the app behaves as it did before - and revocation is reported INACTIVE (one warning, flag on /health). It
 *    re-probes periodically, so applying the migration activates it without a restart.
 *  - ANY OTHER lookup error (connection, timeout, permission, anything not "relation missing") is fail-CLOSED:
 *    callers get RevocationLookupError (HTTP 503), never "allow". A revoked token must not pass because the database
 *    hiccuped. "Relation missing" is the single deliberate exception: a table that does not exist holds no
 *    revocations, the state is loud (warning + /health) and identical to the not-yet-migrated state.
 */
import type { Database } from "../../dbManager";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import type { SessionKeys } from "./jwt.ts";

export type RevocationRow = { jti: string; user_id: string; expires_at: string; revoked_at: string };

export class RevocationLookupError extends Error {
  readonly statusCode = 503;
  readonly cause?: unknown;
  constructor(message = "Session check unavailable.", cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export interface RevocationBackend {
  /** One query: rows whose key is in `keys`. */
  find(keys: string[]): Promise<RevocationRow[]>;
  /** INSERT ... ON CONFLICT DO NOTHING. */
  insertIfAbsent(row: RevocationRow): Promise<void>;
  /** UPDATE revoked_at = iso WHERE jti = key AND revoked_at > iso (pull a scheduled revocation forward, never postpone). */
  pullForward(key: string, iso: string): Promise<void>;
  purgeExpired(nowIso: string): Promise<number>;
}

type State = "unknown" | "active" | "inactive";
let state: State = "unknown";
let inactiveReason = "";
let lastInactiveCheck = 0;
let backendOverride: RevocationBackend | null = null;
const reprobeMs = () => Number(process.env.SESSION_REVOCATION_REPROBE_MS || 15_000);

export function revocationDisabledByOperator(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(String(env.SESSION_REVOCATION_DISABLED || "").trim());
}

/** Grace (seconds) during which a rotated-out token still works, for requests already in flight. */
export function refreshGraceSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SESSION_REFRESH_GRACE_SECONDS ?? 30);
  return Number.isFinite(n) && n >= 0 && n <= 600 ? n : 30;
}

export function revocationStatus(): { active: boolean; state: State | "disabled"; reason: string } {
  if (revocationDisabledByOperator()) return { active: false, state: "disabled", reason: "SESSION_REVOCATION_DISABLED is set" };
  if (!backendOverride && !isSupabaseActive()) return { active: true, state: "active", reason: "local database.json store" };
  return { active: state === "active", state, reason: inactiveReason };
}

export function setRevocationBackendForTests(b: RevocationBackend | null): void {
  backendOverride = b;
  state = "unknown";
  inactiveReason = "";
  lastInactiveCheck = 0;
}

function isMissingRelation(err: any): boolean {
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  // PostgREST answers 42P01 (relation does not exist) or PGRST205 (table not in schema cache, newer versions).
  return (code === "PGRST205" || code === "42P01") && /revoked_sessions/.test(msg);
}

function markInactive(reason: string): void {
  if (state !== "inactive") {
    console.warn(
      `[SessionRevocation] INACTIVE - ${reason}. Logout and refresh rotation cannot revoke tokens until scripts/session-revocation-schema.sql is applied. ` +
        "The app keeps working exactly as before."
    );
  }
  state = "inactive";
  inactiveReason = reason;
  lastInactiveCheck = Date.now();
}

function markActive(): void {
  if (state !== "active") console.log("[SessionRevocation] ACTIVE - revoked_sessions is reachable; server-side logout is enforced.");
  state = "active";
  inactiveReason = "";
}

function supabaseBackend(): RevocationBackend {
  const client = () => getSupabase()!;
  return {
    async find(keys) {
      const { data, error } = await client().from("revoked_sessions").select("jti,user_id,expires_at,revoked_at").in("jti", keys);
      if (error) throw error;
      return (data as RevocationRow[]) ?? [];
    },
    async insertIfAbsent(row) {
      const { error } = await client().from("revoked_sessions").upsert(row, { onConflict: "jti", ignoreDuplicates: true });
      if (error) throw error;
    },
    async pullForward(key, iso) {
      const { error } = await client().from("revoked_sessions").update({ revoked_at: iso }).eq("jti", key).gt("revoked_at", iso);
      if (error) throw error;
    },
    async purgeExpired(nowIso) {
      const { data, error } = await client().from("revoked_sessions").delete().lt("expires_at", nowIso).select("jti");
      if (error) throw error;
      return (data || []).length;
    },
  };
}

function localBackend(localDb: Database): RevocationBackend {
  const rows = (): RevocationRow[] => ((localDb as any).revokedSessions ||= []);
  return {
    async find(keys) {
      return rows().filter((r) => keys.includes(r.jti));
    },
    async insertIfAbsent(row) {
      if (!rows().some((r) => r.jti === row.jti)) rows().push({ ...row });
    },
    async pullForward(key, iso) {
      const cur = rows().find((r) => r.jti === key);
      if (cur && Date.parse(cur.revoked_at) > Date.parse(iso)) cur.revoked_at = iso;
    },
    async purgeExpired(nowIso) {
      const before = rows().length;
      (localDb as any).revokedSessions = rows().filter((r) => r.expires_at >= nowIso);
      return before - rows().length;
    },
  };
}

function backendFor(localDb: Database | undefined): RevocationBackend | null {
  if (backendOverride) return backendOverride;
  if (isSupabaseActive()) return supabaseBackend();
  return localDb ? localBackend(localDb) : null;
}

/** True when revocation must be skipped right now (operator switch, or table known missing and not yet due for a re-probe). */
function skipLookup(): boolean {
  if (revocationDisabledByOperator()) return true;
  return state === "inactive" && Date.now() - lastInactiveCheck < reprobeMs();
}

async function guarded<T>(fn: () => Promise<T>, onMissing: T): Promise<T> {
  try {
    const out = await fn();
    markActive();
    return out;
  } catch (err) {
    if (isMissingRelation(err)) {
      markInactive("table public.revoked_sessions does not exist (migration not applied or rolled back)");
      return onMissing;
    }
    throw new RevocationLookupError("Session check unavailable.", err);
  }
}

const isDead = (rows: RevocationRow[], nowMs: number) => rows.some((r) => Date.parse(r.revoked_at) <= nowMs);

/** One indexed primary-key query. Throws RevocationLookupError (fail-closed) on any error other than "relation missing". */
export async function isSessionRevoked(keys: string[], localDb?: Database, nowMs = Date.now()): Promise<boolean> {
  if (skipLookup()) return false;
  const backend = backendFor(localDb);
  if (!backend) return false;
  return isDead(await guarded(() => backend.find(keys), [] as RevocationRow[]), nowMs);
}

const endIso = (nowMs: number, expSec: number | null) => new Date((expSec ?? Math.floor(nowMs / 1000) + 31 * 86400) * 1000).toISOString();

/**
 * Logout: revoke `key` now (the session family, or the lone token). A pending rotation-grace row for the same key is
 * pulled forward so the effect is immediate.
 */
export async function revokeSessionNow(
  key: string,
  userId: string,
  endsAtSec: number | null,
  localDb?: Database,
  nowMs = Date.now()
): Promise<{ stored: boolean }> {
  if (skipLookup()) return { stored: false };
  const backend = backendFor(localDb);
  if (!backend) return { stored: false };
  const iso = new Date(nowMs).toISOString();
  return guarded<{ stored: boolean }>(async () => {
    await backend.insertIfAbsent({ jti: key, user_id: userId, expires_at: endIso(nowMs, endsAtSec), revoked_at: iso });
    await backend.pullForward(key, iso);
    return { stored: true };
  }, { stored: false });
}

/**
 * Refresh rotation: the presented token dies `graceSeconds` from now. Reports whether the session was ALREADY dead
 * (logged out / revoked earlier, checked AFTER the write so a racing logout is seen) - the caller must then refuse to
 * hand out the new token. A logout that lands later still kills the new token, because it shares the session family.
 */
export async function rotateSession(
  keys: SessionKeys,
  userId: string,
  oldExpiresAtSec: number | null,
  graceSeconds: number,
  localDb?: Database,
  nowMs = Date.now()
): Promise<{ stored: boolean; alreadyRevoked: boolean }> {
  if (skipLookup()) return { stored: false, alreadyRevoked: false };
  const backend = backendFor(localDb);
  if (!backend) return { stored: false, alreadyRevoked: false };
  const row: RevocationRow = {
    jti: keys.rotateKey,
    user_id: userId,
    expires_at: endIso(nowMs, oldExpiresAtSec),
    revoked_at: new Date(nowMs + graceSeconds * 1000).toISOString(),
  };
  return guarded<{ stored: boolean; alreadyRevoked: boolean }>(async () => {
    await backend.insertIfAbsent(row); // a parallel refresh or an earlier logout keeps its row
    return { stored: true, alreadyRevoked: isDead(await backend.find(keys.checkKeys), nowMs) };
  }, { stored: false, alreadyRevoked: false });
}

export async function purgeExpiredRevocations(localDb?: Database, nowMs = Date.now()): Promise<number> {
  if (skipLookup()) return 0;
  const backend = backendFor(localDb);
  if (!backend) return 0;
  try {
    return await guarded(() => backend.purgeExpired(new Date(nowMs).toISOString()), 0);
  } catch (err) {
    console.error("[SessionRevocation] purge failed (will retry):", (err as any)?.cause?.message || (err as Error).message);
    return 0;
  }
}

/** Startup probe: one cheap query so INACTIVE/ACTIVE is stated in the log at boot, not at the first request. */
export async function probeRevocationStore(localDb?: Database): Promise<void> {
  if (revocationDisabledByOperator()) {
    console.warn("[SessionRevocation] INACTIVE - SESSION_REVOCATION_DISABLED is set (operator switch).");
    return;
  }
  const backend = backendFor(localDb);
  if (!backend) return;
  try {
    await guarded(() => backend.find(["__probe__"]), [] as RevocationRow[]);
  } catch (err) {
    console.error("[SessionRevocation] startup probe failed; requests will be refused (503) until the store answers:", (err as any)?.cause?.message || (err as Error).message);
  }
}
