import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSubscriptionAccess, graceDays } from "./subscriptionAccess.ts";
import { resolveCompany, type CompanyStore } from "./companyResolver.ts";
import { runWithCompany } from "./companyContext.ts";
import { reserveStorage, setStorageQuotaDeps, StorageQuotaError, StorageUnverifiedError, StorageLimitNotSetError, storageErrorResponse, isStorageError } from "./storageQuota.ts";

const NOW = new Date("2026-10-13T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);

test("grace period default and bounds", () => {
  assert.equal(graceDays({}), 3);
  assert.equal(graceDays({ SAAS_EXPIRY_GRACE_DAYS: "0" } as any), 0);
  assert.equal(graceDays({ SAAS_EXPIRY_GRACE_DAYS: "7" } as any), 7);
  assert.equal(graceDays({ SAAS_EXPIRY_GRACE_DAYS: "-1" } as any), 3);
  assert.equal(graceDays({ SAAS_EXPIRY_GRACE_DAYS: "abc" } as any), 3);
});

test("subscription states by date: ok, last day, grace, read-only, blocked, no subscription", () => {
  const sub = (periodEnd: string | null, status = "active", trialEndsAt: string | null = null) => ({ status, periodEnd, trialEndsAt });
  assert.equal(evaluateSubscriptionAccess(null, NOW, 3).state, "ok");
  assert.equal(evaluateSubscriptionAccess(sub(null), NOW, 3).state, "ok"); // open-ended
  assert.equal(evaluateSubscriptionAccess(sub(day(5)), NOW, 3).state, "ok");
  assert.equal(evaluateSubscriptionAccess(sub(day(0)), NOW, 3).state, "ok", "the last day is included");
  assert.equal(evaluateSubscriptionAccess(sub(day(-1)), NOW, 3).state, "grace");
  assert.equal(evaluateSubscriptionAccess(sub(day(-2)), NOW, 3).state, "grace");
  assert.equal(evaluateSubscriptionAccess(sub(day(-5)), NOW, 3).state, "read_only");
  assert.equal(evaluateSubscriptionAccess(sub(day(-5)), NOW, 10).state, "grace", "a longer grace period is honoured");
  assert.equal(evaluateSubscriptionAccess(sub(day(5), "suspended"), NOW, 3).state, "blocked");
  assert.equal(evaluateSubscriptionAccess(sub(day(5), "cancelled"), NOW, 3).state, "blocked");
  assert.equal(evaluateSubscriptionAccess(sub(day(-1), "past_due"), NOW, 3).state, "grace");
});

test("a trial ends at its trial timestamp, which wins over the period date", () => {
  const ended = new Date(NOW.getTime() - 5 * 86_400_000).toISOString();
  assert.equal(evaluateSubscriptionAccess({ status: "trial", trialEndsAt: ended, periodEnd: day(30) }, NOW, 3).state, "read_only");
  const later = new Date(NOW.getTime() + 86_400_000).toISOString();
  assert.equal(evaluateSubscriptionAccess({ status: "trial", trialEndsAt: later, periodEnd: day(-30) }, NOW, 3).state, "ok");
});

function store(sub: { status: string; trialEndsAt: string | null; periodEnd: string | null } | null, companyStatus = "active"): CompanyStore {
  return {
    async listMemberships(userId) { return [{ id: "m1", companyId: "acme", userId, role: "Admin", status: "active" }]; },
    async getCompany(id) { return { id, name: "Acme", status: companyStatus }; },
    async getCustomerCompanyId() { return "acme"; },
    async getSubscription() { return sub; },
  };
}
const actor = { id: "u1", role: "Admin" };
const call = (sub: any, method: string, scope: any = "company") => resolveCompany({ actor, scope, method, now: NOW, graceDays: 3 }, store(sub));

test("request time: past the grace period a company can read but cannot write (402 subscription_expired)", async () => {
  const expired = { status: "active", trialEndsAt: null, periodEnd: day(-10) };
  const g = await call(expired, "GET");
  assert.equal(g.ok, true);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await call(expired, m);
    assert.deepEqual(r.ok ? null : [(r as any).status, (r as any).code], [402, "subscription_expired"], m);
  }
});

test("request time: inside the grace period everything works and the response is marked", async () => {
  const r = await call({ status: "active", trialEndsAt: null, periodEnd: day(-1) }, "POST");
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.subscription, "grace");
});

test("request time: a valid subscription is untouched and unmarked", async () => {
  const r = await call({ status: "active", trialEndsAt: null, periodEnd: day(20) }, "DELETE");
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.subscription, undefined);
});

test("request time: suspended subscription is blocked for reads too (403 subscription_inactive)", async () => {
  const r = await call({ status: "suspended", trialEndsAt: null, periodEnd: day(20) }, "GET");
  assert.deepEqual(r.ok ? null : [(r as any).status, (r as any).code], [403, "subscription_inactive"]);
});

