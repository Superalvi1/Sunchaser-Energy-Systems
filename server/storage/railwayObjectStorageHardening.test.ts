import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  buildRailwayObjectProxyUrl,
  deleteRailwayObject,
  getRailwayObject,
  isStoragePathForCustomer,
  putRailwayObject,
  putRailwayObjectConditional,
  rewriteLegacyStorageUrl,
  verifyRailwayObjectProxySignature,
} from "./railwayObjectStorage.ts";

const baseEnv = {
  RAILWAY_S3_ENDPOINT: "https://storage.example.test",
  RAILWAY_S3_BUCKET: "bucket-1",
  RAILWAY_S3_ACCESS_KEY_ID: "AKIATESTFIXTURE",
  RAILWAY_S3_SECRET_ACCESS_KEY: "fixture-secret-never-used-anywhere",
  RAILWAY_S3_REGION: "auto",
  RAILWAY_OBJECT_PROXY_SECRET: "proxy-secret-that-is-long-and-random-0001",
  APP_PUBLIC_URL: "https://crm.example.test",
};
const realFetch = globalThis.fetch;
const saved = { ...process.env };
let calls: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  Object.assign(process.env, baseEnv);
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(baseEnv)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const xml = (code: string) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>text that must never be echoed</Message></Error>`;
function answer(status: number, body = "", headers: Record<string, string> = {}) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(status === 204 || status === 304 ? null : body, { status, headers });
  }) as typeof fetch;
}
function fail(error: unknown) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    throw error;
  }) as typeof fetch;
}

test("object keys: only whole '.' and '..' segments are refused", () => {
  const ok = (key: string) => buildRailwayObjectProxyUrl("customer-documents", key, baseEnv);
  assert.doesNotThrow(() => ok("cust-1/1700000000_scan..pdf"), "a file name containing two dots is a valid key");
  assert.doesNotThrow(() => ok("cust-1//double-slash.pdf"));
  for (const bad of ["./x", "cust-1/./x", "cust-1/../x", "..", "a/..", "cust\\x", "", "/", "k".repeat(1025)]) {
    assert.throws(() => ok(bad), /Invalid object key/, JSON.stringify(bad.slice(0, 20)));
  }
});

test("a signed request addresses <bucket>.<endpoint host> and signs host, content hash and date", async () => {
  answer(200);
  await putRailwayObject("customer-documents", "cust-1/a b.pdf", Buffer.from("%PDF-1.4"), "application/pdf");
  assert.equal(calls[0].url, "https://bucket-1.storage.example.test/customer-documents/cust-1/a%20b.pdf");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.match(headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIATESTFIXTURE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.ok(calls[0].init.signal, "every bucket request carries a timeout signal");
});

test("a rejected request reports the S3 error code but never the message text, secrets or hosts", async () => {
  for (const code of ["SignatureDoesNotMatch", "InvalidAccessKeyId", "RequestTimeTooSkewed", "AuthorizationHeaderMalformed", "AccessDenied"]) {
    answer(403, xml(code));
    await assert.rejects(
      () => putRailwayObject("customer-documents", "cust-1/a.pdf", Buffer.from("x"), "application/pdf"),
      (error: Error) => {
        assert.equal(error.message, `Railway object upload failed (HTTP 403 ${code}).`);
        assert.doesNotMatch(error.message, /text that must never|AKIATEST|fixture-secret|storage\.example/);
        return true;
      },
    );
  }
  answer(503, "<html>busy</html>");
  await assert.rejects(() => putRailwayObject("customer-documents", "cust-1/a.pdf", Buffer.from("x"), "application/pdf"), /^Error: Railway object upload failed \(HTTP 503\)\.$/);
});

test("network failures say why: refused, DNS, TLS and timeout", async () => {
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  fail(refused);
  await assert.rejects(() => getRailwayObject("customer-documents", "cust-1/a.pdf"), /Railway object storage unreachable \(ECONNREFUSED\)\./);
  fail(Object.assign(new TypeError("fetch failed"), { cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } }));
  await assert.rejects(() => getRailwayObject("customer-documents", "cust-1/a.pdf"), /unreachable \(DEPTH_ZERO_SELF_SIGNED_CERT\)/);
  fail(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
  process.env.RAILWAY_S3_TIMEOUT_MS = "5000";
  await assert.rejects(() => getRailwayObject("customer-documents", "cust-1/a.pdf"), /unreachable \(no answer within 5 s\)/);
  delete process.env.RAILWAY_S3_TIMEOUT_MS;
});

test("a wrong bucket name is a configuration fault, not 'file not found' or a completed delete", async () => {
  answer(404, xml("NoSuchKey"));
  assert.equal(await getRailwayObject("customer-documents", "cust-1/missing.pdf"), null);
  await assert.doesNotReject(() => deleteRailwayObject("customer-documents", "cust-1/missing.pdf"));
  answer(404, "");
  assert.equal(await getRailwayObject("customer-documents", "cust-1/missing.pdf"), null, "providers that answer 404 without a body still mean 'not found'");
  answer(404, xml("NoSuchBucket"));
  await assert.rejects(() => getRailwayObject("customer-documents", "cust-1/a.pdf"), /Railway object read failed \(HTTP 404 NoSuchBucket\)/);
  await assert.rejects(() => deleteRailwayObject("quote-assets", "watermarks/w.png"), /Railway object delete failed \(HTTP 404 NoSuchBucket\)/);
  answer(204);
  await assert.doesNotReject(() => deleteRailwayObject("quote-assets", "watermarks/w.png"));
});

test("conditional writes still report a lost race as false and other failures as errors", async () => {
  answer(412, xml("PreconditionFailed"));
  assert.equal(await putRailwayObjectConditional("customer-documents", "whatsapp-agent/settings.json", Buffer.from("{}"), "application/json", null), false);
  assert.equal((calls[0].init.headers as Record<string, string>)["if-none-match"], "*");
  answer(200);
  assert.equal(await putRailwayObjectConditional("customer-documents", "whatsapp-agent/settings.json", Buffer.from("{}"), "application/json", '"abc"'), true);
  assert.equal((calls[1].init.headers as Record<string, string>)["if-match"], '"abc"');
  answer(404, xml("NoSuchKey"));
  await assert.rejects(() => putRailwayObjectConditional("customer-documents", "whatsapp-agent/settings.json", Buffer.from("{}"), "application/json", '"abc"'), /HTTP 404 NoSuchKey/);
});

test("rewriting a stored document URL never throws", () => {
  const legacy = (key: string) => `https://old.supabase.co/storage/v1/object/public/customer-documents/${key}`;
  assert.equal(rewriteLegacyStorageUrl(legacy("cust-1/%E0%A4%A"), null, baseEnv), legacy("cust-1/%E0%A4%A"), "bad %-escape keeps the stored URL");
  assert.equal(rewriteLegacyStorageUrl(legacy("x"), "cust-1/a\\b.pdf", baseEnv), legacy("x"), "backslash path keeps the stored URL");
  assert.equal(rewriteLegacyStorageUrl(legacy("x"), "k".repeat(2000), baseEnv), legacy("x"));
  assert.equal(rewriteLegacyStorageUrl(legacy("x"), "cust-1/a.pdf", { ...baseEnv, RAILWAY_S3_ENDPOINT: "http://insecure.example.test" }), legacy("x"), "a misconfigured endpoint must not break the list");
  assert.match(rewriteLegacyStorageUrl(legacy("1700_scan..pdf"), "cust-1/1700_scan..pdf", baseEnv), /^https:\/\/crm\.example\.test\/api\/storage\/object\/customer-documents\//, "a legitimate name with two dots is now signed");
});

