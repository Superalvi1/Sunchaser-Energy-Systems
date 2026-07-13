/**
 * P0 customer document privacy checks (static + helper invariants).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isPublicDocumentUrl, secureDocumentRecord } from "../../customerProfileDb.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

test("secureDocumentRecord rewrites to authenticated download path", () => {
  const doc = secureDocumentRecord({
    id: "doc-1",
    fileUrl: "https://xyz.supabase.co/storage/v1/object/public/customer-documents/a.pdf",
  });
  assert.equal(doc.fileUrl, "/api/customer-documents/doc-1/download");
});

test("isPublicDocumentUrl detects public/static paths", () => {
  assert.equal(
    isPublicDocumentUrl("https://x.supabase.co/storage/v1/object/public/customer-documents/a.pdf"),
    true
  );
  assert.equal(isPublicDocumentUrl("/uploads/customer-docs/cust-1/a.pdf"), true);
  assert.equal(isPublicDocumentUrl("/api/customer-documents/doc-1/download"), false);
});

test("upload path creates private bucket and never getPublicUrl", () => {
  const src = readFileSync(resolve("customerProfileDb.ts"), "utf8");
  assert.match(src, /createBucket\(bucket, \{\s*public:\s*false/);
  assert.equal(src.includes("getPublicUrl"), false);
  assert.match(src, /storage\/customer-docs/);
  assert.equal(src.includes('public", "uploads", "customer-docs"'), false);
});

test("server blocks unauthenticated /uploads/customer-docs", () => {
  const src = readFileSync(resolve("server.ts"), "utf8");
  assert.match(src, /app\.use\("\/uploads\/customer-docs"/);
  assert.match(src, /Authentication required to access customer documents/);
  assert.match(src, /\/api\/customer-documents\/:documentId\/download/);
});

console.log(`\nCustomer document privacy tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