test("request time: the founding company and companies with no subscription are never limited", async () => {
  assert.equal((await call(null, "POST")).ok, true);
  const founding = await resolveCompany({ actor, scope: "company", method: "POST", now: NOW, tokenCompanyId: "sunchaser" },
    { ...store({ status: "active", trialEndsAt: null, periodEnd: day(-100) }), listMemberships: async (u) => [{ id: "m", companyId: "sunchaser", userId: u, role: "Admin", status: "active" }] });
  assert.equal(founding.ok, true);
});

test("request time: a renewal takes effect at once (the next evaluation sees the new end date)", async () => {
  const expired = { status: "active", trialEndsAt: null, periodEnd: day(-10) };
  assert.equal((await call(expired, "POST")).ok, false);
  assert.equal((await call({ ...expired, periodEnd: day(30) }, "POST")).ok, true);
});

// ---- storage limit
const MB = 1024 * 1024;
const inCompany = <T>(id: string, fn: () => Promise<T>) => runWithCompany({ companyId: id }, fn);
const ON = (() => { process.env.MULTI_COMPANY_ENABLED = "true"; return true; })();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("storage: the limit is checked against real usage; accepted bytes are held, committed, or given back", async () => {
  let listCalls = 0;
  setStorageQuotaDeps({ limitFor: async () => 10, list: async (ns) => { listCalls++; return ns === "customer-documents" ? [{ size: 6 * MB }] : []; } });
  await inCompany("acme", async () => {
    const a = await reserveStorage(3 * MB); // 6 + 3 = 9 <= 10
    await assert.rejects(() => reserveStorage(2 * MB), (e: any) => e instanceof StorageQuotaError && e.statusCode === 402 && e.code === "storage_limit_exceeded" && e.retryable === false, "9 + 2 > 10");
    await a.release(); // the first write failed: its bytes are given back
    const b = await reserveStorage(2 * MB); // 6 + 2 = 8 <= 10
    await b.commit(); // finished: still counted (8)
    await assert.rejects(() => reserveStorage(3 * MB), StorageQuotaError, "8 + 3 > 10 after the second write finished");
    const c = await reserveStorage(2 * MB); // exactly 10: allowed, the limit is inclusive
    await c.commit();
    await assert.rejects(() => reserveStorage(1), StorageQuotaError, "one byte over");
  });
  assert.ok(listCalls >= 2, "usage is listed once per namespace");
});

test("storage: no limit set for a pilot company is refused (no unlimited default), with a coded, non-retryable message", async () => {
  setStorageQuotaDeps({ limitFor: async () => null, list: async () => [] });
  await inCompany("acme", async () => {
    await assert.rejects(() => reserveStorage(1), (e: any) => e instanceof StorageLimitNotSetError && e.statusCode === 403 && e.code === "storage_limit_not_set" && e.retryable === false && /existing files are unaffected/i.test(e.message));
  });
});

test("storage: never checked, never listed - the founding company, requests with no company, the flag off, a zero-byte write", async () => {
  let listCalls = 0;
  setStorageQuotaDeps({ limitFor: async () => 1, list: async () => { listCalls++; return [{ size: 5 * MB }]; } });
  await inCompany("sunchaser", async () => { await reserveStorage(900 * MB); });
  await inCompany("acme", async () => { await reserveStorage(0); });
  await reserveStorage(900 * MB); // no company context
  await inCompany("acme", async () => { await reserveStorage(900 * MB, {} as NodeJS.ProcessEnv); }); // flag off
  assert.equal(listCalls, 0);
});

test("storage: FAILS CLOSED when the limit cannot be read, usage cannot be measured, or the store hangs - retryable, nothing touched", async () => {
  const expectUnverified = (e: any) => e instanceof StorageUnverifiedError && e.statusCode === 503 && e.code === "storage_unverified" && e.retryable === true && e.retryAfterSeconds > 0 && /try the upload again/i.test(e.message) && /existing files are unaffected/i.test(e.message);
  setStorageQuotaDeps({ limitFor: async () => { throw new Error("db down"); } });
  await inCompany("acme", async () => { await assert.rejects(() => reserveStorage(1), expectUnverified, "limit unreadable"); });
  setStorageQuotaDeps({ limitFor: async () => 1000, list: async () => { throw new Error("store down"); } });
  await inCompany("acme", async () => { await assert.rejects(() => reserveStorage(1), expectUnverified, "usage unmeasurable"); });
  setStorageQuotaDeps({ limitFor: async () => 1000, list: () => new Promise(() => {}), timeoutMs: 30 });
  await inCompany("acme", async () => { await assert.rejects(() => reserveStorage(1), expectUnverified, "listing hangs"); });
  // the response a route sends
  const r = storageErrorResponse(new StorageUnverifiedError());
  assert.equal(r.status, 503);
  assert.ok(r.headers["Retry-After"]);
  assert.equal((r.body as any).retryable, true);
  assert.ok(isStorageError(new StorageQuotaError(1, 1, 1)) && !isStorageError(new Error("x")));
  // and it recovers: the next attempt after the store is back is accepted
  setStorageQuotaDeps({ limitFor: async () => 10, list: async () => [] });
  await inCompany("acme", async () => { await (await reserveStorage(1)).commit(); });
});

