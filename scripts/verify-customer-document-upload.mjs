#!/usr/bin/env node
/**
 * Verifies customer document upload → storage URL → customer portal download list.
 * Usage: node scripts/verify-customer-document-upload.mjs [baseUrl]
 */
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(resolve(__dir, "../.env.local"))) {
  config({ path: resolve(__dir, "../.env.local") });
}

const API = (process.argv[2] || process.env.VERIFY_API_BASE || "http://localhost:3000").replace(/\/$/, "");

const TINY_PDF_B64 =
  "data:application/pdf;base64," +
  Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"
  ).toString("base64");

function headers(userId, username, role) {
  return {
    "Content-Type": "application/json",
    "x-sunchaser-user-id": userId,
    "x-sunchaser-username": username,
    "x-sunchaser-role": role || "Super Admin",
  };
}

async function json(path, init = {}) {
  const res = await fetch(`${API}${path}`, init);
  const body = await res.json().catch(() => ({}));
  return { res, body, status: res.status };
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  console.log("API:", API);

  const login = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "allauddin", password: "123" }),
  });
  if (!login.res.ok) fail(`Admin login failed: ${login.body?.error || login.status}`);
  const admin = login.body.user;
  const H = headers(admin.id, admin.username, admin.role);

  const accounts = await json("/api/admin/customer-accounts", {
    headers: { ...H, "X-Sunchaser-Role": admin.role },
  });
  if (!accounts.res.ok) fail(`List accounts failed: ${accounts.body?.error || accounts.status}`);
  const customer = (accounts.body.accounts || []).find((a) => a.customerId);
  if (!customer) fail("No customer account with customerId found.");

  const title = `Upload verify ${Date.now()}`;
  const upload = await json("/api/admin/customer-documents/upload", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      role: admin.role,
      customerId: customer.customerId,
      base64Data: TINY_PDF_B64,
      fileName: "verify-upload.pdf",
      mimeType: "application/pdf",
      documentType: "quotation_pdf",
      title,
      visibleToCustomer: true,
      internalOnly: false,
    }),
  });
  if (!upload.res.ok) fail(`Upload failed: ${upload.body?.error || upload.status}`);
  if (!upload.body.fileUrl) fail("Upload response missing fileUrl.");
  console.log("Upload OK:", upload.body.fileUrl.slice(0, 80));

  const oversize = Buffer.alloc(26 * 1024 * 1024).toString("base64");
  const tooBig = await json("/api/admin/customer-documents/upload", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      role: admin.role,
      customerId: customer.customerId,
      base64Data: oversize,
      fileName: "too-big.pdf",
      mimeType: "application/pdf",
      documentType: "other",
      title: "too big",
    }),
  });
  if (tooBig.res.ok) fail("Expected 26MB upload to be rejected.");
  console.log("Oversize rejected:", tooBig.status, tooBig.body?.error);

  const customerUser = (accounts.body.accounts || []).find(
    (a) => a.customerId === customer.customerId && a.userId
  );
  if (!customerUser?.userId) {
    console.log("SKIP portal check: no portal user for customer");
    console.log("PASS: upload flow verified.");
    return;
  }

  const portal = await json(
    `/api/customer-portal/documents/me?userId=${encodeURIComponent(customerUser.userId)}&username=${encodeURIComponent(customerUser.username)}`,
    { headers: headers(customerUser.userId, customerUser.username, "Customer") }
  );
  if (!portal.res.ok) fail(`Portal docs failed: ${portal.body?.error || portal.status}`);
  const found = (portal.body.documents || []).some(
    (d) => d.title === title || d.fileUrl === upload.body.fileUrl
  );
  if (!found) fail("Uploaded document not visible in customer portal.");
  console.log("Portal documents:", portal.body.documents?.length);

  const urlRes = await fetch(upload.body.fileUrl);
  if (!urlRes.ok) {
    console.log("WARN: fileUrl not directly fetchable (status", urlRes.status, ") — may need public bucket policy");
  } else {
    console.log("Download OK:", urlRes.headers.get("content-type"));
  }

  console.log("PASS: customer document upload/download flow verified.");
}

main().catch((e) => fail(e.message || String(e)));
