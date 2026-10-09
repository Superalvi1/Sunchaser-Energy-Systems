/**
 * Server-side session revocation store (public.revoked_sessions) with a safe degraded mode.
 *
 * Contract:
 *  - A session is identified by its revocation key (token `jti`, or a hash for pre-jti tokens).
 *  - A row means "dead from revoked_at on". revoked_at in the FUTURE is the refresh-rotation grace: the rotated-out
 *    token keeps working for a few seconds so requests already in flight with it do not fail.
 *  - If the table does not exist yet (migration not applied) every check says "not revoked" - the app behaves as it
 *    did before - and revocation is reported INACTIVE (one warning, flag on /health). It re-probes periodically, so
 *    applying the migration activates it without a restart.
 *  - Once the table has been seen working, ANY lookup error is fail-CLOSED: callers get RevocationLookupError
 *    (HTTP 503), never "allow". A revoked token must not pass because the database hiccuped.
 */
import type { Database } from "../../dbManager";
import { getSupabase, isSupabaseActive } from "../../dbManager.ts";

export type RevocationRow = { jti: string; user_id: string; expires_at: string; revoked_at: string; replaced_by?: string | null };

export class RevocationLookupError extends Error {
  readonly statusCode = 503;
  readonly cause?: unknown;
  constructor(message = "Session check unavailable.", cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export interface RevocationBackend {
  find(key: string): Promise<RevocationRow | null>;
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
  return code === "PGRST205" || code === "42P01" || /could not find the table|relation .*revoked_sessions.* does not exist/i.test(msg);
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
    async find(key) {
      const { data, error } = await client().from("revoked_sessions").select("jti,user_id,expires_at,revoked_at,replaced_by").eq("jti", key).maybeSingle();
      if (error) throw error;
      return (data as RevocationRow | null) ?? null;
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
    async find(key) {
      return rows().find((r) => r.jti === key) ?? null;
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
    if (state !== "active" && isMissingRelation(err)) {
      markInactive("table public.revoked_sessions does not exist (migration not applied)");
      return onMissing;
    }
    throw new RevocationLookupError("Session check unavailable.", err);
  }
}

/** One indexed primary-key lookup. Throws RevocationLookupError (fail-closed) on any error once the table has been seen working. */
export async function isSessionRevoked(key: string, localDb?: Database, nowMs = Date.now()): Promise<boolean> {
  if (skipLookup()) return false;
  const backend = backendFor(localDb);
  if (!backend) return false;
  const row = await guarded(() => backend.find(key), null);
  return Boolean(row) && Date.parse(row!.revoked_at) <= nowMs;
}

const farFuture = (nowMs: number, expSec: number | null) => new Date((expSec ?? Math.floor(nowMs / 1000) + 31 * 86400) * 1000).toISOString();

/** Revoke now (logout). Follows `replaced_by` so logging out with a just-rotated token also ends its successor. */
export async function revokeSessionNow(
  key: string,
  userId: string,
  expiresAtSec: number | null,
  localDb?: Database,
  nowMs = Date.now()
): Promise<{ stored: boolean }> {
  if (skipLookup()) return { stored: false };
  const backend = backendFor(localDb);
  if (!backend) return { stored: false };
  const iso = new Date(nowMs).toISOString();
  return guarded<{ stored: boolean }>(async () => {
    const seen = new Set<string>();
    let cursor: string | null = key;
    for (let hop = 0; cursor && hop < 5 && !seen.has(cursor); hop++) {
      seen.add(cursor);
      await backend.insertIfAbsent({ jti: cursor, user_id: userId, expires_at: farFuture(nowMs, expiresAtSec), revoked_at: iso });
      await backend.pullForward(cursor, iso);
      cursor = (await backend.find(cursor))?.replaced_by ?? null;
    }
    return { stored: true };
  }, { stored: false });
}

/**
 * Refresh rotation: the old token dies `graceSeconds` from now and records its successor. Reports whether the old
 * session was ALREADY dead (logged out / revoked earlier) - the caller must then refuse to hand out a new token.
 */
export async function rotateSession(
  oldKey: string,
  newKey: string,
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
    jti: oldKey,
    user_id: userId,
    expires_at: farFuture(nowMs, oldExpiresAtSec),
    revoked_at: new Date(nowMs + graceSeconds * 1000).toISOString(),
    replaced_by: newKey,
  };
  return guarded<{ stored: boolean; alreadyRevoked: boolean }>(async () => {
    await backend.insertIfAbsent(row); // a parallel refresh or an earlier logout keeps its row
    const after = await backend.find(oldKey);
    return { stored: true, alreadyRevoked: Boolean(after) && Date.parse(after!.revoked_at) <= nowMs };
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
    await guarded(() => backend.find("__probe__"), null);
  } catch (err) {
    console.error("[SessionRevocation] startup probe failed; requests will be refused (503) until the store answers:", (err as any)?.cause?.message || (err as Error).message);
  }
}
