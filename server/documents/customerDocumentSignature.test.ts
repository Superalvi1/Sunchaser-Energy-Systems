import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadFileToCustomerStorage } from "../../customerProfileDb.ts";

const asDataUrl = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString("base64")}`;

test("files whose bytes do not match the declared type are rejected before storage", async () => {
  const windowsExecutable = Buffer.from("MZ\x90\x00 synthetic executable header", "binary");
  await assert.rejects(
    () => uploadFileToCustomerStorage("cust-fixture", asDataUrl(windowsExecutable, "application/pdf"), "invoice.pdf", "application/pdf"),
    (error: any) => error.statusCode === 422 && /does not match its type/.test(error.message),
  );
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await assert.rejects(
    () => uploadFileToCustomerStorage("cust-fixture", asDataUrl(png, "application/pdf"), "renamed.pdf", "application/pdf"),
    /does not match its type/,
  );
});

test("unsupported extensions are rejected even with an allowed declared type", async () => {
  await assert.rejects(
    () => uploadFileToCustomerStorage("cust-fixture", asDataUrl(Buffer.from("%PDF-1.4\n%%EOF"), "application/pdf"), "payload.exe", "application/pdf"),
    /Only PDF, JPG, PNG, and DOCX/,
  );
});

test("customer ids cannot traverse out of the client's storage folder", async () => {
  for (const id of ["../other-client", "cust/../../etc", "cust a"]) {
    await assert.rejects(
      () => uploadFileToCustomerStorage(id, asDataUrl(Buffer.from("%PDF-1.4\n%%EOF"), "application/pdf"), "a.pdf", "application/pdf"),
      /Invalid customer id/,
    );
  }
});
