/**
 * Phase 17A production verification — user management create/delete/cleanup.
 * Usage: node scripts/verify-user-management-production.mjs
 */
const BASE = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
const TS = Date.now();

async function loginStaff() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.VERIFY_STAFF_USER || "allauddin",
      password: process.env.VERIFY_STAFF_PASS || "123",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Staff login failed");
  return data.user;
}

function hdr(staff) {
  return {
    "Content-Type": "application/json",
    "X-Sunchaser-User-Id": staff.id,
    "X-Sunchaser-Username": staff.username,
    "X-Sunchaser-Role": staff.role || "Super Admin",
  };
}

async function api(method, path, staff, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: hdr(staff),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function pass(id, ok, msg) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${msg}`);
  return ok;
}

(async () => {
  console.log(`\n=== Phase 17A user management @ ${BASE} ===\n`);
  const staff = await loginStaff();
  const username = `umverify_${TS}`;
  const email = `umverify-${TS}@verify.local`;

  let ok = true;
  const before = await api("GET", "/api/admin/users", staff);
  ok &= pass("1 list users", before.status === 200, `count=${before.json.users?.length ?? 0}`);

  const created = await api("POST", "/api/admin/users", staff, {
    username,
    name: `UM Verify ${TS}`,
    email,
    password: "VerifyPass123!",
    role: "Admin",
    accountStatus: "Approved",
  });
  const userId = created.json.user?.id;
  ok &= pass("2 create user", created.status === 201 && !!userId, userId || created.json.error);

  const afterCreate = await api("GET", "/api/admin/users", staff);
  const visible = (afterCreate.json.users || []).some((u) => u.id === userId);
  ok &= pass("3 user visible in list", visible, visible ? userId : "missing from GET /api/admin/users");

  const del = await api("DELETE", `/api/admin/users/${userId}`, staff, { confirmText: "DELETE" });
  ok &= pass("4 delete user", del.status === 200 && del.json.ok, del.json.message || del.json.error);

  const afterDelete = await api("GET", "/api/admin/users", staff);
  const gone = !(afterDelete.json.users || []).some((u) => u.id === userId);
  ok &= pass("5 user removed from list", gone, gone ? "removed" : "still present");

  const demos = await api("GET", "/api/admin/users/demo-seeds", staff);
  ok &= pass("6 demo seeds endpoint", demos.status === 200, `${demos.json.users?.length ?? 0} demo(s)`);

  console.log(`\n=== ${ok ? "ALL PASS" : "SOME FAILED"} ===\n`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
