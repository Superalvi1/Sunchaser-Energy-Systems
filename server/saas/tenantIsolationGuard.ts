import type { NextFunction, Request, Response } from "express";
import { FOUNDING_COMPANY_ID, isMultiCompanyEnabled } from "./multiCompany.ts";

/**
 * Isolation that does not depend on the feature flag.
 *
 * With MULTI_COMPANY_ENABLED off, this build reads through the service role with no company filter (the single-company code path). That is only safe while
 * the database holds no other company's data. So the process asks the database, and while any company other than the founding one exists (or while it cannot
 * find out) it refuses to serve: every data route answers 503 `tenant_isolation_unavailable`, and the database client itself throws, so background jobs
 * cannot read across companies either. It never falls back to unfiltered access. With the flag on, the database's own row-level policies isolate the
 * companies and this guard does nothing.
 *
 * What it cannot do alone: it protects only builds that contain it. Older backends and scripts are stopped by the DATABASE (t1b-tenancy-barrier: a persistent marker and a
 * PostgREST pre-request function that refuses service-role requests which do not declare multi-company mode), which also gives this guard its marker: it is not lifted by
 * deleting a companies row.
 */
/**
 * What the database says. marker: the persistent tenancy marker (t1b); otherCompanies: companies other than the founding one; foreignRows: (deep check only) does any
 * tenant table hold a row of another company. tablesMissing: no company tables at all - a single-company database.
 */
export type ProbeResult = { tablesMissing: true } | { otherCompanies: number; marker?: "single" | "multi"; foreignRows?: boolean };
export type ProbeRequest = { deep: boolean };
export type IsolationState = { blocked: boolean; reason: "none" | "tenant_data_present" | "tenancy_marker" | "unverified"; detail: string; checkedAt: number };

export class TenantIsolationError extends Error {
  readonly statusCode = 503;
  readonly code = "tenant_isolation_unavailable";
  constructor(readonly reason: IsolationState["reason"], detail: string) {
    super(
      reason === "tenant_data_present"
        ? `Service paused: this database holds data of more than one company and this server is not running in multi-company mode, so it cannot keep the companies apart. ${detail}`
        : reason === "tenancy_marker"
        ? `Service paused: the database is marked as multi-company (tenancy marker) and this server is not running in multi-company mode. ${detail}`
        : `Service paused: this server could not verify that the database holds one company only. ${detail}`
    );
    this.name = "TenantIsolationError";
  }
}

type Deps = {
  probe: (req: ProbeRequest) => Promise<ProbeResult>;
  deepEveryMs: number;
  flagOn: () => boolean;
  now: () => number;
  ttlMs: number;
  probeTimeoutMs: number;
  log: (msg: string) => void;
};

