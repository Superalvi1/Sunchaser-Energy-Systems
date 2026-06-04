#!/usr/bin/env node
/**
 * Smoke-test role-based registration API (production or local).
 * Usage: API_BASE=https://sunchaser-energy-systems.onrender.com node scripts/verify-user-registration.mjs
 */
const API_BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/$/, "");

let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log(`  ✓ ${label}`);
}
function fail(label, detail) {
  failed++;
  console.error(`  ✗ ${label}`, detail || "");
}

async function json(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

async function main() {
  console.log(`\nUser registration verify — ${API_BASE}\n`);

  const matrix = await json("/api/auth/roles-matrix");
  if (matrix.res.ok && matrix.body.roles?.length >= 9) {
    ok("roles-matrix returns 9+ roles");
  } else {
    fail("roles-matrix", matrix.body);
  }

  const dupUser = `test-${Date.now()}`;
  const reg = await json("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: dupUser,
      password: "TestPass123!",
      name: "Verify Customer",
      email: `${dupUser}@example.com`,
      role: "Customer",
    }),
  });
  if (reg.res.status === 201 && reg.body.user?.accountStatus === "Approved") {
    ok("customer self-register → Approved");
  } else {
    fail("customer register", { status: reg.res.status, body: reg.body });
  }

  const badRole = await json("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: `dir-${Date.now()}`,
      password: "TestPass123!",
      name: "Bad",
      email: `dir-${Date.now()}@example.com`,
      role: "Director",
    }),
  });
  if (badRole.res.status === 400) {
    ok("Director cannot self-register");
  } else {
    fail("Director block", { status: badRole.res.status });
  }

  const loginBad = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: dupUser, password: "wrong" }),
  });
  if (loginBad.res.status === 401) {
    ok("login rejects bad password");
  } else {
    fail("login bad password", loginBad.res.status);
  }

  const loginOk = await json("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: dupUser, password: "TestPass123!" }),
  });
  if (loginOk.res.ok && loginOk.body.user?.role === "Customer") {
    ok("customer can login after register");
  } else {
    fail("customer login", loginOk.body);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
