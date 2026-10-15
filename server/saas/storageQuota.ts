import { getCompanyContext } from "./companyContext.ts";
import { FOUNDING_COMPANY_ID, isMultiCompanyEnabled } from "./multiCompany.ts";
import { limitFor } from "./subscriptionLimits.ts";
import { getSystemSupabase } from "../../dbManager.js";
import { listRailwayObjects, type RailwayObjectNamespace } from "../storage/railwayObjectStorage.ts";

/**
 * Plan storage limit (saas_plans.max_storage_mb, or limit_overrides.max_storage_mb), checked where files are written.
 *
 * What it does and does not do:
 *  - It only ever REFUSES A NEW WRITE. Nothing is deleted, moved or truncated, and files already stored stay readable and downloadable
 *    at any usage, whatever state this module is in (reads, listings and deletes never call it).
 *  - It FAILS CLOSED for a company other than the founding one. A write is accepted only when the company's limit is known AND its usage
 *    was measured AND the write fits. If the limit or the usage cannot be read, or no limit is set at all, the write is refused:
 *      - could not verify  -> StorageUnverifiedError (HTTP 503, code storage_unverified, Retry-After): retryable, nothing was lost;
 *      - no limit set      -> StorageLimitNotSetError (HTTP 403, code storage_limit_not_set): the operator must set a limit
 *                             (onboarding requires one, so there is no unlimited default);
 *      - would exceed it   -> StorageQuotaError (HTTP 402, code storage_limit_exceeded).
 *  - Usage is the real size of the company's objects (a listing under its own key prefix, cached for 60 s).
 *  - Concurrent uploads cannot all pass on one stale number, in this process OR in another: the decision is made by the database
 *    (saas_storage_reserve, scripts/saas/phase2h-storage-reservations.sql) in one short transaction per company under an advisory lock that
 *    every server process takes. The application passes in what its last listing of the object store found (and a "mark" taken before that
 *    listing); the database adds the reservations that are still pending and those that finished after the mark. A write that fails gives its
 *    bytes back at once; a process that dies mid-upload leaves a pending reservation that expires by itself. A refusal made on a listing older than
 *    2 s is re-checked once against a fresh listing, so a company that deleted files is not refused on old data.
 *  - If the reservation functions are not there (migration t8 not applied) or the database cannot be reached, the write is refused as
 *    "could not verify" (retryable): fail closed, never a silent fallback to a weaker check.
 *  - Assumption (not provable here): the object store's listing includes every object whose write has completed (read-after-write listing).
 *    A store with lagging listings could let a burst overshoot by the uploads of the lag window. It is a commercial control, not a security boundary.
 *  - The founding company, requests with no company, and single-company mode are never checked and cost no listing.
 */
export class StorageQuotaError extends Error {
  statusCode = 402;
  code = "storage_limit_exceeded";
  retryable = false;
  constructor(public limitMb: number, public usedBytes: number, public addBytes: number) {
    super(`Your plan allows ${limitMb} MB of stored files and this upload would exceed it. Your existing files are safe and can still be opened. Delete files you no longer need or contact the platform operator to raise the limit.`);
  }
}

export class StorageUnverifiedError extends Error {
  statusCode = 503;
  code = "storage_unverified";
  retryable = true;
  retryAfterSeconds = 30;
  constructor() {
    super("We could not check your storage usage just now, so this upload was not accepted. Nothing was lost and your existing files are unaffected. Please try the upload again in a minute.");
  }
}

export class StorageLimitNotSetError extends Error {
  statusCode = 403;
  code = "storage_limit_not_set";
  retryable = false;
  constructor() {
    super("No storage limit has been set for your company yet, so uploads are paused. Your existing files are unaffected. Ask the platform operator to set a storage limit.");
  }
}

export type StorageError = StorageQuotaError | StorageUnverifiedError | StorageLimitNotSetError;
export const isStorageError = (e: unknown): e is StorageError =>
  e instanceof StorageQuotaError || e instanceof StorageUnverifiedError || e instanceof StorageLimitNotSetError;

/** The JSON body and headers a route sends for a storage refusal. */
export function storageErrorResponse(e: StorageError): { status: number; headers: Record<string, string>; body: Record<string, unknown> } {
  const headers: Record<string, string> = {};
  if (e instanceof StorageUnverifiedError) headers["Retry-After"] = String(e.retryAfterSeconds);
  const body: Record<string, unknown> = { error: e.message, code: e.code, retryable: e.retryable };
  if (e instanceof StorageQuotaError) body.limitMb = e.limitMb;
  return { status: e.statusCode, headers, body };
}

