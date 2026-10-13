import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSubscriptionAccess, graceDays } from "./subscriptionAccess.ts";
import { resolveCompany, type CompanyStore } from "./companyResolver.ts";
import { runWithCompany } from "./companyContext.ts";
import { reserveStorage, setStorageQuotaDeps, StorageQuotaError } from "./storageQuota.ts";

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

test("storage: the limit is checked against real usage, reserves bytes, and releases them when the write fails", async () => {
  let listCalls = 0;
  setStorageQuotaDeps({ limitFor: async () => 10, list: async (ns) => { listCalls++; return ns === "customer-documents" ? [{ size: 6 * MB }] : []; } });
  await inCompany("acme", async () => {
    const a = await reserveStorage(3 * MB); // 6 + 3 = 9 <= 10
    await assert.rejects(() => reserveStorage(2 * MB), (e: any) => e instanceof StorageQuotaError && e.statusCode === 402 && e.code === "storage_limit_exceeded", "9 + 2 > 10");
    a.release(); // the first write failed: its bytes are given back
    const b = await reserveStorage(2 * MB); // 6 + 2 = 8 <= 10
    b.release();
  });
  assert.equal(listCalls, 2, "usage is listed once per namespace and then cached");
});

test("storage: no limit, founding company, no company, flag off, zero-byte write: never checked, never listed", async () => {
  let listCalls = 0;
  setStorageQuotaDeps({ limitFor: async () => null, list: async () => { listCalls++; return []; } });
  await inCompany("acme", async () => { await reserveStorage(900 * MB); });
  setStorageQuotaDeps({ limitFor: async () => 1, list: async () => { listCalls++; return [{ size: 5 * MB }]; } });
  await inCompany("sunchaser", async () => { await reserveStorage(900 * MB); });
  await inCompany("acme", async () => { await reserveStorage(0); });
  await reserveStorage(900 * MB); // no company context
  await inCompany("acme", async () => { await reserveStorage(900 * MB, {} as NodeJS.ProcessEnv); }); // flag off
  assert.equal(listCalls, 0);
});

test("storage: fails open (the write is allowed, with a warning) when the limit or usage cannot be read", async () => {
  setStorageQuotaDeps({ limitFor: async () => { throw new Error("db down"); } });
  await inCompany("acme", async () => { await reserveStorage(50 * MB); });
  setStorageQuotaDeps({ limitFor: async () => 1, list: async () => { throw new Error("store down"); } });
  await inCompany("acme", async () => { await reserveStorage(50 * MB); });
});

test("storage: files already stored are never affected - being over the limit only blocks new writes", async () => {
  setStorageQuotaDeps({ limitFor: async () => 1, list: async () => [{ size: 50 * MB }] });
  await inCompany("acme", async () => { await assert.rejects(() => reserveStorage(1), StorageQuotaError); });
  // (reading, listing and deleting do not call reserveStorage at all)
});

test("cleanup", () => { setStorageQuotaDeps(null); delete process.env.MULTI_COMPANY_ENABLED; assert.ok(ON); });
