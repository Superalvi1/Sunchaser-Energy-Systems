/**
 * Phase 1B.3B Wave 7A/7B/7C — route actor spoofing cleanup tests
 */
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { RequestActor } from "./actor.ts";
import {
  assertSuperAdminCleanup,
  readPortalAuth,
  readStaffAuth,
  resolveStaffActor,
} from "./staffActor.ts";
import { FinanceOwnershipResolver } from "../ownership/FinanceOwnershipResolver.ts";
import { StaffPortalAuthError, verifyStaffPortalUser } from "../../dbManager.ts";

const savedSupabaseUrl = process.env.SUPABASE_URL;
delete process.env.SUPABASE_URL;

const superAdminActor: RequestActor = {
  id: "u-super-1",
  username: "allauddin",
  name: "Allauddin",
  email: "allauddin@test.com",
  role: "Super Admin",
  accountStatus: "Approved",
  emailVerified: true,
  onboardingCompleted: true,
  authMethod: "jwt",
};

const salesActor: RequestActor = {
  ...superAdminActor,
  id: "u-sales-1",
  username: "sarah",
  name: "Sarah",
  role: "Sales Executive",
};

function mockReq(overrides: {
  actor?: RequestActor;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}): Request {
  return {
    headers: overrides.headers || {},
    body: overrides.body || {},
    query: overrides.query || {},
    actor: overrides.actor,
  } as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  let statusCode = 200;
  let body: unknown = null;
  return {
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as Response & { statusCode: number; body: unknown };
}

function assertStaffRouteRejectsSpoof(
  name: string,
  req: Request,
  expectedStatus = 401
): void {
  const res = mockRes();
  assert.equal(resolveStaffActor(req, res), null, `${name}: expected null staff actor`);
  assert.equal(res.statusCode, expectedStatus, `${name}: expected HTTP ${expectedStatus}`);
}

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

await test("body.role cannot spoof staff actor", () => {
  const req = mockReq({
    body: { userId: "u-spoof", username: "spoof", role: "Super Admin" },
    headers: {
      "x-sunchaser-user-id": "u-header",
      "x-sunchaser-username": "headeruser",
      "x-sunchaser-role": "Super Admin",
    },
  });
  const auth = readStaffAuth(req);
  assert.equal(auth.userId, "");
  assert.equal(auth.username, "");
  assert.equal(auth.role, "");
});

await test("readStaffAuth uses req.actor when present", () => {
  const req = mockReq({
    actor: salesActor,
    body: { role: "Super Admin", userId: "u-spoof", username: "spoof" },
  });
  const auth = readStaffAuth(req);
  assert.equal(auth.userId, "u-sales-1");
  assert.equal(auth.username, "sarah");
  assert.equal(auth.role, "Sales Executive");
});

await test("query.userId cannot spoof portal actor", () => {
  const req = mockReq({
    query: { userId: "u-spoof", username: "spoofuser" },
    body: { userId: "u-body", username: "bodyuser" },
    headers: {
      "x-sunchaser-user-id": "u-header",
      "x-sunchaser-username": "headeruser",
    },
  });
  const auth = readPortalAuth(req);
  assert.equal(auth.userId, "");
  assert.equal(auth.username, "");
});

await test("readPortalAuth uses req.actor when present", () => {
  const req = mockReq({
    actor: superAdminActor,
    query: { userId: "u-spoof", username: "spoof" },
  });
  const auth = readPortalAuth(req);
  assert.equal(auth.userId, "u-super-1");
  assert.equal(auth.username, "allauddin");
});

await test("maintenance cleanup requires req.actor Super Admin", () => {
  assert.throws(
    () => assertSuperAdminCleanup(mockReq({})),
    (err: unknown) => err instanceof StaffPortalAuthError && err.statusCode === 403
  );
  assert.throws(
    () => assertSuperAdminCleanup(mockReq({ actor: salesActor })),
    (err: unknown) => err instanceof StaffPortalAuthError && err.statusCode === 403
  );
  assert.doesNotThrow(() => assertSuperAdminCleanup(mockReq({ actor: superAdminActor })));
});

await test("non-Super Admin with X-Sunchaser-Role header cannot pass cleanup", () => {
  assert.throws(
    () =>
      assertSuperAdminCleanup(
        mockReq({
          headers: {
            "x-sunchaser-role": "Super Admin",
            "x-sunchaser-username": "allauddin",
            "x-sunchaser-user-id": "u-super-1",
          },
        })
      ),
    (err: unknown) => err instanceof StaffPortalAuthError && err.statusCode === 403
  );
});

await test("project stage sync requires actor", () => {
  const withoutActor = readStaffAuth(
    mockReq({
      body: { userId: "u-allauddin", username: "allauddin", role: "Super Admin" },
      headers: {
        "x-sunchaser-user-id": "u-allauddin",
        "x-sunchaser-username": "allauddin",
        "x-sunchaser-role": "Super Admin",
      },
    })
  );
  assert.equal(withoutActor.userId, "");
  assert.equal(withoutActor.username, "");

  const withActor = readStaffAuth(mockReq({ actor: superAdminActor }));
  assert.equal(withActor.userId, "u-super-1");
  assert.equal(withActor.username, "allauddin");
});

const staffRoleDb = {
  users: [
    { id: "u-am", username: "amir", role: "Accounts Manager", name: "Amir" },
    { id: "u-dir", username: "director", role: "Director", name: "Dana" },
    { id: "u-tech", username: "tariq", role: "Technician", name: "Tariq" },
  ],
} as any;

await test("Accounts Manager accepted as staff portal role", async () => {
  const { role } = await verifyStaffPortalUser("u-am", "amir", staffRoleDb);
  assert.equal(role, "Accounts Manager");
});

await test("Director accepted as staff portal role", async () => {
  const { role } = await verifyStaffPortalUser("u-dir", "director", staffRoleDb);
  assert.equal(role, "Director");
});

await test("Technician still rejected from staff portal tools", async () => {
  await assert.rejects(
    () => verifyStaffPortalUser("u-tech", "tariq", staffRoleDb),
    (err: unknown) => err instanceof StaffPortalAuthError
  );
});

await test("party ledger route rejects body.role spoof", () => {
  assertStaffRouteRejectsSpoof(
    "party ledger",
    mockReq({
      body: { userId: "u-spoof", username: "spoof", role: "Super Admin" },
    })
  );
});

await test("finance dashboard rejects x-sunchaser-role spoof", () => {
  assertStaffRouteRejectsSpoof(
    "finance dashboard",
    mockReq({
      headers: {
        "x-sunchaser-user-id": "u-super-1",
        "x-sunchaser-username": "allauddin",
        "x-sunchaser-role": "Super Admin",
      },
    })
  );
});

await test("costing route rejects body.role spoof", () => {
  assertStaffRouteRejectsSpoof(
    "costing",
    mockReq({
      body: { userId: "u-spoof", username: "spoof", role: "Super Admin" },
      headers: { "x-sunchaser-role": "Super Admin" },
    })
  );
});

await test("delivery CRUD rejects x-sunchaser-role spoof", () => {
  assertStaffRouteRejectsSpoof(
    "delivery CRUD",
    mockReq({
      headers: {
        "x-sunchaser-user-id": "u-super-1",
        "x-sunchaser-username": "allauddin",
        "x-sunchaser-role": "Super Admin",
      },
      body: { role: "Super Admin" },
    })
  );
});

await test("invoice archive/delete rejects body.role spoof", () => {
  assertStaffRouteRejectsSpoof(
    "invoice archive",
    mockReq({
      body: { userId: "u-spoof", username: "spoof", role: "Super Admin" },
    })
  );
  assertStaffRouteRejectsSpoof(
    "invoice delete",
    mockReq({
      body: { userId: "u-spoof", username: "spoof", role: "Super Admin", confirm: true },
    })
  );
});

await test("resolveStaffActor actor path still succeeds for valid staff", () => {
  const req = mockReq({
    actor: superAdminActor,
    body: { userId: "u-spoof", username: "spoof", role: "Sales Executive" },
    headers: {
      "x-sunchaser-user-id": "u-spoof",
      "x-sunchaser-username": "spoof",
      "x-sunchaser-role": "Sales Executive",
    },
  });
  const res = mockRes();
  const staff = resolveStaffActor(req, res);
  assert.ok(staff);
  assert.equal(staff.id, "u-super-1");
  assert.equal(staff.username, "allauddin");
  assert.equal(staff.role, "Super Admin");
  assert.equal(res.statusCode, 200);
});

await test("query.userId/query.username cannot spoof portal actor", () => {
  assertStaffRouteRejectsSpoof(
    "portal query spoof",
    mockReq({
      query: { userId: "u-spoof", username: "spoofuser" },
      body: { userId: "u-body", username: "bodyuser" },
    })
  );
});

await test("finance routes use req.actor only via resolveStaffActor", () => {
  assertStaffRouteRejectsSpoof(
    "finance summary",
    mockReq({
      headers: { "x-sunchaser-role": "Super Admin", "x-sunchaser-user-id": "u-spoof" },
      body: { role: "Super Admin" },
    })
  );
});

await test("username-based Super Admin security checks removed from isSuperAdmin", async () => {
  const { isSuperAdmin } = await import("../../src/lib/roles.ts");
  assert.equal(isSuperAdmin("allauddin", "Sales Executive"), false);
  assert.equal(isSuperAdmin("random", "Super Admin"), true);
});

await test("FinanceOwnershipResolver remains invoice route access source of truth", () => {
  assert.throws(
    () => FinanceOwnershipResolver.assertInvoiceStaffRouteAccess(undefined),
    (err: unknown) => err instanceof Error && err.name === "FinanceOwnershipError"
  );
  assert.doesNotThrow(() => FinanceOwnershipResolver.assertInvoiceStaffRouteAccess(superAdminActor));
});

if (savedSupabaseUrl) process.env.SUPABASE_URL = savedSupabaseUrl;
else delete process.env.SUPABASE_URL;

console.log(`\nPhase 1B.3B Wave 7A/7B/7C route auth tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
