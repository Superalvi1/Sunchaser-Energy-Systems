import test from "node:test";
import assert from "node:assert/strict";
import { createIsolationGuard, isTenantIsolationError, TenantIsolationError, type ProbeResult } from "./tenantIsolationGuard.ts";

const mk = (probe: (req: { deep: boolean }) => Promise<ProbeResult>, extra: Record<string, unknown> = {}) => {
  let t = 1000; let flag = false;
  const g = createIsolationGuard({ probe, flagOn: () => flag, now: () => t, ttlMs: 5000, probeTimeoutMs: 50, log: () => {}, ...extra });
  return { g, tick: (ms: number) => { t += ms; }, setFlag: (v: boolean) => { flag = v; } };
};
const res = () => { const r: any = { headers: {} as Record<string, string>, code: 0, body: null as any, setHeader(k: string, v: string) { r.headers[k] = v; }, status(c: number) { r.code = c; return r; }, json(b: any) { r.body = b; return r; } }; return r; };

test("closed until the first answer; an unarmed guard (tests, scripts) lets everything through", async () => {
  const { g } = mk(async () => ({ otherCompanies: 0 }));
  assert.equal(g.current().blocked, false, "not armed");
  g.arm();
  assert.equal(g.current().blocked, true, "armed but nothing asked yet: closed");
  assert.throws(() => g.assertAllowed(), TenantIsolationError);
  await g.refresh();
  assert.equal(g.current().blocked, false);
  g.assertAllowed();
});

test("another company exists => paused, with a 503 body on data routes; the allow-list stays reachable", async () => {
  const { g } = mk(async () => ({ otherCompanies: 1 }));
  await g.refresh(); g.arm();
  assert.equal(g.current().reason, "tenant_data_present");
  const r = res(); let nexted = false;
  g.middleware((req: any) => req.path === "/health")({ path: "/api/leads" } as any, r, () => { nexted = true; });
  assert.equal(nexted, false); assert.equal(r.code, 503); assert.equal(r.body.code, "tenant_isolation_unavailable"); assert.equal(r.body.retryable, true); assert.ok(r.headers["Retry-After"]);
  const r2 = res(); let n2 = false;
  g.middleware((req: any) => req.path === "/health")({ path: "/health" } as any, r2, () => { n2 = true; });
  assert.equal(n2, true);
  assert.throws(() => g.assertAllowed(), (e: any) => isTenantIsolationError(e) && e.statusCode === 503 && /more than one company/.test(e.message));
});

test("only the founding company, or no company tables at all => serving", async () => {
  for (const r of [{ otherCompanies: 0 }, { tablesMissing: true as const }]) {
    const { g } = mk(async () => r); await g.refresh(); g.arm();
    assert.equal(g.current().blocked, false);
  }
});

test("FAIL CLOSED: a probe that throws, hangs, or a stale answer pauses serving - it never falls back to open", async () => {
  const bad = mk(async () => { throw new Error("db down"); }); await bad.g.refresh(); bad.g.arm();
  assert.equal(bad.g.current().blocked, true); assert.equal(bad.g.current().reason, "unverified");
  const hang = mk(() => new Promise(() => {})); await hang.g.refresh(); hang.g.arm();
  assert.equal(hang.g.current().reason, "unverified");
  // open, then the checks stop answering: after four intervals the old "all clear" is not trusted
  let ok = true;
  const stale = mk(async () => { if (!ok) throw new Error("gone"); return { otherCompanies: 0 }; });
  await stale.g.refresh(); stale.g.arm();
  assert.equal(stale.g.current().blocked, false);
  ok = false; stale.tick(5001); stale.g.current();           // triggers a refresh in the background, which fails
  await stale.g.refresh();
  assert.equal(stale.g.current().blocked, true);
  const stuck = mk(async () => ({ otherCompanies: 0 })); await stuck.g.refresh(); stuck.g.arm(); stuck.tick(5000 * 4 + 1);
  assert.equal(stuck.g.current().blocked, true, "answer older than four intervals");
});

test("it recovers by itself when the other companies' data is removed, and a flag-on process is not affected", async () => {
  let n = 1;
  const { g, tick, setFlag } = mk(async () => ({ otherCompanies: n }));
  await g.refresh(); g.arm();
  assert.equal(g.current().blocked, true);
  n = 0; tick(5001); g.current(); await g.refresh();
  assert.equal(g.current().blocked, false);
  n = 3; await g.refresh(); assert.equal(g.current().blocked, true);
  setFlag(true);
  assert.equal(g.current().blocked, false, "multi-company mode: the database's row-level policies isolate the companies");
});

test("the persistent marker pauses a flag-off process even when no company row exists and no tenant row is left", async () => {
  const { g } = mk(async () => ({ otherCompanies: 0, marker: "multi" }));
  await g.refresh(); g.arm();
  assert.equal(g.current().blocked, true); assert.equal(g.current().reason, "tenancy_marker");
  assert.throws(() => g.assertAllowed(), (e: any) => /marked as multi-company/.test(e.message));
});

test("deleting the companies row does not lift it: rows of another company found by the deep check keep the process paused until a later deep check says otherwise", async () => {
  let foreign = true; const deepSeen: boolean[] = [];
  const { g, tick } = mk(async ({ deep }) => { deepSeen.push(deep); return { otherCompanies: 0, marker: "single", ...(deep ? { foreignRows: foreign } : {}) }; });
  await g.refresh(); g.arm();
  assert.equal(g.current().blocked, true); assert.equal(g.current().reason, "tenant_data_present");
  tick(5001); g.current(); await g.refresh();            // a cheap check (no deep answer): the earlier "yes" is remembered
  assert.equal(g.current().blocked, true, "a cheap check does not forget the deep answer");
  foreign = false; tick(61_000); g.current(); await g.refresh();   // the next deep check
  assert.equal(g.current().blocked, false);
  assert.deepEqual(deepSeen.slice(0, 3), [true, false, true]);
});

test("after the operator clears the marker (which refuses while other rows exist) the remembered deep 'yes' is re-asked at once, not after the next scheduled deep check", async () => {
  let marker: "single" | "multi" = "multi"; let foreign = true;
  const { g, tick } = mk(async ({ deep }) => ({ otherCompanies: 0, marker, ...(deep ? { foreignRows: foreign } : {}) }));
  await g.refresh(); g.arm();
  assert.equal(g.current().blocked, true);
  marker = "single"; foreign = false;              // data removed, then app.tenancy_disable()
  tick(5001); g.current(); await g.refresh();      // ONE cheap interval later, far less than the 60 s deep interval
  assert.equal(g.current().blocked, false, "resumed within one check interval");
});

test("the reason follows the facts within one check: rows removed while the marker is still on => tenancy_marker, not a stale tenant_data_present", async () => {
  let foreign = true;
  const { g, tick } = mk(async ({ deep }) => ({ otherCompanies: 0, marker: "multi", ...(deep ? { foreignRows: foreign } : {}) }));
  await g.refresh(); g.arm();
  assert.equal(g.current().reason, "tenant_data_present");
  foreign = false;                                  // the other companies' data is removed; the marker stays on
  tick(5001); g.current(); await g.refresh();
  assert.equal(g.current().blocked, true, "still paused: the marker is on");
  assert.equal(g.current().reason, "tenancy_marker");
});