export function createIsolationGuard(initial: Partial<Deps> = {}) {
  const deps: Deps = {
    probe: async () => ({ tablesMissing: true }),
    flagOn: () => isMultiCompanyEnabled(),
    now: () => Date.now(),
    ttlMs: 5000,
    deepEveryMs: 60_000,
    probeTimeoutMs: 5000,
    log: (m) => console.warn(m),
    ...initial,
  };
  // Until the first answer the guard is closed: a server that has not asked yet serves nothing.
  let state: IsolationState = { blocked: true, reason: "unverified", detail: "The first check has not finished.", checkedAt: -Infinity };
  let inflight: Promise<IsolationState> | null = null;
  let armed = false;
  let lastDeepAt = -Infinity;
  let lastForeignRows = false;    // the last deep answer; kept between deep checks so a "yes" is never forgotten by a cheap one

  const withTimeout = <T,>(p: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("the isolation check timed out")), deps.probeTimeoutMs);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });

  async function runCheck(): Promise<IsolationState> {
    let next: IsolationState;
    let deep = deps.now() - lastDeepAt >= deps.deepEveryMs;
    let deepNow = false;
    try {
      let r = await withTimeout(deps.probe({ deep }));
      // A remembered "yes, other companies' rows exist" must not outlive the marker: the marker can only be cleared by app.tenancy_disable(), which refuses while such rows exist.
      // So when a cheap answer says marker off and no other company while the last deep answer said "yes", ask the deep question again at once instead of waiting for the next
      // scheduled deep check (up to a minute of needless pause after the operator has cleared the marker).
      if (!("tablesMissing" in r) && !deep && lastForeignRows && r.marker === "single" && r.otherCompanies === 0) r = await withTimeout(deps.probe({ deep: true }));
      if (!("tablesMissing" in r) && typeof r.foreignRows === "boolean") deepNow = true;
      if ("tablesMissing" in r) { next = { blocked: false, reason: "none", detail: "No company tables: a single-company database.", checkedAt: deps.now() }; lastForeignRows = false; }
      else {
        if ((deep || deepNow) && typeof r.foreignRows === "boolean") { lastForeignRows = r.foreignRows; lastDeepAt = deps.now(); }
        if (r.otherCompanies > 0) next = { blocked: true, reason: "tenant_data_present", detail: `${r.otherCompanies}+ company(ies) other than "${FOUNDING_COMPANY_ID}" exist.`, checkedAt: deps.now() };
        else if (lastForeignRows) next = { blocked: true, reason: "tenant_data_present", detail: `tables hold rows of a company other than "${FOUNDING_COMPANY_ID}" (even though no such company row exists).`, checkedAt: deps.now() };
        else if (r.marker === "multi") next = { blocked: true, reason: "tenancy_marker", detail: "Clear it only with select app.tenancy_disable() after the other companies' data is exported and removed.", checkedAt: deps.now() };
        else next = { blocked: false, reason: "none", detail: "Only the founding company exists and the tenancy marker is off.", checkedAt: deps.now() };
      }
    } catch (err) {
      next = { blocked: true, reason: "unverified", detail: err instanceof Error ? err.message : String(err), checkedAt: deps.now() };
    }
    if (next.blocked !== state.blocked || next.reason !== state.reason) {
      deps.log(`[tenant-isolation] ${next.blocked ? "SERVING PAUSED" : "serving resumed"}: ${next.reason} - ${next.detail}`);
    }
    state = next;
    return next;
  }

  /** One check at a time; concurrent callers share it. */
  function refresh(): Promise<IsolationState> {
    if (!inflight) inflight = runCheck().finally(() => { inflight = null; });
    return inflight;
  }

  /** Turn the guard on (the server does this at boot, after the first refresh). A guard that was never armed lets everything through - unit tests and scripts. */
  function arm() { armed = true; }

  /** The state to act on now. An answer older than four intervals (a stalled timer, a hung database) counts as "could not verify". */
  function current(): IsolationState {
    if (!armed || deps.flagOn()) return { blocked: false, reason: "none", detail: deps.flagOn() ? "multi-company mode: row-level policies isolate the companies" : "not armed", checkedAt: state.checkedAt };
    const age = deps.now() - state.checkedAt;
    if (age > deps.ttlMs * 4 && !state.blocked) return { blocked: true, reason: "unverified", detail: "The last isolation check is too old.", checkedAt: state.checkedAt };
    if (age > deps.ttlMs) void refresh();
    return state;
  }

  /** Throws when serving must not happen. Called by the database client and the background jobs. */
  function assertAllowed(): void {
    const s = current();
    if (s.blocked) throw new TenantIsolationError(s.reason, s.detail);
  }

  /** Express: pauses every data route; leaves /health and the status route (and the static app shell) alone. */
  function middleware(allowed: (req: Request) => boolean = () => false) {
    return (req: Request, res: Response, next: NextFunction) => {
      const s = current();
      if (!s.blocked || allowed(req)) return next();
      const e = new TenantIsolationError(s.reason, s.detail);
      res.setHeader("Retry-After", "60");
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json({ error: e.message, code: e.code, reason: s.reason, retryable: true, maintenance: true });
    };
  }

  let timer: NodeJS.Timeout | null = null;
  function start() { if (!timer) { timer = setInterval(() => { void refresh(); }, deps.ttlMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { refresh, arm, current, assertAllowed, middleware, start, stop, setDeps: (d: Partial<Deps>) => Object.assign(deps, d) };
}

export const isolationGuard = createIsolationGuard();

/** Is this error the guard's refusal? */
export function isTenantIsolationError(e: unknown): e is TenantIsolationError {
  return e instanceof TenantIsolationError || (typeof e === "object" && e !== null && (e as { code?: string }).code === "tenant_isolation_unavailable");
}
