/**
 * Phase 1B.1 authorization tests — run: npm run test:phase-1b1
 */
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { signAccessToken } from "../auth/jwt.ts";
import {
  hydrateActorFromJwt,
  hydrateActorFromLegacyHeaders,
  isLegacyHeaderAuthEnabled,
  readLegacyHeaderIdentity,
} from "./actor.ts";
import { isPublicApiRoute } from "./publicRoutes.ts";
import {
  isJwtOnlyRoute,
  isMigratedProtectedRoute,
  isProtectedApiRoute,
  resolveRouteAccessPolicy,
} from "./routePolicy.ts";
import { isCustomerAllowedApiRoute } from "./customerRoutePolicy.ts";
import { createAuthorizationMiddleware } from "./authorization.ts";

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-1b1-test-secret-min-32-chars";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
const savedSupabaseUrl = process.env.SUPABASE_URL;
const savedSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

type MockUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  account_status: string;
  customerId?: string;
};

const mockDb = {
  users: [
    {
      id: "u-active",
      username: "activeuser",
      name: "Active User",
      email: "active@test.com",
      role: "Super Admin",
      account_status: "Approved",
    },
    {
      id: "u-suspended",
      username: "suspended",
      name: "Suspended User",
      email: "suspended@test.com",
      role: "Sales Executive",
      account_status: "Suspended",
    },
    {
      id: "u-customer",
      username: "portaluser",
      name: "Portal User",
      email: "shared@test.com",
      role: "Customer",
      account_status: "Approved",
      customerId: "cust-1",
    },
  ] as MockUser[],
};

function mockReq(overrides: Partial<Request> & { headers?: Record<string, string> } = {}): Request {
  return {
    method: "GET",
    path: "/api/state",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: unknown };
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

await test("public route allowlist includes login and health", () => {
  assert.equal(isPublicApiRoute("POST", "/api/auth/login"), true);
  assert.equal(isPublicApiRoute("GET", "/health"), true);
  assert.equal(isPublicApiRoute("GET", "/api/state"), false);
});

await test("non-public /api routes are protected by default", () => {
  assert.equal(isProtectedApiRoute("GET", "/api/leads"), true);
  assert.equal(isProtectedApiRoute("GET", "/api/unknown-route"), true);
  assert.equal(resolveRouteAccessPolicy("GET", "/api/leads").kind, "protected");
});

await test("jwt-only routes match Phase 1A scope", () => {
  assert.equal(isJwtOnlyRoute("/api/state"), true);
  assert.equal(isMigratedProtectedRoute("/api/diagnostics/db"), true);
  assert.equal(isMigratedProtectedRoute("/api/debug/pdf-engine"), true);
  assert.equal(isJwtOnlyRoute("/api/leads"), false);
});

await test("req.actor hydration from JWT uses database role not token role", async () => {
  const token = signAccessToken({
    userId: "u-active",
    username: "activeuser",
    role: "Fake Role From Token",
  });
  const result = await hydrateActorFromJwt(token, mockDb as never);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.actor.role, "Super Admin");
    assert.equal(result.actor.authMethod, "jwt");
  }
});

await test("disabled users return 403 on hydration", async () => {
  const token = signAccessToken({
    userId: "u-suspended",
    username: "suspended",
    role: "Sales Executive",
  });
  const result = await hydrateActorFromJwt(token, mockDb as never);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
    assert.equal(result.reason, "account_inactive");
  }
});

await test("invalid JWT is rejected", async () => {
  const bad = jwt.sign({ userId: "u-active", username: "activeuser" }, "wrong-secret", {
    expiresIn: "1h",
  });
  const result = await hydrateActorFromJwt(bad, mockDb as never);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_jwt");
});

await test("LEGACY_HEADER_AUTH=false: protected route rejects header-only access", async () => {
  delete process.env.LEGACY_HEADER_AUTH;
  assert.equal(isLegacyHeaderAuthEnabled(), false);

  const middleware = createAuthorizationMiddleware({
    resolveLocalDb: () => mockDb as never,
  });
  const req = mockReq({
    path: "/api/leads",
    headers: {
      "x-sunchaser-user-id": "u-active",
      "x-sunchaser-username": "activeuser",
      "x-sunchaser-role": "Super Admin",
    },
  });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(req.actor, undefined);
});

