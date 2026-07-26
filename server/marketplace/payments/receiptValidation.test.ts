/**
 * Focused receipt MIME/signature security tests (no Docker).
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/payments/receiptValidation.test.ts
 */
import assert from "node:assert/strict";
import {
  isSuspiciousFileName,
  validateReceiptBytes,
} from "./receiptValidation.ts";
import { assertSafeStoragePath } from "./receiptStorage.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 1),
]);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 2),
]);
const pdf = Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

check(
  "jpeg accepted",
  validateReceiptBytes({ declaredMime: "image/jpeg", bytes: jpeg }).ok === true,
);
check(
  "png accepted",
  validateReceiptBytes({ declaredMime: "image/png", bytes: png }).ok === true,
);
check(
  "pdf accepted",
  validateReceiptBytes({ declaredMime: "application/pdf", bytes: pdf }).ok === true,
);

const mismatch = validateReceiptBytes({ declaredMime: "image/png", bytes: jpeg });
check("mime/signature mismatch rejected", mismatch.ok === false && mismatch.code === "INVALID_FILE_CONTENT");

const html = Buffer.from("<!DOCTYPE html><html><body>x</body></html>");
const htmlAsPdf = validateReceiptBytes({
  declaredMime: "application/pdf",
  bytes: Buffer.concat([Buffer.from("%PDF"), html]),
});
check("html polyglot pdf rejected", htmlAsPdf.ok === false);

const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
check(
  "executable rejected",
  validateReceiptBytes({ declaredMime: "image/jpeg", bytes: exe }).ok === false,
);

const empty = validateReceiptBytes({
  declaredMime: "image/jpeg",
  bytes: Buffer.alloc(0),
});
check("empty rejected", empty.ok === false && empty.code === "INVALID_FILE_CONTENT");

const huge = validateReceiptBytes({
  declaredMime: "image/jpeg",
  bytes: Buffer.concat([jpeg, Buffer.alloc(6 * 1024 * 1024)]),
});
check("oversized rejected", huge.ok === false && huge.code === "FILE_TOO_LARGE");

check("double extension suspicious", isSuspiciousFileName("receipt.pdf.exe") === true);
check("svg name suspicious", isSuspiciousFileName("x.svg") === true);
check("clean name ok", isSuspiciousFileName("receipt.jpg") === false);

let pathOk = true;
try {
  assertSafeStoragePath("mp-receipts/abcdef012345/mpui_abc123");
} catch {
  pathOk = false;
}
check("server path accepted", pathOk);

let traversal = false;
try {
  assertSafeStoragePath("mp-receipts/../etc/passwd");
} catch {
  traversal = true;
}
check("traversal path rejected", traversal);

let clientPath = false;
try {
  assertSafeStoragePath("uploads/user-controlled.jpg");
} catch {
  clientPath = true;
}
check("caller-controlled path rejected", clientPath);

console.log("\nreceiptValidation tests passed");
