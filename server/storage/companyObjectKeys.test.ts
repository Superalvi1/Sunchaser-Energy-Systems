import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runWithCompany } from "../saas/companyContext.ts";
import {
  buildRailwayObjectProxyUrl, isStoragePathForCustomer, objectCompanyOf, putRailwayObject, scopeObjectKey, verifyRailwayObjectProxySignature,
} from "./railwayObjectStorage.ts";

const base = { RAILWAY_S3_ENDPOINT: "https://s3.example.test", RAILWAY_S3_BUCKET: "b", RAILWAY_S3_ACCESS_KEY_ID: "k", RAILWAY_S3_SECRET_ACCESS_KEY: "s", RAILWAY_OBJECT_PROXY_SECRET: "x".repeat(40) } as NodeJS.ProcessEnv;
const multi = { ...base, MULTI_COMPANY_ENABLED: "true" } as NodeJS.ProcessEnv;
const parts = (url: string) => {
  const m = /\/api\/storage\/object\/([^/]+)\/([^?]+)\?(.*)$/.exec(url)!;
  const q = new URLSearchParams(m[3]);
  return { ns: m[1], enc: m[2], sig: q.get("sig") || "", exp: q.get("exp") ?? undefined };
};
const withEnv = async <T,>(env: NodeJS.ProcessEnv, fn: () => T | Promise<T>): Promise<T> => {
  const saved = { ...process.env }; Object.assign(process.env, env);
  try { return await fn(); } finally { for (const k of Object.keys(env)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; } }
};

test("a company's objects live under its own prefix; the founding company's keys are unchanged", () => {
  assert.equal(scopeObjectKey("cust-1/a.pdf", "co_a", multi), "c/co_a/cust-1/a.pdf");
  assert.equal(scopeObjectKey("c/co_a/cust-1/a.pdf", "co_a", multi), "c/co_a/cust-1/a.pdf", "idempotent");
  assert.equal(scopeObjectKey("cust-1/a.pdf", "sunchaser", multi), "cust-1/a.pdf");
  assert.equal(scopeObjectKey("cust-1/a.pdf", "co_a", base), "cust-1/a.pdf", "flag off: nothing changes");
  assert.throws(() => scopeObjectKey("c/co_b/cust-1/a.pdf", "co_a", multi), /another company/);
  assert.throws(() => scopeObjectKey("c/co_a/x.pdf", "sunchaser", multi), /another company|founding company/);
});

test("the company of a key is read from the key", () => {
  assert.equal(objectCompanyOf("c/co_beta/x/y.pdf"), "co_beta");
  assert.equal(objectCompanyOf("cust-1/y.pdf"), "sunchaser");
  assert.equal(objectCompanyOf("smart-quotes/lead/q.pdf"), "sunchaser");
  assert.equal(objectCompanyOf("c/Bad-Id/x"), "sunchaser");
});

test("multi-company links expire; the signature covers the expiry", () => {
  const url = buildRailwayObjectProxyUrl("customer-documents", "c/co_a/cust/a.pdf", { ...multi, STORAGE_LINK_TTL_SECONDS: "60" });
  const p = parts(url);
  assert.ok(p.exp && Number(p.exp) > Date.now() / 1000 && Number(p.exp) <= Date.now() / 1000 + 61);
  assert.equal(verifyRailwayObjectProxySignature("customer-documents", p.enc, p.sig, multi, p.exp).ok, true);
  const longer = String(Number(p.exp) + 3600);
  assert.equal(verifyRailwayObjectProxySignature("customer-documents", p.enc, p.sig, multi, longer).ok, false, "a longer expiry invalidates the signature");
  assert.equal(verifyRailwayObjectProxySignature("customer-documents", p.enc, p.sig, multi, undefined).ok, false, "dropping the expiry does not turn it into a permanent link");
});

test("an expired link is refused with its own reason", () => {
  const url = buildRailwayObjectProxyUrl("customer-documents", "c/co_a/cust/a.pdf", { ...multi, STORAGE_LINK_TTL_SECONDS: "1" });
  const p = parts(url);
  const later = Date.now;
  Date.now = () => later() + 3000;
  try {
    const r = verifyRailwayObjectProxySignature("customer-documents", p.enc, p.sig, multi, p.exp);
    assert.deepEqual(r, { ok: false, reason: "expired" });
  } finally { Date.now = later; }
});

test("a signature is valid for one object only", () => {
  const a = parts(buildRailwayObjectProxyUrl("customer-documents", "c/co_a/cust/a.pdf", multi));
  const bKey = Buffer.from("c/co_b/cust/b.pdf").toString("base64url");
  assert.equal(verifyRailwayObjectProxySignature("customer-documents", bKey, a.sig, multi, a.exp).ok, false);
  assert.equal(verifyRailwayObjectProxySignature("quote-assets", a.enc, a.sig, multi, a.exp).ok, false);
});

test("old permanent links: never for another company's key; for the founding company's own keys unless switched off", () => {
  const legacy = (key: string) => parts(buildRailwayObjectProxyUrl("customer-documents", key, base));
  const own = legacy("cust-1/a.pdf"), foreign = legacy("c/co_a/cust-1/a.pdf");
  assert.equal(verifyRailwayObjectProxySignature("customer-documents", own.enc, own.sig, multi).ok, true);
  assert.deepEqual(verifyRailwayObjectProxySignature("customer-documents", foreign.enc, foreign.sig, multi), { ok: false, reason: "legacy_not_allowed" });
  assert.equal(verifyRailwayObjectProxySignature("customer-documents", own.enc, own.sig, { ...multi, STORAGE_LEGACY_LINKS: "off" }).ok, false);
  assert.equal(verifyRailwayObjectProxySignature("customer-documents", foreign.enc, foreign.sig, base).ok, true, "flag off: exactly the old behaviour");
});

test("without multi-company mode links stay permanent and unchanged", () => {
  const p = parts(buildRailwayObjectProxyUrl("customer-documents", "cust-1/a.pdf", base));
  assert.equal(p.exp, undefined);
  assert.equal(verifyRailwayObjectProxySignature("customer-documents", p.enc, p.sig, base).ok, true);
});

test("a caller acting for one company cannot write into another company's key space", async () => {
  await withEnv({ MULTI_COMPANY_ENABLED: "true" }, async () => {
    await runWithCompany({ companyId: "co_a" }, async () => {
      await assert.rejects(putRailwayObject("customer-documents", "c/co_b/x.pdf", Buffer.from("x"), "application/pdf"), /outside the company's own key space/);
      await assert.rejects(putRailwayObject("customer-documents", "cust-1/x.pdf", Buffer.from("x"), "application/pdf"), /outside the company's own key space/, "an unprefixed (founding) key is not co_a's");
    });
  });
});

test("a document row may only point into the caller's own folder and key space", async () => {
  await withEnv({ MULTI_COMPANY_ENABLED: "true" }, () => {
    runWithCompany({ companyId: "co_a" }, () => {
      assert.equal(isStoragePathForCustomer("cust-1", "c/co_a/cust-1/a.pdf"), true);
      assert.equal(isStoragePathForCustomer("cust-1", "c/co_b/cust-1/a.pdf"), false, "another company's key space");
      assert.equal(isStoragePathForCustomer("cust-1", "c/co_a/cust-2/a.pdf"), false, "another customer's folder");
      assert.equal(isStoragePathForCustomer("cust-1", "cust-1/a.pdf"), false, "unprefixed = the founding company's");
    });
  });
});