await test("LEGACY_HEADER_AUTH=true: protected route accepts audited legacy headers", async () => {
  process.env.LEGACY_HEADER_AUTH = "true";
  const req = mockReq({
    path: "/api/leads",
    headers: {
      "x-sunchaser-user-id": "u-active",
      "x-sunchaser-username": "activeuser",
      "x-sunchaser-role": "Spoofed Role",
    },
  });
  assert.ok(readLegacyHeaderIdentity(req));
  const result = await hydrateActorFromLegacyHeaders(req, mockDb as never);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.actor.role, "Super Admin");
    assert.equal(result.actor.authMethod, "legacy_header");
  }

  const middleware = createAuthorizationMiddleware({
    resolveLocalDb: () => mockDb as never,
  });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.actor?.username, "activeuser");
  delete process.env.LEGACY_HEADER_AUTH;
});

await test("jwt-only route returns 401 without token", async () => {
  const middleware = createAuthorizationMiddleware({
    resolveLocalDb: () => mockDb as never,
  });
  const req = mockReq({ path: "/api/state", headers: {} });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

await test("jwt-only route rejects legacy headers even when LEGACY_HEADER_AUTH=true", async () => {
  process.env.LEGACY_HEADER_AUTH = "true";
  const middleware = createAuthorizationMiddleware({
    resolveLocalDb: () => mockDb as never,
  });
  const req = mockReq({
    path: "/api/state",
    headers: {
      "x-sunchaser-user-id": "u-active",
      "x-sunchaser-username": "activeuser",
      "x-sunchaser-role": "Super Admin",
    },
  });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  delete process.env.LEGACY_HEADER_AUTH;
});

await test("jwt-only route sets req.actor with valid JWT", async () => {
  const middleware = createAuthorizationMiddleware({
    resolveLocalDb: () => mockDb as never,
  });
  const token = signAccessToken({
    userId: "u-active",
    username: "activeuser",
    role: "ignored",
  });
  const req = mockReq({
    path: "/api/state",
    headers: { authorization: `Bearer ${token}` },
  });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.actor?.username, "activeuser");
  assert.equal(req.actor?.role, "Super Admin");
});

await test("unknown /api route fails closed without credentials", async () => {
  delete process.env.LEGACY_HEADER_AUTH;
  const middleware = createAuthorizationMiddleware({
    resolveLocalDb: () => mockDb as never,
  });
  const req = mockReq({ path: "/api/__unknown_phase1b1__", headers: {} });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

await test("customer allowed routes include portal and owned invoice PDF", () => {
  assert.equal(isCustomerAllowedApiRoute("/api/customer-portal/me"), true);
  assert.equal(isCustomerAllowedApiRoute("/api/auth/me"), true);
  assert.equal(isCustomerAllowedApiRoute("/api/export/pdf/invoice/inv-1"), true);
  assert.equal(isCustomerAllowedApiRoute("/api/admin/users"), false);
});

await test("customer JWT blocked from staff admin routes", async () => {
  const middleware = createAuthorizationMiddleware({
    resolveLocalDb: () => mockDb as never,
  });
  const token = signAccessToken({
    userId: "u-customer",
    username: "portaluser",
    role: "Customer",
  });
  const req = mockReq({
    path: "/api/admin/users",
    headers: { authorization: `Bearer ${token}` },
  });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Not authorized for staff routes." });
});

await test("customer JWT allowed on customer-portal routes", async () => {
  const middleware = createAuthorizationMiddleware({
    resolveLocalDb: () => mockDb as never,
  });
  const token = signAccessToken({
    userId: "u-customer",
    username: "portaluser",
    role: "Customer",
  });
  const req = mockReq({
    path: "/api/customer-portal/invoices/me",
    headers: { authorization: `Bearer ${token}` },
  });
  const res = mockRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.actor?.role, "Customer");
  assert.equal(req.actor?.customerId, "cust-1");
});

console.log(`\nPhase 1B.1 tests: ${passed} passed, ${failed} failed`);
if (savedSupabaseUrl) process.env.SUPABASE_URL = savedSupabaseUrl;
else delete process.env.SUPABASE_URL;
if (savedSupabaseKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedSupabaseKey;
else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.exit(failed > 0 ? 1 : 0);
