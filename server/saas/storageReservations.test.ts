import test from "node:test";
import assert from "node:assert/strict";
import { runWithCompany } from "./companyContext.ts";
import { createMemoryReservationStore, createStorageQuota, StorageQuotaError, StorageUnverifiedError, type ReservationStore } from "./storageQuota.ts";

// Several server processes sharing one database, simulated: every createStorageQuota() has its OWN caches (as a process does) and all share one
// ReservationStore (as the processes share the saas_storage_* functions). The store's semantics are those of scripts/saas/phase2h-storage-reservations.sql,
// which the migration test and the two-instance journey prove against a real PostgreSQL.
const MB = 1024 * 1024;
process.env.MULTI_COMPANY_ENABLED = "true";
const inCompany = <T>(id: string, fn: () => Promise<T>) => runWithCompany({ companyId: id }, fn);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The object store: a list of object sizes per company. A "write" adds an object; listing returns them (read-after-write, the assumption stated in storageQuota.ts). */
const bucket = (initialMb = 0) => { const objects: number[] = initialMb ? [initialMb * MB] : []; return { objects, total: () => objects.reduce((a, b) => a + b, 0), list: async (ns: string) => (ns === "customer-documents" ? objects.map((size) => ({ size })) : []) }; };
const processOf = (store: ReservationStore, b: ReturnType<typeof bucket>, limitMb: number, extra: Record<string, unknown> = {}) =>
  createStorageQuota({ store, limitFor: async () => limitMb, list: b.list, ...extra });

/** One upload as the server does it: reserve, write, then commit - or release when the write fails. */
async function upload(q: ReturnType<typeof createStorageQuota>, b: ReturnType<typeof bucket>, bytes: number, opts: { fail?: boolean; writeMs?: number } = {}) {
  const r = await q.reserveStorage(bytes);
  try {
    await sleep(opts.writeMs ?? 0);
    if (opts.fail) throw new Error("write failed");
    b.objects.push(bytes);
  } catch (e) { await r.release(); throw e; }
  await r.commit();
}

test("two processes, one database: concurrent uploads at the boundary never exceed the limit (exactly as many fit as fit)", async () => {
  for (const latency of [0, 3]) {
    const store = createMemoryReservationStore({ latencyMs: latency });
    const b = bucket(3);                                   // 3 MB stored, 10 MB limit, 1 MB files: room for exactly 7
    const p1 = processOf(store, b, 10), p2 = processOf(store, b, 10);
    const results = await inCompany("acme", () => Promise.allSettled(Array.from({ length: 40 }, (_, i) => upload(i % 2 ? p1 : p2, b, 1 * MB, { writeMs: i % 4 }))));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof StorageQuotaError).length;
    assert.equal(ok, 7, `latency ${latency}: accepted`);
    assert.equal(ok + refused, 40, "every other upload was refused with the quota error");
    assert.ok(b.total() <= 10 * MB, `stored ${b.total() / MB} MB of 10`);
  }
});

test("NEGATIVE CONTROL - the previous design: processes that do not share the decision overshoot (this is what the shared store prevents)", async () => {
  const b = bucket(3);
  const p1 = processOf(createMemoryReservationStore(), b, 10), p2 = processOf(createMemoryReservationStore(), b, 10);   // each "process" decides alone
  await inCompany("acme", () => Promise.allSettled(Array.from({ length: 40 }, (_, i) => upload(i % 2 ? p1 : p2, b, 1 * MB, { writeMs: 5 }))));
  assert.ok(b.total() > 10 * MB, `without the shared decision ${b.total() / MB} MB were stored against a 10 MB limit`);
});

test("randomised: three processes, mixed sizes, failing writes, jitter - the stored total never exceeds the limit, and room freed by failures is used", async () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 20; round++) {
    const store = createMemoryReservationStore({ latencyMs: 2 });
    const b = bucket(Math.floor(rnd() * 5));
    const limit = 12 + Math.floor(rnd() * 8);
    const ps = [processOf(store, b, limit), processOf(store, b, limit), processOf(store, b, limit)];
    await inCompany("acme", () => Promise.allSettled(Array.from({ length: 45 }, (_, i) => upload(ps[i % 3], b, Math.ceil(rnd() * 4 * MB), { fail: rnd() < 0.25, writeMs: Math.floor(rnd() * 6) }))));
    assert.ok(b.total() <= limit * MB, `round ${round}: stored ${(b.total() / MB).toFixed(2)} MB of ${limit}`);
    assert.equal(store.rows("acme").filter((r) => r.state === "pending").length, 0, `round ${round}: no reservation is left pending after the uploads ended`);
  }
});

test("a failed write gives its bytes back at once, in every process", async () => {
  const store = createMemoryReservationStore();
  const b = bucket(0);
  const p1 = processOf(store, b, 5), p2 = processOf(store, b, 5);
  await inCompany("acme", async () => {
    await assert.rejects(() => upload(p1, b, 4 * MB, { fail: true }), /write failed/);
    assert.equal(store.rows("acme").length, 0, "the reservation was deleted, not kept");
    await upload(p2, b, 5 * MB);                           // the whole limit is available again - in the OTHER process
    await assert.rejects(() => upload(p1, b, 1), StorageQuotaError);
  });
});

