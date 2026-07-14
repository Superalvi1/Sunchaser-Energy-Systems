/**
 * P0 customer document path containment tests.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertSafeSupabaseCustomerObjectPath,
  getCustomerDocsStorageRoot,
  isServerGeneratedCustomerStoragePath,
  resolveSafeLocalCustomerDocumentPath,
} from "./customerDocumentPath.ts";
import { assignCustomerDocument } from "../../customerProfileDb.ts";

const savedUrl = process.env.SUPABASE_URL;
const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

const customerId = "cust-safe-1";
const otherCustomer = "cust-other-2";

await test("rejects /etc/passwd and absolute OS paths for local resolve", () => {
  assert.equal(resolveSafeLocalCustomerDocumentPath("/etc/passwd", customerId), null);
  assert.equal(resolveSafeLocalCustomerDocumentPath("/etc/passwd", customerId, "/tmp"), null);
  assert.equal(resolveSafeLocalCustomerDocumentPath("C:\\Windows\\System32\\config", customerId), null);
});

await test("rejects .. traversal and encoded/mixed traversal", () => {
  assert.equal(
    resolveSafeLocalCustomerDocumentPath(`storage/customer-docs/${customerId}/../../etc/passwd`, customerId),
    null
  );
  assert.equal(
    resolveSafeLocalCustomerDocumentPath(`storage/customer-docs/${customerId}/%2e%2e/%2e%2e/etc/passwd`, customerId),
    null
  );
  assert.equal(
    resolveSafeLocalCustomerDocumentPath(`storage/customer-docs/${customerId}/..\\..\\etc\\passwd`, customerId),
    null
  );
  assert.equal(assertSafeSupabaseCustomerObjectPath(`${customerId}/../etc/passwd`, customerId), null);
  assert.equal(assertSafeSupabaseCustomerObjectPath(`${customerId}/%2e%2e/secret`, customerId), null);
});

await test("rejects Windows drive paths and backslashes", () => {
  assert.equal(resolveSafeLocalCustomerDocumentPath("D:\\leak\\file.pdf", customerId), null);
  assert.equal(assertSafeSupabaseCustomerObjectPath(`${customerId}\\file.pdf`, customerId), null);
  assert.equal(assertSafeSupabaseCustomerObjectPath(`C:/Users/file.pdf`, customerId), null);
});

await test("rejects cross-customer Supabase and local paths", () => {
  assert.equal(
    assertSafeSupabaseCustomerObjectPath(`${otherCustomer}/report.pdf`, customerId),
    null
  );
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-doc-"));
  const otherDir = path.join(getCustomerDocsStorageRoot(cwd), otherCustomer);
  fs.mkdirSync(otherDir, { recursive: true });
  const otherFile = path.join(otherDir, "secret.pdf");
  fs.writeFileSync(otherFile, "x");
  assert.equal(resolveSafeLocalCustomerDocumentPath(otherFile, customerId, cwd), null);
  fs.rmSync(cwd, { recursive: true, force: true });
});

await test("accepts valid uploaded document under storage/customer-docs/{customerId}", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-doc-"));
  const root = getCustomerDocsStorageRoot(cwd);
  const custDir = path.join(root, customerId);
  fs.mkdirSync(custDir, { recursive: true });
  const file = path.join(custDir, "invoice.pdf");
  fs.writeFileSync(file, "%PDF-1.4");

  const resolved = resolveSafeLocalCustomerDocumentPath(file, customerId, cwd);
  assert.equal(resolved, path.resolve(file));

  const relative = path.relative(cwd, file);
  assert.equal(resolveSafeLocalCustomerDocumentPath(relative, customerId, cwd), path.resolve(file));

  assert.equal(
    assertSafeSupabaseCustomerObjectPath(`${customerId}/1730000000_invoice.pdf`, customerId),
    `${customerId}/1730000000_invoice.pdf`
  );
  assert.equal(
    isServerGeneratedCustomerStoragePath(`${customerId}/1730000000_invoice.pdf`, customerId, cwd),
    true
  );

  fs.rmSync(cwd, { recursive: true, force: true });
});

await test("admin assign ignores client-supplied storagePath", async () => {
  const mockDb: any = {
    users: [
      {
        id: "u-admin-1",
        username: "allauddin",
        name: "Admin",
        email: "a@example.com",
        role: "Super Admin",
        account_status: "Approved",
        password: "x",
      },
    ],
    customerDocuments: [],
  };

  const doc = await assignCustomerDocument(
    "u-admin-1",
    "allauddin",
    "Super Admin",
    {
      customerId,
      documentType: "invoice",
      title: "Invoice",
      fileUrl: "/api/customer-documents/pending/download",
      storagePath: "/etc/passwd",
    },
    mockDb
  );

  assert.equal((doc as any).storagePath ?? null, null);
  const stored = mockDb.customerDocuments[0];
  assert.equal(stored.storage_path, null);
  assert.notEqual(stored.storage_path, "/etc/passwd");
});

await test("upload option persists only validated server-generated path", async () => {
  const mockDb: any = {
    users: [
      {
        id: "u-admin-1",
        username: "allauddin",
        name: "Admin",
        email: "a@example.com",
        role: "Super Admin",
        account_status: "Approved",
        password: "x",
      },
    ],
    customerDocuments: [],
  };

  await assert.rejects(
    () =>
      assignCustomerDocument(
        "u-admin-1",
        "allauddin",
        "Super Admin",
        {
          customerId,
          documentType: "invoice",
          title: "Invoice",
          fileUrl: "/api/customer-documents/pending/download",
        },
        mockDb,
        { serverGeneratedStoragePath: "/etc/passwd" }
      ),
    (err: any) => err?.message === "Invalid document storage path."
  );

  const ok = await assignCustomerDocument(
    "u-admin-1",
    "allauddin",
    "Super Admin",
    {
      customerId,
      documentType: "invoice",
      title: "Invoice",
      fileUrl: "/api/customer-documents/pending/download",
    },
    mockDb,
    { serverGeneratedStoragePath: `${customerId}/1730000000_invoice.pdf` }
  );
  assert.ok(ok);
  assert.equal(mockDb.customerDocuments[0].storage_path, `${customerId}/1730000000_invoice.pdf`);
});

if (savedUrl) process.env.SUPABASE_URL = savedUrl;
else delete process.env.SUPABASE_URL;
if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
else delete process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log(`\nCustomer document path containment tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
