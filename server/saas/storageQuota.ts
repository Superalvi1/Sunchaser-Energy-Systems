import { getCompanyContext } from "./companyContext.ts";
import { FOUNDING_COMPANY_ID, isMultiCompanyEnabled } from "./multiCompany.ts";
import { limitFor } from "./subscriptionLimits.ts";
import { listRailwayObjects, type RailwayObjectNamespace } from "../storage/railwayObjectStorage.ts";

/**
 * Plan storage limit (saas_plans.max_storage_mb, or limit_overrides.max_storage_mb), checked where files are written.
 *
 * How it stays safe:
 *  - It only ever REFUSES A NEW WRITE. Nothing is deleted, moved or truncated, and files already stored stay readable at any usage.
 *  - Usage is the real size of the company's objects (listing under its own key prefix), cached for 60 seconds, then the bytes of each
 *    accepted write are added at once, so a burst of uploads cannot all pass on a stale number. The cache self-corrects at the next listing.
 *  - A write is reserved before it happens and released if it fails, so a failed upload does not use up the quota.
 *  - It is a commercial control, not a security boundary: it fails OPEN (the write is allowed, with a warning in the log) if the limit or
 *    the usage cannot be read, because refusing every upload on a storage hiccup would be worse than a temporary overshoot. Concurrent
 *    uploads in different server processes can overshoot by the size of the uploads in flight.
 *  - The founding company, a company without a subscription and a plan without a limit are never checked and cost no listing.
 */
export class StorageQuotaError extends Error {
  statusCode = 402;
  code = "storage_limit_exceeded";
  constructor(public limitMb: number, public usedBytes: number, public addBytes: number) {
    super(`Your plan allows ${limitMb} MB of stored files and this upload would exceed it. Delete files you no longer need or contact the platform operator to raise the limit.`);
  }
}

const NAMESPACES: RailwayObjectNamespace[] = ["customer-documents", "quote-assets"];
// Replaceable in tests (no database, no object store).
let deps = { limitFor, list: listRailwayObjects as (ns: RailwayObjectNamespace, prefix: string) => Promise<Array<{ size: number }>> };
export function setStorageQuotaDeps(d: Partial<typeof deps> | null): void { deps = { limitFor, list: listRailwayObjects, ...(d || {}) }; resetStorageQuotaCache(); }
const USAGE_TTL_MS = 60_000;
const LIMIT_TTL_MS = 15_000;
const usage = new Map<string, { at: number; bytes: number }>();
const limits = new Map<string, { at: number; mb: number | null }>();

export function resetStorageQuotaCache(): void { usage.clear(); limits.clear(); }

async function limitMbFor(company: string): Promise<number | null> {
  const hit = limits.get(company);
  if (hit && Date.now() - hit.at < LIMIT_TTL_MS) return hit.mb;
  const mb = await deps.limitFor(company, "max_storage_mb");
  limits.set(company, { at: Date.now(), mb });
  return mb;
}

export async function storageUsageBytes(company: string, force = false): Promise<number> {
  const hit = usage.get(company);
  if (!force && hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.bytes;
  let total = 0;
  for (const ns of NAMESPACES) for (const o of await deps.list(ns, `c/${company}/`)) total += o.size;
  usage.set(company, { at: Date.now(), bytes: total });
  return total;
}

export type QuotaReservation = { release(): void };
const NOOP: QuotaReservation = { release() {} };

/** Called before an object is written. Throws StorageQuotaError when the write would take the company over its limit. */
export async function reserveStorage(addBytes: number, env: NodeJS.ProcessEnv = process.env): Promise<QuotaReservation> {
  if (!isMultiCompanyEnabled(env) || !(addBytes > 0)) return NOOP;
  const ctx = getCompanyContext();
  if (ctx?.kind !== "company" || ctx.companyId === FOUNDING_COMPANY_ID) return NOOP;
  const company = ctx.companyId;
  let limitMb: number | null;
  let used: number;
  try {
    limitMb = await limitMbFor(company);
    if (limitMb === null) return NOOP;
    used = await storageUsageBytes(company);
  } catch (err) {
    console.warn("[storage-limit] could not check the limit; the write is allowed:", err instanceof Error ? err.message : err);
    return NOOP;
  }
  if (used + addBytes > limitMb * 1024 * 1024) throw new StorageQuotaError(limitMb, used, addBytes);
  const entry = usage.get(company);
  if (entry) entry.bytes += addBytes;
  return { release() { const e = usage.get(company); if (e) e.bytes = Math.max(0, e.bytes - addBytes); } };
}
