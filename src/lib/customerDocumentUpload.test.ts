/**
 * P0 customer document upload: customerId validation, auth-before-I/O, containment, cleanup.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertValidCustomerId,
  getCustomerDocsStorageRoot,
  resolveSafeCustomerDocsDirectory,
  resolveSafeLocalCustomerDocumentPath,
} from "./customerDocumentPath.ts";
import {
  CustomerProfileError,
  removeUploadedCustomerDocument,
  uploadAndAssignAdminCustomerDocument,
  uploadFileToCustomerStorage,
} from "../../customerProfileDb.ts";

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

const validCustomerId = "cust-upload-1";
const tinyPdfBase64 =
  "data:application/pdf;base64," + Buffer.from("%PDF-1.4\n%%EOF\n", "utf8").toString("base64");

function adminDb(overrides: Record<string, unknown> = {}): any {
  return {
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
      {
        id: "u-sales-1",
        username: "sales",
        name: "Sales",
        email: "s@example.com",
        role: "Sales Executive",
        account_status: "Approved",
        password: "x",
      },
    ],
    customers: [{ id: validCustomerId, name: "Upload Customer" }],
    customerDocuments: [],
    ...overrides,
  };
}

function listOutsideLeakCandidates(cwd: string, customerId: string): string[] {
  const root = getCustomerDocsStorageRoot(cwd);
  const candidates = [
    path.resolve(cwd, "public"),
    path.resolve(cwd, customerId),
    path.resolve(cwd, "..", "public"),
    path.resolve(root, "..", "public"),
    path.resolve(cwd, "storage", "public"),
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

await test("rejects customerId ../../public and other traversal IDs", () => {
  assert.equal(assertValidCustomerId("../../public"), null);
  assert.equal(assertValidCustomerId(".."), null);
  assert.equal(assertValidCustomerId("../cust"), null);
  assert.equal(assertValidCustomerId("cust/../x"), null);
  assert.equal(resolveSafeCustomerDocsDirectory("../../public"), null);
});

await test("rejects absolute, Windows, encoded, slash and backslash customer IDs", () => {
  assert.equal(assertValidCustomerId("/etc/passwd"), null);
  assert.equal(assertValidCustomerId("C:\\Users\\evil"), null);
  assert.equal(assertValidCustomerId("C:/Users/evil"), null);
  assert.equal(assertValidCustomerId("cust%2e%2e"), null);
  assert.equal(assertValidCustomerId("cust/extra"), null);
  assert.equal(assertValidCustomerId("cust\\extra"), null);
  assert.equal(assertValidCustomerId("cust.id"), null);
  assert.equal(assertValidCustomerId(""), null);
  assert.equal(assertValidCustomerId("   "), null);
  assert.equal(assertValidCustomerId("cust\0id"), null);
  assert.equal(assertValidCustomerId(validCustomerId), validCustomerId);
});

await test("no directory or file is created outside the storage root for bad customerId", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-upload-bad-"));
  const before = listOutsideLeakCandidates(cwd, "../../public");
  assert.equal(before.length, 0);

  await assert.rejects(
    () =>
      uploadFileToCustomerStorage("../../public", tinyPdfBase64, "leak.pdf", "application/pdf", {
        cwd,
      }),
    (err: any) => err instanceof CustomerProfileError && /Invalid customerId/i.test(err.message)
  );

  await assert.rejects(
    () =>
      uploadAndAssignAdminCustomerDocument(
        "u-admin-1",
        "allauddin",
        "Super Admin",
        {
          customerId: "../../public",
          base64Data: tinyPdfBase64,
          fileName: "leak.pdf",
          mimeType: "application/pdf",
        },
        adminDb(),
        { cwd }
      ),
    (err: any) => err instanceof CustomerProfileError && /Invalid customerId/i.test(err.message)
  );

  assert.equal(listOutsideLeakCandidates(cwd, "../../public").length, 0);
  assert.equal(fs.existsSync(getCustomerDocsStorageRoot(cwd)), false);
  fs.rmSync(cwd, { recursive: true, force: true });
});

await test("unauthorized staff causes no filesystem write", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-upload-unauth-"));
  const db = adminDb();

  await assert.rejects(
    () =>
      uploadAndAssignAdminCustomerDocument(
        "u-sales-1",
        "sales",
        "Sales Executive",
        {
          customerId: validCustomerId,
          base64Data: tinyPdfBase64,
          fileName: "secret.pdf",
          mimeType: "application/pdf",
        },
        db,
        { cwd }
      ),
    (err: any) => err instanceof CustomerProfileError && err.statusCode === 403
  );

  assert.equal(fs.existsSync(getCustomerDocsStorageRoot(cwd)), false);
  assert.equal(db.customerDocuments.length, 0);
  fs.rmSync(cwd, { recursive: true, force: true });
});

await test("nonexistent customer causes no write", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-upload-missing-"));
  const db = adminDb({ customers: [] });

  await assert.rejects(
    () =>
      uploadAndAssignAdminCustomerDocument(
        "u-admin-1",
        "allauddin",
        "Super Admin",
        {
          customerId: validCustomerId,
          base64Data: tinyPdfBase64,
          fileName: "ghost.pdf",
          mimeType: "application/pdf",
        },
        db,
        { cwd }
      ),
    (err: any) => err instanceof CustomerProfileError && err.statusCode === 404
  );

  assert.equal(fs.existsSync(getCustomerDocsStorageRoot(cwd)), false);
  assert.equal(db.customerDocuments.length, 0);
  fs.rmSync(cwd, { recursive: true, force: true });
});

await test("valid customer upload and authenticated download path still work", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-upload-ok-"));
  const db = adminDb();

  const doc = await uploadAndAssignAdminCustomerDocument(
    "u-admin-1",
    "allauddin",
    "Super Admin",
    {
      customerId: validCustomerId,
      base64Data: tinyPdfBase64,
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
      documentType: "invoice",
      title: "Invoice",
    },
    db,
    { cwd }
  );

  assert.ok(doc.id);
  assert.equal(db.customerDocuments.length, 1);
  const storedPath = db.customerDocuments[0].storage_path;
  assert.match(String(storedPath), new RegExp(`^${validCustomerId}/\\d+_[a-f0-9]+_invoice\\.pdf$`));

  const abs = resolveSafeLocalCustomerDocumentPath(storedPath, validCustomerId, cwd);
  assert.ok(abs);
  assert.ok(abs.startsWith(path.join(getCustomerDocsStorageRoot(cwd), validCustomerId) + path.sep));
  assert.ok(fs.existsSync(abs));
  assert.equal(fs.readFileSync(abs, "utf8").startsWith("%PDF"), true);
  assert.equal((doc as any).fileUrl, `/api/customer-documents/${doc.id}/download`);

  // Original user filename must not be used as the on-disk name (unique server name).
  assert.equal(
    fs.existsSync(path.join(getCustomerDocsStorageRoot(cwd), validCustomerId, "invoice.pdf")),
    false
  );

  fs.rmSync(cwd, { recursive: true, force: true });
});

await test("assignment failure cleans up the uploaded local file", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-upload-cleanup-"));
  const boomDocs: any[] = [];
  boomDocs.unshift = () => {
    throw new Error("forced assign failure");
  };
  const db = adminDb({ customerDocuments: boomDocs });

  await assert.rejects(
    () =>
      uploadAndAssignAdminCustomerDocument(
        "u-admin-1",
        "allauddin",
        "Super Admin",
        {
          customerId: validCustomerId,
          base64Data: tinyPdfBase64,
          fileName: "cleanup.pdf",
          mimeType: "application/pdf",
        },
        db,
        { cwd }
      ),
    (err: any) => String(err?.message || "").includes("forced assign failure")
  );

  const customerDir = resolveSafeCustomerDocsDirectory(validCustomerId, cwd);
  assert.ok(customerDir);
  const remaining = fs.existsSync(customerDir) ? fs.readdirSync(customerDir) : [];
  assert.deepEqual(remaining, []);
  fs.rmSync(cwd, { recursive: true, force: true });
});

await test("removeUploadedCustomerDocument removes a known local object key", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sc-upload-rm-"));
  const uploaded = await uploadFileToCustomerStorage(
    validCustomerId,
    tinyPdfBase64,
    "rm.pdf",
    "application/pdf",
    { cwd }
  );
  const abs = resolveSafeLocalCustomerDocumentPath(uploaded.storagePath, validCustomerId, cwd);
  assert.ok(abs && fs.existsSync(abs));
  await removeUploadedCustomerDocument(uploaded.storagePath, validCustomerId, { cwd });
  assert.equal(fs.existsSync(abs), false);
  fs.rmSync(cwd, { recursive: true, force: true });
});

if (savedUrl) process.env.SUPABASE_URL = savedUrl;
else delete process.env.SUPABASE_URL;
if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
else delete process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log(`\nCustomer document upload containment tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