test("an upload that finished in process A is counted by process B whose listing is older - and not counted twice once B lists again", async () => {
  let t = 0;
  const store = createMemoryReservationStore({ now: () => t });
  const b = bucket(3);
  const A = processOf(store, b, 10, { now: () => t }), B = processOf(store, b, 10, { now: () => t });
  await inCompany("acme", async () => {
    await upload(B, b, 1 * MB);                            // B lists (3 MB) and caches that; stored: 4
    await upload(A, b, 4 * MB);                            // A lists 4 MB (incl. B's), writes 4: stored 8
    // B still trusts its old listing (3 MB) but the database knows A's finished upload
    await assert.rejects(() => upload(B, b, 3 * MB), StorageQuotaError, "8 stored + 3 > 10, although B's own listing says 3");
    await upload(B, b, 2 * MB);                            // 8 + 2 = 10 fits exactly
    t += 120_000;                                          // B's listing is now old; it lists again and sees 10 MB itself
    await assert.rejects(() => upload(B, b, 1), StorageQuotaError, "10 of 10 stored");
    assert.equal(b.total(), 10 * MB);
  });
  // not double counted: delete 2 MB, B lists again and has room for exactly 2 MB more
  b.objects.splice(b.objects.length - 1, 1);
  t += 120_000;
  await inCompany("acme", async () => { await upload(B, b, 2 * MB); await assert.rejects(() => upload(B, b, 1), StorageQuotaError); });
});

test("a process that dies mid-upload leaves a pending reservation: it counts until it expires, then stops counting", async () => {
  let t = 0;
  const store = createMemoryReservationStore({ now: () => t });
  const b = bucket(0);
  const dying = processOf(store, b, 5, { now: () => t }), other = processOf(store, b, 5, { now: () => t });
  await inCompany("acme", async () => {
    await dying.reserveStorage(4 * MB);                    // accepted, then the process is killed: no commit, no release
    await assert.rejects(() => upload(other, b, 2 * MB), StorageQuotaError, "the 4 MB held by the dead process still count");
    assert.equal(store.rows("acme").filter((r) => r.state === "pending").length, 1);
    t += 181_000;                                          // past the 180 s default
    await upload(other, b, 2 * MB);
    assert.equal(store.rows("acme").filter((r) => r.state === "pending").length, 0, "the expired reservation was purged");
  });
});

test("fail closed: the database cannot be reached for the mark, the reserve - retryable; a settle that fails is not fatal and keeps the bytes counted", async () => {
  const good = createMemoryReservationStore();
  const b = bucket(0);
  const mk = (over: Partial<ReservationStore>) => processOf({ ...good, ...over } as ReservationStore, b, 5);
  await inCompany("acme", async () => {
    await assert.rejects(() => mk({ mark: async () => { throw new Error("db down"); } }).reserveStorage(1), StorageUnverifiedError);
    await assert.rejects(() => mk({ reserve: async () => { throw new Error("saas_storage_reserve is missing"); } }).reserveStorage(1), StorageUnverifiedError);
    await assert.rejects(() => mk({ mark: () => new Promise(() => {}) , }).reserveStorage(1), StorageUnverifiedError, "no answer at all");
  });
  // settle fails after a successful write
  let failSettle = true;
  const flaky: ReservationStore = { ...good, settle: async (id, o) => { if (failSettle) throw new Error("db blip"); return good.settle(id, o); } };
  const p = processOf(flaky, b, 5);
  await inCompany("acme", async () => {
    const r = await p.reserveStorage(4 * MB);
    await r.commit();                                      // must not throw
    assert.equal(good.rows("acme")[0].state, "pending", "still pending: counted, and it will expire by itself");
    await assert.rejects(() => processOf(good, b, 5).reserveStorage(2 * MB), StorageQuotaError, "the bytes still count in every process");
    failSettle = false;
  });
});

test("another company's reservations never count against this one", async () => {
  const store = createMemoryReservationStore();
  const b = bucket(0);
  const p = processOf(store, b, 5);
  await inCompany("acme", async () => { await p.reserveStorage(5 * MB); await assert.rejects(() => p.reserveStorage(1), StorageQuotaError); });
  await inCompany("other", async () => { await (await p.reserveStorage(5 * MB)).commit(); });
});

test("never reserved - the founding company, no company, a zero-byte write, the flag off", async () => {
  const store = createMemoryReservationStore();
  let touched = 0;
  const counting: ReservationStore = { mark: async () => { touched++; return 1; }, reserve: async () => { touched++; return { ok: true, id: "x", used: 0 }; }, settle: async () => { touched++; } };
  const p = processOf(counting, bucket(0), 1);
  await inCompany("sunchaser", async () => { await (await p.reserveStorage(900 * MB)).commit(); });
  await p.reserveStorage(900 * MB);
  await inCompany("acme", async () => { await p.reserveStorage(0); await p.reserveStorage(900 * MB, {} as NodeJS.ProcessEnv); });
  assert.equal(touched, 0, "the database was never asked");
  void store;
});
