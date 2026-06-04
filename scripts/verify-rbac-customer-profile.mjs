#!/usr/bin/env node
const API = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");

let pass = 0;
let fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.error(`  ✗ ${l}`, d || ""); };

async function json(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function main() {
  console.log(`\nRBAC + customer profile verify — ${API}\n`);

  const matrix = await json("/api/auth/roles-matrix");
  if (matrix.res.ok && matrix.body.permissionKeys?.length >= 13) {
    ok("roles-matrix includes expanded permissions");
  } else {
    bad("roles-matrix", matrix.body);
  }

  const health = await json("/health");
  if (health.res.ok) ok("health ok");
  else bad("health");

  const reg = await json("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `rbac-${Date.now()}`,
      password: "TestPass123!",
      name: "RBAC Test Customer",
      email: `rbac-${Date.now()}@example.com`,
      role: "Customer",
    }),
  });
  if (reg.res.status === 201) ok("customer registration still works");
  else bad("customer register", reg.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log("Note: Run scripts/rbac-customer-profile-schema.sql in Supabase for full dynamic roles + customer_systems.\n");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