test("stored proxy links are re-issued after the proxy secret rotates, only for the row's own object", () => {
  const before = buildRailwayObjectProxyUrl("customer-documents", "cust-1/1700_a.pdf", baseEnv);
  const rotated = { ...baseEnv, RAILWAY_OBJECT_PROXY_SECRET: "a-completely-new-proxy-secret-0002-abcdef" };
  const parts = (url: string) => {
    const parsed = new URL(url);
    const [, , , , namespace, encoded] = parsed.pathname.split("/");
    return verifyRailwayObjectProxySignature(namespace, encoded, parsed.searchParams.get("sig") || "", rotated);
  };
  assert.deepEqual(parts(before), { ok: false }, "the old link is dead under the new secret");
  const reissued = rewriteLegacyStorageUrl(before, "cust-1/1700_a.pdf", rotated);
  assert.notEqual(reissued, before);
  assert.deepEqual(parts(reissued), { ok: true, namespace: "customer-documents", key: "cust-1/1700_a.pdf" });
  assert.equal(rewriteLegacyStorageUrl(before, "cust-2/other.pdf", rotated), before, "a link to a different object is never swapped for another key");
  assert.equal(rewriteLegacyStorageUrl(before, null, rotated), before, "without a storage path there is nothing to re-sign from");
});