const NAMESPACES: RailwayObjectNamespace[] = ["customer-documents", "quote-assets"];

/** What the database side offers (scripts/saas/phase2h-storage-reservations.sql). A fake with the same semantics is used in unit tests. */
export type ReserveArgs = { company: string; bytes: number; limitBytes: number; measuredBytes: number; measuredSeq: number; pendingTtlSeconds: number; retainSeconds: number };
export type ReserveResult = { ok: true; id: string; used: number } | { ok: false; used: number; inFlight: number };
export type ReservationStore = {
  mark(): Promise<number>;
  reserve(a: ReserveArgs): Promise<ReserveResult>;
  settle(id: string, outcome: "commit" | "release"): Promise<void>;
};

const sysDb = () => { const db = getSystemSupabase(); if (!db) throw new Error("the system database client is not available"); return db; };
const rpcFailure = (fn: string, error: any): Error => {
  const missing = error?.code === "PGRST202" || error?.code === "42883" || /could not find the function|does not exist/i.test(String(error?.message || ""));
  return new Error(missing ? `${fn} is missing: apply migration t8-storage-reservations (${error?.code || ""})` : `${fn} failed: ${error?.code || ""} ${String(error?.message || error).slice(0, 160)}`);
};
/** The real store: the SECURITY DEFINER functions, called with the service role. */
export const rpcReservationStore: ReservationStore = {
  async mark() {
    const { data, error } = await sysDb().rpc("saas_storage_mark");
    if (error) throw rpcFailure("saas_storage_mark", error);
    const n = Number(data); if (!Number.isFinite(n)) throw new Error("saas_storage_mark returned no number");
    return n;
  },
  async reserve(a) {
    const { data, error } = await sysDb().rpc("saas_storage_reserve", {
      p_company: a.company, p_bytes: a.bytes, p_limit_bytes: a.limitBytes, p_measured_bytes: a.measuredBytes, p_measured_seq: a.measuredSeq,
      p_pending_ttl_seconds: a.pendingTtlSeconds, p_retain_seconds: a.retainSeconds,
    });
    if (error) throw rpcFailure("saas_storage_reserve", error);
    const r: any = data;
    if (r?.ok === true && typeof r.id === "string") return { ok: true, id: r.id, used: Number(r.used) };
    if (r?.ok === false) return { ok: false, used: Number(r.used), inFlight: Number(r.in_flight) };
    throw new Error("saas_storage_reserve returned an unexpected answer");
  },
  async settle(id, outcome) {
    const { error } = await sysDb().rpc("saas_storage_settle", { p_id: id, p_outcome: outcome });
    if (error) throw rpcFailure("saas_storage_settle", error);
  },
};

type Deps = {
  limitFor: typeof limitFor;
  list: (ns: RailwayObjectNamespace, prefix: string) => Promise<Array<{ size: number }>>;
  store: ReservationStore;
  timeoutMs: number;
  now: () => number;
};
const DEFAULT_DEPS: Deps = { limitFor, list: listRailwayObjects, store: rpcReservationStore, timeoutMs: 8_000, now: () => Date.now() };

// How long a measured usage / a read limit is trusted. Defaults: 60 s and 15 s. A test stack can shorten them (STORAGE_USAGE_CACHE_MS,
// STORAGE_LIMIT_CACHE_MS); the values are read at each use, never cached.
const ttl = (name: string, dflt: number, env: NodeJS.ProcessEnv = process.env): number => { const n = Number(env[name]); return Number.isFinite(n) && n >= 0 && env[name] !== undefined && env[name] !== "" ? n : dflt; };
const usageTtlMs = () => ttl("STORAGE_USAGE_CACHE_MS", 60_000);
const limitTtlMs = () => ttl("STORAGE_LIMIT_CACHE_MS", 15_000);
// A refusal based on a listing older than this is re-checked once against a fresh listing.
const RECHECK_AFTER_MS = 2_000;
/** A pending reservation of a process that died stops counting after this. Must exceed the object-store write timeout (RAILWAY_S3_TIMEOUT_MS, 60 s). */
const pendingTtlSeconds = (): number => {
  const explicit = Number(process.env.STORAGE_RESERVATION_TTL_SECONDS);
  if (Number.isFinite(explicit) && explicit >= 1 && process.env.STORAGE_RESERVATION_TTL_SECONDS) return Math.floor(explicit);
  const putSeconds = Number(process.env.RAILWAY_S3_TIMEOUT_MS) > 0 ? Number(process.env.RAILWAY_S3_TIMEOUT_MS) / 1000 : 60;
  return Math.ceil(Math.max(180, putSeconds + 120));
};
/** A finished reservation is kept this long so a process whose listing is older still counts it; must exceed the time a listing is trusted. */
const retainSeconds = (): number => Math.ceil(Math.max(900, (usageTtlMs() / 1000) * 3));

