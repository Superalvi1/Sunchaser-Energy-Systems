import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRailwayObjectProxyUrl,
  resolveRailwayObjectStorageConfig,
  rewriteLegacyStorageUrl,
  verifyRailwayObjectProxySignature,
} from "./railwayObjectStorage.ts";

const env = {
  RAILWAY_S3_ENDPOINT: "https://t3.storageapi.dev",
  RAILWAY_S3_BUCKET: "private-example-123",
  RAILWAY_S3_ACCESS_KEY_ID: "AKIATEST",
  RAILWAY_S3_SECRET_ACCESS_KEY: "secret",
  RAILWAY_S3_REGION: "auto",
  RAILWAY_OBJECT_PROXY_SECRET: "proxy-secret-that-is-long-and-random",
  APP_PUBLIC_URL: "https://crm.example.test",
};

test("requires complete private bucket configuration", () => {
  assert.equal(resolveRailwayObjectStorageConfig({}), null);
  assert.equal(resolveRailwayObjectStorageConfig(env)?.bucket, "private-example-123");
});

test("proxy URL is stable, signed and tamper evident", () => {
  const url = buildRailwayObjectProxyUrl(
    "customer-documents",
    "cust-1/file.pdf",
    env,
  );
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/");
  const verified = verifyRailwayObjectProxySignature(
    parts[3]!,
    parts[4]!,
    parsed.searchParams.get("sig") || "",
    env,
  );
  assert.deepEqual(verified, {
    ok: true,
    namespace: "customer-documents",
    key: "cust-1/file.pdf",
  });
  assert.deepEqual(
    verifyRailwayObjectProxySignature(
      parts[3]!,
      parts[4]!,
      "0".repeat(64),
      env,
    ),
    { ok: false },
  );
});

test("legacy Supabase public URLs rewrite to Railway proxy URLs", () => {
  const old =
    "https://old.supabase.co/storage/v1/object/public/customer-documents/cust-1/file.pdf";
  const next = rewriteLegacyStorageUrl(old, "cust-1/file.pdf", env);
  assert.match(next, /^https:\/\/crm\.example\.test\/api\/storage\/object\/customer-documents\//);
  assert.equal(next.includes("supabase.co"), false);
});
