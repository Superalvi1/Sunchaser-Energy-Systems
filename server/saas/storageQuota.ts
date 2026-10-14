import { getCompanyContext } from "./companyContext.ts";
import { FOUNDING_COMPANY_ID, isMultiCompanyEnabled } from "./multiCompany.ts";
import { limitFor } from "./subscriptionLimits.ts";
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
 *  - Concurrent uploads cannot all pass on one stale number: the decision for one company is serialised (a queue per company in this
 *    process), and the bytes of writes that were accepted but not yet finished are counted ("in flight"). A refusal made on a cached
 *    figure is re-checked once against a fresh listing, so a company that deleted files is not refused on old data.
 *  - Known limit: the queue is in this process. With several server processes at once, uploads in different processes can overshoot by
 *    the size of the uploads in flight; the next listing corrects the figure. It is a commercial control, not a security boundary.
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
// Replaceable in tests (no database, no object store).
type Deps = { limitFor: typeof limitFor; list: (ns: RailwayObjectNamespace, prefix: string) => Promise<Array<{ size: number }>>; timeoutMs: number; now: () => number };
const DEFAULT_DEPS: Deps = { limitFor, list: listRailwayObjects, timeoutMs: 8_000, now: () => Date.now() };
let deps: Deps = DEFAULT_DEPS;
export function setStorageQuotaDeps(d: Partial<Deps> | null): void { deps = { ...DEFAULT_DEPS, ...(d || {}) }; resetStorageQuotaCache(); }

// How long a measured usage / a read limit is trusted. Defaults: 60 s and 15 s. A test stack can shorten them (STORAGE_USAGE_CACHE_MS,
// STORAGE_LIMIT_CACHE_MS); the values are read at each use, never cached.
const ttl = (name: string, dflt: number): number => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 && process.env[name] !== undefined && process.env[name] !== "" ? n : dflt; };
const usageTtlMs = () => ttl("STORAGE_USAGE_CACHE_MS", 60_000);
const limitTtlMs = () => ttl("STORAGE_LIMIT_CACHE_MS", 15_000);
// A refusal based on a figure older than this is re-checked once against a fresh listing.
const RECHECK_AFTER_MS = 2_000;

type Account = { listedBytes: number; listedAt: number; committed: number; inflight: number; limitMb: number | null; limitAt: number };
const accounts = new Map<string, Account>();
const queues = new Map<string, Promise<unknown>>();

export function resetStorageQuotaCache(): void { accounts.clear(); queues.clear(); }

const acct = (company: string): Account => {
  let a = accounts.get(company);
  if (!a) { a = { listedBytes: 0, listedAt: -Infinity, committed: 0, inflight: 0, limitMb: null, limitAt: -Infinity }; accounts.set(company, a); }
  return a;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
}

/** One decision at a time per company (the caller holds the queue only while deciding, not while the file is written). */
function serialised<T>(company: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(company) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(company, tail);
  void tail.then(() => { if (queues.get(company) === tail) queues.delete(company); });
  return run;
}

async function readLimitMb(company: string, a: Account): Promise<number | null> {
  if (deps.now() - a.limitAt < limitTtlMs()) return a.limitMb;
  const mb = await withTimeout(Promise.resolve(deps.limitFor(company, "max_storage_mb")), deps.timeoutMs);
  a.limitMb = mb; a.limitAt = deps.now();
  return mb;
}

async function refreshUsage(company: string, a: Account): Promise<void> {
  let total = 0;
  for (const ns of NAMESPACES) for (const o of await withTimeout(deps.list(ns, `c/${company}/`), deps.timeoutMs)) total += o.size;
  // Accepted writes that finished while we were listing may or may not be in the listing; counting them again can only refuse early,
  // never let a write through, so the figure errs on the safe side.
  a.listedBytes = total; a.listedAt = deps.now(); a.committed = 0;
}

export async function storageUsageBytes(company: string, force = false): Promise<number> {
  const a = acct(company);
  if (force || deps.now() - a.listedAt >= usageTtlMs()) await refreshUsage(company, a);
  return a.listedBytes + a.committed + a.inflight;
}

export type QuotaReservation = {
  /** The write finished: the bytes now belong to the usage figure. */
  commit(): void;
  /** The write failed or was abandoned: give the bytes back. */
  release(): void;
};
const NOOP: QuotaReservation = { commit() {}, release() {} };

/** Called before an object is written. Throws a StorageError when the write must not happen. */
export async function reserveStorage(addBytes: number, env: NodeJS.ProcessEnv = process.env): Promise<QuotaReservation> {
  if (!isMultiCompanyEnabled(env) || !(addBytes > 0)) return NOOP;
  const ctx = getCompanyContext();
  if (ctx?.kind !== "company" || ctx.companyId === FOUNDING_COMPANY_ID) return NOOP;
  const company = ctx.companyId;

  return serialised(company, async () => {
    const a = acct(company);
    let limitMb: number | null;
    try { limitMb = await readLimitMb(company, a); }
    catch (err) {
      console.warn("[storage-limit] could not read the limit; the write is refused (retryable):", err instanceof Error ? err.message : err);
      throw new StorageUnverifiedError();
    }
    if (limitMb === null) throw new StorageLimitNotSetError();
    const limitBytes = limitMb * 1024 * 1024;

    const used = async (): Promise<number> => {
      try { return await storageUsageBytes(company); }
      catch (err) {
        console.warn("[storage-limit] could not measure usage; the write is refused (retryable):", err instanceof Error ? err.message : err);
        throw new StorageUnverifiedError();
      }
    };

    let current = await used();
    if (current + addBytes > limitBytes && deps.now() - a.listedAt > RECHECK_AFTER_MS) {
      // Do not refuse on an old figure: files may have been deleted since the last listing.
      try { await refreshUsage(company, a); }
      catch (err) {
        console.warn("[storage-limit] could not re-measure usage; the write is refused (retryable):", err instanceof Error ? err.message : err);
        throw new StorageUnverifiedError();
      }
      current = a.listedBytes + a.committed + a.inflight;
    }
    if (current + addBytes > limitBytes) throw new StorageQuotaError(limitMb, current, addBytes);

    a.inflight += addBytes;
    let settled = false;
    return {
      commit() { if (settled) return; settled = true; a.inflight = Math.max(0, a.inflight - addBytes); a.committed += addBytes; },
      release() { if (settled) return; settled = true; a.inflight = Math.max(0, a.inflight - addBytes); },
    };
  });
}