export type QuotaReservation = {
  /** The write finished: the bytes stay counted (until a later listing contains them). Never throws. */
  commit(): Promise<void>;
  /** The write failed or was abandoned: give the bytes back at once. Never throws. */
  release(): Promise<void>;
};
const NOOP: QuotaReservation = { async commit() {}, async release() {} };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
}

type Measured = { bytes: number; seq: number; at: number };
type Account = { measured: Measured | null; refreshing: Promise<Measured> | null; limitMb: number | null; limitAt: number };

/**
 * One instance holds the per-process caches (limit, last listing). Every instance that shares a ReservationStore decides against the same
 * reservations, which is how several server processes behave. The server uses the default instance; tests make several.
 */
export function createStorageQuota(initial: Partial<Deps> = {}) {
  const deps: Deps = { ...DEFAULT_DEPS, ...initial };
  const accounts = new Map<string, Account>();
  const acct = (company: string): Account => {
    let a = accounts.get(company);
    if (!a) { a = { measured: null, refreshing: null, limitMb: null, limitAt: -Infinity }; accounts.set(company, a); }
    return a;
  };
  const unverified = (what: string, err: unknown): StorageUnverifiedError => {
    console.warn(`[storage-limit] ${what}; the write is refused (retryable):`, err instanceof Error ? err.message : err);
    return new StorageUnverifiedError();
  };

  async function readLimitMb(company: string, a: Account): Promise<number | null> {
    if (deps.now() - a.limitAt < limitTtlMs()) return a.limitMb;
    const mb = await withTimeout(Promise.resolve(deps.limitFor(company, "max_storage_mb")), deps.timeoutMs);
    a.limitMb = mb; a.limitAt = deps.now();
    return mb;
  }

  /** The mark is taken BEFORE the listing: everything that finished before it is in the listing, and the database counts only what finished after. */
  async function measure(company: string, a: Account): Promise<Measured> {
    if (a.refreshing) return a.refreshing;   // concurrent requests of this process share one listing
    const run = (async () => {
      const seq = await withTimeout(deps.store.mark(), deps.timeoutMs);
      let total = 0;
      for (const ns of NAMESPACES) for (const o of await withTimeout(deps.list(ns, `c/${company}/`), deps.timeoutMs)) total += o.size;
      const m: Measured = { bytes: total, seq, at: deps.now() };
      a.measured = m;
      return m;
    })();
    a.refreshing = run;
    try { return await run; } finally { if (a.refreshing === run) a.refreshing = null; }
  }
  const measuredFor = (company: string, a: Account, force = false): Promise<Measured> =>
    !force && a.measured && deps.now() - a.measured.at < usageTtlMs() ? Promise.resolve(a.measured) : measure(company, a);

  /** What this process's last listing found (plus nothing else): for diagnostics and tests. */
  async function storageUsageBytes(company: string, force = false): Promise<number> {
    return (await measuredFor(company, acct(company), force)).bytes;
  }

  async function reserveStorageInner(addBytes: number, env: NodeJS.ProcessEnv): Promise<QuotaReservation> {
    if (!isMultiCompanyEnabled(env) || !(addBytes > 0)) return NOOP;
    const ctx = getCompanyContext();
    if (ctx?.kind !== "company" || ctx.companyId === FOUNDING_COMPANY_ID) return NOOP;
    const company = ctx.companyId;
    const a = acct(company);

    let limitMb: number | null;
    try { limitMb = await readLimitMb(company, a); } catch (err) { throw unverified("could not read the limit", err); }
    if (limitMb === null) throw new StorageLimitNotSetError();
    const limitBytes = limitMb * 1024 * 1024;

    const attempt = async (m: Measured): Promise<ReserveResult> => {
      try {
        return await withTimeout(deps.store.reserve({ company, bytes: addBytes, limitBytes, measuredBytes: m.bytes, measuredSeq: m.seq, pendingTtlSeconds: pendingTtlSeconds(), retainSeconds: retainSeconds() }), deps.timeoutMs);
      } catch (err) { throw unverified("could not reserve storage", err); }
    };
    const measureOrFail = async (force: boolean): Promise<Measured> => {
      try { return await measuredFor(company, a, force); } catch (err) { throw unverified("could not measure usage", err); }
    };

    let m = await measureOrFail(false);
    let r = await attempt(m);
    if (!r.ok && (deps.now() - m.at > RECHECK_AFTER_MS || r.inFlight > 0)) {
      // Do not refuse on an old listing: files may have been deleted since. Nor while other uploads are in flight or finished after our mark: one of them can already be
      // in our listing AND counted by the database (a write that completed between our mark and our listing), so it is counted twice. A fresh mark and listing settle it.
      m = await measureOrFail(true);
      r = await attempt(m);
    }
    if (!r.ok) throw new StorageQuotaError(limitMb, r.used, addBytes);

    const id = r.id;
    let settled = false;
    const settle = async (outcome: "commit" | "release") => {
      if (settled) return; settled = true;
      try { await withTimeout(deps.store.settle(id, outcome), deps.timeoutMs); }
      // Not fatal: a reservation that could not be settled stays pending (counted, so the limit still holds) and expires by itself.
      catch (err) { console.warn(`[storage-limit] could not ${outcome} reservation ${id}; it will expire by itself:`, err instanceof Error ? err.message : err); }
    };
    return { commit: () => settle("commit"), release: () => settle("release") };
  }

  return {
    /** Called before an object is written. Throws a StorageError when the write must not happen. */
    reserveStorage: (addBytes: number, env: NodeJS.ProcessEnv = process.env) => reserveStorageInner(addBytes, env),
    storageUsageBytes,
    reset: () => { accounts.clear(); },
  };
}