test("storage: a store that blipped does not poison the company - the failure is retryable and the next request works", async () => {
  let n = 0;
  setStorageQuotaDeps({ limitFor: async () => 10, list: async () => { if (n++ === 0) throw new Error("blip"); return []; } });
  await inCompany("acme", async () => {
    await assert.rejects(() => reserveStorage(1), StorageUnverifiedError);
    await (await reserveStorage(1)).commit();
  });
});

test("storage: files already stored are never affected - being over the limit only blocks new writes", async () => {
  setStorageQuotaDeps({ limitFor: async () => 1, list: async () => [{ size: 50 * MB }] });
  await inCompany("acme", async () => { await assert.rejects(() => reserveStorage(1), StorageQuotaError); });
  // (reading, listing and deleting do not call reserveStorage at all)
});

test("storage: a refusal on an old figure is re-checked against a fresh listing (files deleted since are not counted)", async () => {
  let stored = 9 * MB;
  let t = 0;
  setStorageQuotaDeps({ limitFor: async () => 10, list: async (ns) => (ns === "customer-documents" ? [{ size: stored }] : []), now: () => t });
  await inCompany("acme", async () => {
    await assert.rejects(() => reserveStorage(2 * MB), StorageQuotaError, "9 + 2 > 10");
    stored = 1 * MB; // the company deleted files
    t += 10_000; // more than the 2 s re-check threshold, less than the 60 s cache time
    await (await reserveStorage(2 * MB)).commit();
  });
});

test("storage: CONCURRENT uploads at the boundary - exactly as many are accepted as fit, never more, whatever the timing", async () => {
  for (const jitter of [0, 1, 5]) {
    // limit 10 MB, 3 MB already stored, 1 MB uploads: room for exactly 7
    setStorageQuotaDeps({
      limitFor: async () => { await sleep(jitter); return 10; },
      list: async (ns) => { await sleep(jitter * 2); return ns === "customer-documents" ? [{ size: 3 * MB }] : []; },
    });
    await inCompany("acme", async () => {
      const results = await Promise.allSettled(Array.from({ length: 25 }, async (_, i) => {
        const r = await reserveStorage(1 * MB);
        await sleep((i % 5) * jitter); // the "write"
        await r.commit();
        return i;
      }));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const refused = results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof StorageQuotaError).length;
      assert.equal(ok, 7, `jitter ${jitter}: accepted`);
      assert.equal(ok + refused, 25, `jitter ${jitter}: every other request was refused with the quota error, none failed otherwise`);
    });
  }
});

test("storage: concurrent uploads of different sizes never exceed the limit in total; failed writes free their room", async () => {
  setStorageQuotaDeps({ limitFor: async () => 10, list: async () => [] });
  await inCompany("acme", async () => {
    const sizes = [4, 4, 4, 3, 3, 2, 2, 1, 1, 1, 6, 5];
    let accepted = 0, failedWrites = 0;
    await Promise.allSettled(sizes.map(async (mb, i) => {
      const r = await reserveStorage(mb * MB);
      await sleep(i % 3);
      if (i === 0) { await r.release(); failedWrites++; return; } // the first accepted write fails and gives its room back
      await r.commit(); accepted += mb;
    }));
    assert.ok(accepted <= 10, `accepted ${accepted} MB`);
    // after it all the figure is consistent: nothing more than what is left fits
    const left = 10 - accepted;
    if (left > 0) await (await reserveStorage(left * MB)).commit();
    await assert.rejects(() => reserveStorage(1), StorageQuotaError);
    assert.equal(failedWrites, 1);
  });
});

test("storage: another company's usage never counts against this one", async () => {
  setStorageQuotaDeps({ limitFor: async (c) => (c === "acme" ? 1 : 100), list: async (ns, prefix) => (ns !== "customer-documents" ? [] : prefix.includes("acme") ? [{ size: 1 * MB }] : [{ size: 50 * MB }]) });
  await inCompany("acme", async () => { await assert.rejects(() => reserveStorage(1), StorageQuotaError); });
  await inCompany("other", async () => { await (await reserveStorage(1 * MB)).commit(); });
});

test("cleanup", () => { setStorageQuotaDeps(null); delete process.env.MULTI_COMPANY_ENABLED; assert.ok(ON); });
