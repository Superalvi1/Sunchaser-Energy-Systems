/**
 * P0 auth rate-limit + IP trust tests.
 */
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import {
  authSensitiveRateLimit,
  clientIp,
  resetRateLimitBucketsForTests,
} from "./rateLimit.ts";

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

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const state: { statusCode: number; body: any; headers: Record<string, string> } = {
    statusCode: 200,
    body: null,
    headers: {},
  };
  const res = {
    setHeader(k: string, v: string) {
      state.headers[k] = v;
      return res;
    },
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: any) {
      state.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, state };
}

await test("clientIp ignores X-Forwarded-For unless TRUST_PROXY is enabled", () => {
  delete process.env.TRUST_PROXY;
  const req = mockReq({
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    socket: { remoteAddress: "192.0.2.1" } as any,
  });
  assert.equal(clientIp(req), "192.0.2.1");

  process.env.TRUST_PROXY = "true";
  assert.equal(clientIp(req), "203.0.113.9");
  delete process.env.TRUST_PROXY;
});

await test("authSensitiveRateLimit returns 429 after max attempts", async () => {
  resetRateLimitBucketsForTests();
  process.env.AUTH_RATE_LIMIT_MAX = "3";
  process.env.AUTH_RATE_LIMIT_WINDOW_MS = "60000";

  let nextCount = 0;
  const next = () => {
    nextCount += 1;
  };

  for (let i = 0; i < 3; i++) {
    const { res } = mockRes();
    authSensitiveRateLimit(mockReq(), res, next);
  }
  assert.equal(nextCount, 3);

  const blocked = mockRes();
  authSensitiveRateLimit(mockReq(), blocked.res, next);
  assert.equal(blocked.state.statusCode, 429);
  assert.equal(nextCount, 3);
  assert.ok(blocked.state.headers["Retry-After"]);

  delete process.env.AUTH_RATE_LIMIT_MAX;
  delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;
  resetRateLimitBucketsForTests();
});

console.log(`\nAuth rate-limit tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
