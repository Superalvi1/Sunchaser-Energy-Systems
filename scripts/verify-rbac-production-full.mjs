#!/usr/bin/env node
/**
 * Full RBAC + customer profile production verify (post Supabase migration).
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-rbac-production-full.mjs
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, "..", ".env.local") });

const API = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");

const headers = (userId, username, extra = {}) => ({
  "Content-Type": "application/json",
  "X-Sunchaser-User-Id": userId,
  "X-Sunchaser-Username": username,
  ...extra,
});

async function json(pathname, opts = {}) {
  const res = await fetch(`${API}${pathname}`, opts);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text?.slice(0, 200) };
  }
  return { res, body, status: res.status };
}

async function login(username, password = "123") {
  return json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

const results = [];

function check(n, label, ok, detail = "") {
  results.push({ n, label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${n}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Minimal valid PDF (base64) for upload smoke test */
const TINY_PDF_B64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCAyMDAgMjAwXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDQKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjE5NQolJUVPRgo=";

async function main() {
  console.log(`\nRBAC production full verify — ${API}\n`);

  const adminLogin = await login("allauddin");
  if (!adminLogin.res.ok) {
    check(1, "allauddin login", false, adminLogin.body?.error || adminLogin.status);
    printSummary();
    process.exit(1);
  }
  const admin = adminLogin.body.user;
  const H = headers(admin.id, admin.username);

  // 1. roles-matrix dynamic
  const matrix = await json(
    `/api/auth/roles-matrix?userId=${encodeURIComponent(admin.id)}&username=${encodeURIComponent(admin.username)}`,
    { headers: H }
  );
  const dynamicOk =
    matrix.res.ok &&
    matrix.body.dynamic === true &&
    Array.isArray(matrix.body.roleRecords) &&
    matrix.body.roleRecords.length >= 9;
  check(
    1,
    "/api/auth/roles-matrix dynamic: true",
    dynamicOk,
    dynamicOk
      ? `roleRecords=${matrix.body.roleRecords.length}`
      : JSON.stringify({ dynamic: matrix.body.dynamic, roles: matrix.body.roles?.length })
  );

  // 2. roles table
  const rolesList = await json("/api/admin/roles", { headers: H });
  const rolesOk =
    rolesList.res.ok &&
    Array.isArray(rolesList.body.roles) &&
    rolesList.body.roles.length >= 9 &&
    rolesList.body.roles.some((r) => r.id && r.name && Array.isArray(r.permissions));
  check(
    2,
    "roles table (GET /api/admin/roles)",
    rolesOk,
    rolesOk ? `${rolesList.body.roles.length} roles` : rolesList.body?.error
  );

  // 3. Sales Executive: enable Settings, save, refresh (list) — must persist
  const salesRole = rolesList.body.roles?.find((r) => r.name === "Sales Executive");
  let permsOk = false;
  let permsDetail = "Sales Executive role not found";
  if (salesRole?.id) {
    const before = [...(salesRole.permissions || [])];
    const testKey = "settings";
    const enableSettings = [...new Set([...before, testKey])];
    const patch = await json(`/api/admin/roles/${salesRole.id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ permissions: enableSettings }),
    });
    const refresh = await json("/api/admin/roles", { headers: H });
    const afterRefresh = refresh.body.roles?.find((r) => r.id === salesRole.id);
    const matrixRefresh = await json(
      `/api/auth/roles-matrix?userId=${encodeURIComponent(admin.id)}&username=${encodeURIComponent(admin.username)}`,
      { headers: H }
    );
    const matrixPerms = matrixRefresh.body.permissions?.["Sales Executive"] || [];
    permsOk =
      patch.res.ok &&
      afterRefresh?.permissions?.includes(testKey) &&
      matrixPerms.includes(testKey);
    permsDetail = permsOk
      ? "Settings enabled after PATCH + GET /api/admin/roles + roles-matrix"
      : JSON.stringify({
          patch: patch.status,
          list: afterRefresh?.permissions,
          matrix: matrixPerms,
        });
    if (!before.includes(testKey)) {
      await json(`/api/admin/roles/${salesRole.id}`, {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ permissions: before }),
      });
    }
  }
  check(3, "Sales Executive Settings persists after refresh", permsOk, permsDetail);

  // Find Shafiq (or closest customer name match)
  const accounts = await json(`/api/admin/customer-accounts?role=${encodeURIComponent(admin.role)}`, {
    headers: H,
  });
  const shafiq =
    accounts.body.accounts?.find((a) => /shafiq/i.test(a.name || "")) ||
    accounts.body.accounts?.find((a) => /shafiq/i.test(a.username || ""));
  const shafiqLabel = shafiq
    ? `${shafiq.name || shafiq.username} (${shafiq.customerId})`
    : "not in customer-accounts";

  // 4 & 7. customer_systems for Shafiq
  let systemsOk = false;
  let systemsDetail = shafiq ? "" : "Shafiq customer account not found — skip write";
  if (shafiq?.customerId) {
    const marker = `verify-${Date.now()}`;
    const upsert = await json("/api/admin/customer-systems", {
      method: "PUT",
      headers: H,
      body: JSON.stringify({
        role: admin.role,
        customerId: shafiq.customerId,
        systemSizeKw: 10.5,
        systemType: "On-grid",
        panelBrand: "Longi",
        panelQuantity: 18,
        notes: marker,
      }),
    });
    const getSys = await json(
      `/api/admin/customer-systems/${encodeURIComponent(shafiq.customerId)}?role=${encodeURIComponent(admin.role)}`,
      { headers: H }
    );
    systemsOk =
      upsert.res.ok &&
      getSys.res.ok &&
      getSys.body.system?.systemSizeKw == 10.5 &&
      (getSys.body.system?.notes || "").includes(marker);
    systemsDetail = systemsOk
      ? `10.5 kW On-grid saved`
      : upsert.body?.error || getSys.body?.error || "mismatch";
    check(7, "Shafiq customer_systems save", systemsOk, systemsDetail);
  } else {
    check(7, "Shafiq customer_systems save", false, systemsDetail);
  }
  check(4, "customer_systems table", shafiq ? systemsOk : false, shafiq ? systemsDetail : systemsDetail);

  // 5 & 6. document upload + custom role (create ephemeral role)
  let uploadOk = false;
  let uploadDetail = shafiq ? "" : "no Shafiq customerId";
  let customRoleOk = false;
  let customRoleDetail = "";

  const roleName = `Verify Role ${Date.now()}`;
  const createRole = await json("/api/admin/roles", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      name: roleName,
      permissions: ["dashboard", "customers"],
    }),
  });
  customRoleOk =
    createRole.res.ok &&
    createRole.body.role?.name === roleName &&
    createRole.body.role?.permissions?.includes("customers");
  customRoleDetail = customRoleOk
    ? `created ${roleName}`
    : createRole.body?.error || createRole.status;
  if (createRole.body.role?.id) {
    await json(`/api/admin/roles/${createRole.body.role.id}`, { method: "DELETE", headers: H });
  }
  check(6, "Super Admin save custom role permissions", customRoleOk, customRoleDetail);

  if (shafiq?.customerId) {
    const uploadTitle = `RBAC verify quotation ${Date.now()}`;
    const upload = await json("/api/admin/customer-documents/upload", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        role: admin.role,
        customerId: shafiq.customerId,
        base64Data: TINY_PDF_B64,
        fileName: "verify-quotation.pdf",
        mimeType: "application/pdf",
        documentType: "quotation_pdf",
        title: uploadTitle,
        visibleToCustomer: true,
        internalOnly: false,
      }),
    });
    uploadOk =
      upload.res.ok &&
      upload.body?.fileUrl &&
      (upload.body.documentType === "quotation_pdf" || upload.body?.documentType === "quotation_pdf");
    uploadDetail = uploadOk
      ? upload.body.fileUrl?.slice(0, 60)
      : upload.body?.error || upload.status;

    // 8. portal visibility for Shafiq
    let portalOk = false;
    let portalDetail = "";
    if (shafiq.userId && shafiq.username) {
      const shafiqLogin = await login(shafiq.username);
      if (shafiqLogin.res.ok) {
        const u = shafiqLogin.body.user;
        const docs = await json("/api/customer-portal/documents/me", {
          headers: headers(u.id, u.username),
        });
        const found = (docs.body.documents || []).some(
          (d) =>
            (d.title || "").includes("RBAC verify quotation") ||
            (d.title || "") === uploadTitle ||
            d.documentType === "quotation_pdf"
        );
        portalOk = docs.res.ok && found;
        portalDetail = portalOk
          ? `${docs.body.documents?.length || 0} docs, quotation visible`
          : `portal docs=${docs.body.documents?.length}, upload title not found`;
      } else {
        portalDetail = `Shafiq login failed: ${shafiqLogin.body?.error}`;
      }
    } else {
      portalDetail = "missing userId/username for portal";
    }
    check(8, "Shafiq portal sees quotation/agreement", portalOk, portalDetail);
  } else {
    check(8, "Shafiq portal sees quotation/agreement", false, "Shafiq not found");
  }
  check(5, "customer_documents upload (storage + DB)", uploadOk, uploadDetail);

  printSummary();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function printSummary() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n--- ${pass} passed, ${fail} failed (${results.length} checks) ---\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