let current = createStorageQuota();
// Replaceable in tests (no database, no object store).
export function setStorageQuotaDeps(d: Partial<Deps> | null): void {
  current = d === null ? createStorageQuota() : createStorageQuota({ store: createMemoryReservationStore(), ...d });
}
export function resetStorageQuotaCache(): void { current.reset(); }
export const reserveStorage = (addBytes: number, env: NodeJS.ProcessEnv = process.env): Promise<QuotaReservation> => current.reserveStorage(addBytes, env);
export const storageUsageBytes = (company: string, force = false): Promise<number> => current.storageUsageBytes(company, force);

/**
 * In-memory store with the SAME semantics as scripts/saas/phase2h-storage-reservations.sql (one decision at a time per company, pending and finished
 * reservations, marks, expiry). For unit tests only; several createStorageQuota() instances sharing one of these behave like several server processes
 * sharing the database.
 */
export function createMemoryReservationStore(opts: { now?: () => number; latencyMs?: number } = {}): ReservationStore & { rows(company?: string): Array<{ id: string; company: string; bytes: number; state: "pending" | "done"; doneSeq: number | null }> } {
  const now = opts.now ?? (() => Date.now());
  type Row = { id: string; company: string; bytes: number; state: "pending" | "done"; doneSeq: number | null; expiresAt: number; retain: number };
  let seq = 0, n = 0; let rows: Row[] = []; const locks = new Map<string, Promise<unknown>>();
  const lag = () => (opts.latencyMs ? new Promise((r) => setTimeout(r, Math.random() * opts.latencyMs!)) : Promise.resolve());
  const locked = <T>(company: string, fn: () => T): Promise<T> => {
    const prev = locks.get(company) || Promise.resolve();
    const run = prev.then(async () => { await lag(); return fn(); });
    locks.set(company, run.catch(() => undefined));
    return run;
  };
  return {
    async mark() { await lag(); return ++seq; },
    reserve: (a) => locked(a.company, () => {
      rows = rows.filter((r) => !(r.company === a.company && r.expiresAt < now()));
      const mine = rows.filter((r) => r.company === a.company);
      const pending = mine.filter((r) => r.state === "pending").reduce((s, r) => s + r.bytes, 0);
      const after = mine.filter((r) => r.state === "done" && (r.doneSeq as number) > a.measuredSeq).reduce((s, r) => s + r.bytes, 0);
      const used = a.measuredBytes + pending + after;
      if (used + a.bytes > a.limitBytes) return { ok: false as const, used, inFlight: pending + after };
      const id = `mem-${++n}`;
      rows.push({ id, company: a.company, bytes: a.bytes, state: "pending", doneSeq: null, expiresAt: now() + a.pendingTtlSeconds * 1000, retain: a.retainSeconds });
      return { ok: true as const, id, used };
    }),
    async settle(id, outcome) {
      await lag();
      if (outcome === "release") { rows = rows.filter((r) => r.id !== id); return; }
      const r = rows.find((x) => x.id === id && x.state === "pending");
      if (r) { r.state = "done"; r.doneSeq = ++seq; r.expiresAt = now() + r.retain * 1000; }
    },
    rows: (company) => rows.filter((r) => !company || r.company === company).map(({ id, company, bytes, state, doneSeq }) => ({ id, company, bytes, state, doneSeq })),
  };
}