test("internal objects can never be signed through a document row", () => {
  const legacy = "https://old.supabase.co/storage/v1/object/public/customer-documents/innocent.pdf";
  assert.equal(rewriteLegacyStorageUrl(legacy, "whatsapp-agent/settings.json", baseEnv), legacy);
  assert.equal(rewriteLegacyStorageUrl("https://x.test/storage/v1/object/public/customer-documents/whatsapp-agent/pending/c1.json", null, baseEnv), "https://x.test/storage/v1/object/public/customer-documents/whatsapp-agent/pending/c1.json");
  const own = buildRailwayObjectProxyUrl("customer-documents", "whatsapp-agent/settings.json", baseEnv);
  assert.equal(rewriteLegacyStorageUrl(own, "whatsapp-agent/settings.json", baseEnv), own, "left untouched, not re-issued");
});

test("a new document row may only name its own client's folder or a Smart Quote archive", () => {
  assert.equal(isStoragePathForCustomer("cust-1", "cust-1/1700_a.pdf"), true);
  assert.equal(isStoragePathForCustomer("cust-1", "smart-quotes/lead-1/SES-20261001-0001-ab.pdf"), true);
  assert.equal(isStoragePathForCustomer("cust-1", "cust-2/1700_a.pdf"), false);
  assert.equal(isStoragePathForCustomer("cust-1", "cust-10/1700_a.pdf"), false, "prefix must end at the folder boundary");
  assert.equal(isStoragePathForCustomer("cust-1", "whatsapp-agent/settings.json"), false);
  assert.equal(isStoragePathForCustomer("", "cust-1/a.pdf"), false);
  assert.equal(isStoragePathForCustomer("cust-1", "/cust-1/a.pdf"), true, "leading slashes are normalised like the signer does");
});

test("RAILWAY_OBJECT_PROXY_SECRET_PREVIOUS keeps earlier links valid during a rotation, and only those", () => {
  const oldLink = buildRailwayObjectProxyUrl("customer-documents", "cust-1/1700_a.pdf", baseEnv);
  const parse = (url: string) => {
    const parsed = new URL(url);
    const [, , , , namespace, encoded] = parsed.pathname.split("/");
    return { namespace, encoded, sig: parsed.searchParams.get("sig") || "" };
  };
  const rotated = { ...baseEnv, RAILWAY_OBJECT_PROXY_SECRET: "a-completely-new-proxy-secret-0002-abcdef" };
  const { namespace, encoded, sig } = parse(oldLink);
  assert.deepEqual(verifyRailwayObjectProxySignature(namespace, encoded, sig, rotated), { ok: false }, "without the previous secret every old link is revoked");
  const overlap = { ...rotated, RAILWAY_OBJECT_PROXY_SECRET_PREVIOUS: baseEnv.RAILWAY_OBJECT_PROXY_SECRET };
  assert.deepEqual(verifyRailwayObjectProxySignature(namespace, encoded, sig, overlap), { ok: true, namespace: "customer-documents", key: "cust-1/1700_a.pdf" });
  const newLink = parse(buildRailwayObjectProxyUrl("customer-documents", "cust-1/1700_a.pdf", overlap));
  assert.notEqual(newLink.sig, sig, "new links are always signed with the new secret");
  assert.equal(verifyRailwayObjectProxySignature(newLink.namespace, newLink.encoded, newLink.sig, overlap).ok, true);
  assert.equal(verifyRailwayObjectProxySignature(namespace, encoded, "0".repeat(64), overlap).ok, false, "a forged signature is still refused");
  assert.equal(verifyRailwayObjectProxySignature("quote-assets", encoded, sig, overlap).ok, false, "a link cannot move to another namespace");
});
