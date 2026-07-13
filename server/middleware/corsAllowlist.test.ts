/**
 * P0 CORS allowlist tests — never reflect arbitrary origins.
 */
import assert from "node:assert/strict";
import {
  getAllowedCorsOrigins,
  isOriginAllowed,
  resolveCorsAllowOrigin,
} from "./corsAllowlist.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    failed += 1;
  }
}

test("env-driven allowlist includes configured CRM and local development origins", () => {
  const list = getAllowedCorsOrigins({
    CORS_ALLOWED_ORIGINS: "https://crm.example.com, https://app.example.com/",
    APP_URL: "https://app.example.com",
    VERCEL_URL: "my-app.vercel.app",
  } as NodeJS.ProcessEnv);
  assert.ok(list.includes("https://crm.example.com"));
  assert.ok(list.includes("https://app.example.com"));
  assert.ok(list.includes("https://my-app.vercel.app"));
  assert.ok(list.includes("http://localhost:3000"));
  assert.ok(list.includes("http://127.0.0.1:3000"));
});

test("unapproved origins are rejected and not reflected", () => {
  const allowlist = ["https://crm.example.com", "http://localhost:3000"];
  assert.equal(isOriginAllowed("https://evil.example", allowlist), false);
  const resolved = resolveCorsAllowOrigin("https://evil.example", allowlist);
  assert.equal(resolved.allowed, false);
  assert.equal(resolved.allowOrigin, null);
});

test("approved origin is echoed exactly once (allowlist only)", () => {
  const allowlist = ["https://crm.example.com"];
  const resolved = resolveCorsAllowOrigin("https://crm.example.com", allowlist);
  assert.equal(resolved.allowed, true);
  assert.equal(resolved.allowOrigin, "https://crm.example.com");
});

test("missing Origin is allowed without reflecting a wildcard with credentials", () => {
  const resolved = resolveCorsAllowOrigin(undefined, ["https://crm.example.com"]);
  assert.equal(resolved.allowed, true);
  assert.equal(resolved.allowOrigin, null);
});

console.log(`\nCORS allowlist tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
