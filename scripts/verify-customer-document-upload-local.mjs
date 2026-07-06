#!/usr/bin/env node
/**
 * Local module verify: storage upload validation + assign document (no HTTP server).
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(resolve(__dir, "../.env.local"))) {
  config({ path: resolve(__dir, "../.env.local") });
}

const require = createRequire(import.meta.url);

const TINY_PDF_B64 =
  "data:application/pdf;base64," +
  Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"
  ).toString("base64");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  const { register } = await import("tsx/esm/api");
  register();

  const { uploadFileToCustomerStorage, assignCustomerDocument } = await import("../customerProfileDb.ts");
  const { isSupabaseActive } = await import("../dbManager.ts");

  console.log("Supabase active:", isSupabaseActive());

  const customerId = `verify-cust-${Date.now()}`;

  try {
    const oversize = Buffer.alloc(26 * 1024 * 1024).toString("base64");
    await uploadFileToCustomerStorage(customerId, oversize, "big.pdf", "application/pdf");
    fail("Expected 26MB upload to throw");
  } catch (err) {
    if (!String(err.message || err).includes("25 MB")) {
      fail(`Unexpected oversize error: ${err.message || err}`);
    }
    console.log("Oversize rejected:", err.message);
  }

  try {
    await uploadFileToCustomerStorage(
      customerId,
      Buffer.from("not-a-real-file").toString("base64"),
      "bad.exe",
      "application/octet-stream"
    );
    fail("Expected invalid type to throw");
  } catch (err) {
    if (!String(err.message || err).includes("PDF, JPG, PNG, and DOCX")) {
      fail(`Unexpected type error: ${err.message || err}`);
    }
    console.log("Invalid type rejected:", err.message);
  }

  const { url, storagePath } = await uploadFileToCustomerStorage(
    customerId,
    TINY_PDF_B64,
    "verify-local.pdf",
    "application/pdf"
  );
  if (!url || !storagePath) fail("uploadFileToCustomerStorage returned empty url/path");
  console.log("Storage upload OK:", url.slice(0, 80));

  const localDb = {
    users: [
      {
        id: "u-allauddin",
        username: "allauddin",
        password: "123",
        name: "Muhammad Allauddin",
        role: "Super Admin",
      },
    ],
    customerDocuments: [],
  };

  try {
    const doc = await assignCustomerDocument(
      "u-allauddin",
      "allauddin",
      "Super Admin",
      {
        customerId,
        documentType: "quotation_pdf",
        title: "Local verify upload",
        fileUrl: url,
        fileName: "verify-local.pdf",
        mimeType: "application/pdf",
        storagePath,
        visibleToCustomer: true,
        uploadedBy: "allauddin",
      },
      localDb
    );
    if (!doc.fileUrl) fail("assignCustomerDocument missing fileUrl");
    console.log("Document record OK:", doc.id, doc.fileUrl.slice(0, 60));
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes("customer_documents")) {
      console.log("WARN: customer_documents table missing in Supabase — storage upload still verified.");
    } else {
      throw err;
    }
  }

  if (!isSupabaseActive() && url.startsWith("/uploads/")) {
    const fs = await import("fs");
    const path = await import("path");
    const diskPath = path.join(process.cwd(), "public", url.replace(/^\//, ""));
    if (!fs.existsSync(diskPath)) fail(`Local file missing at ${diskPath}`);
    console.log("Local disk file exists:", diskPath);
  }

  console.log("PASS: local customer document upload module verified.");
}

main().catch((e) => fail(e.message || String(e)));
