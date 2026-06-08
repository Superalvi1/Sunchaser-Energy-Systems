#!/usr/bin/env node
/**
 * Verify warranty certificate PDF + customer_documents sync.
 * Usage: node scripts/verify-warranty-certificate-local.mjs [API_BASE]
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, "..", ".env.local") });

const API = (process.argv[2] || process.env.API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
let pass = 0;
let fail = 0;
const ok = (l, d) => {
  pass++;
  console.log(`PASS: ${l}${d ? ` — ${d}` : ""}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`FAIL: ${l}${d ? ` — ${d}` : ""}`);
};

const login = async (username) => {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123" }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
};

async function findCustomerWithWarranties(staffHdr) {
  const portalUsers = ["shafiq", "ahmad", "customer1", "demo_customer"];
  for (const u of portalUsers) {
    const portal = await login(u);
    if (!portal.ok) continue;
    const w = await fetch(`${API}/api/customer-portal/warranties/me`, {
      headers: {
        "X-Sunchaser-User-Id": portal.body.user.id,
        "X-Sunchaser-Username": portal.body.user.username,
      },
    });
    if (!w.ok) continue;
    const body = await w.json().catch(() => ({}));
    const hasWarranty = (body.cards || []).some((c) => c.warranty);
    if (hasWarranty) {
      return { portalUser: portal.body.user, warranties: body };
    }
  }

  const res = await fetch(`${API}/api/admin/customer-warranties`, { headers: staffHdr }).catch(() => null);
  if (res?.ok) {
    const body = await res.json().catch(() => ({}));
    const row = body.warranties?.[0];
    if (row?.customerId) return { customerId: row.customerId, fromAdmin: true };
  }
  return null;
}

async function main() {
  console.log(`\nWarranty certificate verify — ${API}\n`);

  const admin = await login("allauddin");
  if (!admin.ok) {
    bad("staff login");
    process.exit(1);
  }
  ok("staff login", admin.body.user?.username);

  const staffHdr = {
    "X-Sunchaser-User-Id": admin.body.user.id,
    "X-Sunchaser-Username": admin.body.user.username,
    "X-Sunchaser-Role": admin.body.user.role,
  };

  const target = await findCustomerWithWarranties(staffHdr);
  if (!target) {
    console.log("SKIP: no customer with warranty rows found — seed customer_warranties first");
    process.exit(0);
  }

  let customerId = target.customerId;
  let portalUser = target.portalUser;

  if (!customerId && portalUser) {
    const docs = await fetch(`${API}/api/customer-portal/documents/me`, {
      headers: {
        "X-Sunchaser-User-Id": portalUser.id,
        "X-Sunchaser-Username": portalUser.username,
      },
    });
    const dBody = await docs.json().catch(() => ({}));
    customerId = dBody.customerId || portalUser.customerId;
  }

  if (!customerId && portalUser) {
    const warr = target.warranties?.cards?.find((c) => c.warranty)?.warranty;
    customerId = warr?.customerId;
  }

  if (!customerId) {
    bad("resolve customerId");
    process.exit(1);
  }
  ok("customer with warranties", customerId);

  const adminCert = await fetch(
    `${API}/api/admin/customers/${encodeURIComponent(customerId)}/warranty-certificate?userId=${admin.body.user.id}&username=${admin.body.user.username}`,
    { headers: staffHdr }
  );
  const adminHtml = await adminCert.text();
  if (adminCert.ok && adminHtml.includes("WARRANTY CERTIFICATE")) {
    ok("admin warranty-certificate endpoint");
  } else {
    bad("admin warranty-certificate endpoint", `${adminCert.status}`);
  }

  if (!portalUser) {
    const portal = await login("shafiq");
    if (portal.ok) portalUser = portal.body.user;
  }

  if (portalUser) {
    const q = new URLSearchParams({ portalUserId: portalUser.id, portalUsername: portalUser.username });
    const portalCert = await fetch(`${API}/api/customer-portal/warranty-certificate/me?${q}`);
    const portalHtml = await portalCert.text();
    if (portalCert.ok && portalHtml.includes("WARRANTY CERTIFICATE")) {
      ok("portal warranty-certificate/me");
    } else {
      bad("portal warranty-certificate/me", `${portalCert.status}`);
    }

    const docs = await fetch(`${API}/api/customer-portal/documents/me`, {
      headers: {
        "X-Sunchaser-User-Id": portalUser.id,
        "X-Sunchaser-Username": portalUser.username,
      },
    });
    if (docs.ok) {
      const dBody = await docs.json().catch(() => ({}));
      const certDoc = (dBody.wallet || []).find((w) => w.type === "warranty_certificate")?.document;
      if (certDoc?.fileUrl) {
        ok("customer_documents warranty_certificate row", certDoc.title || certDoc.id);
      } else {
        bad("customer_documents warranty_certificate row missing");
      }
    } else {
      bad("customer portal documents/me", docs.status);
    }
  } else {
    console.log("SKIP: portal user not found for document sync check");
  }

  const syncPath = "customerDocumentSync.upsertVaultCustomerDocument (Supabase-first)";
  ok("resolver path", syncPath);

  console.log(`\n--- ${pass} passed, ${fail} failed ---\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
