/**
 * P0 password hash containment — plaintext fail-closed in production.
 */
import assert from "node:assert/strict";
import {
  hashPassword,
  isLegacyPlaintextPasswordAllowed,
  isScryptPasswordHash,
  verifyPassword,
} from "../../src/lib/passwordHash.ts";

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

test("valid s1 scrypt hashes authenticate", () => {
  const stored = hashPassword("CorrectHorseBattery");
  assert.equal(isScryptPasswordHash(stored), true);
  assert.equal(verifyPassword("CorrectHorseBattery", stored, { NODE_ENV: "production" }), true);
  assert.equal(verifyPassword("wrong-password", stored, { NODE_ENV: "production" }), false);
});

test("plaintext credentials fail in production even if legacy flag is set", () => {
  const plainStored = "legacy-plaintext-secret";
  assert.equal(
    verifyPassword(plainStored, plainStored, {
      NODE_ENV: "production",
      ALLOW_LEGACY_PLAINTEXT_PASSWORDS: "true",
    }),
    false
  );
  assert.equal(isLegacyPlaintextPasswordAllowed({ NODE_ENV: "production", ALLOW_LEGACY_PLAINTEXT_PASSWORDS: "true" }), false);
});

test("plaintext credentials fail by default outside production", () => {
  const plainStored = "legacy-plaintext-secret";
  assert.equal(
    verifyPassword(plainStored, plainStored, { NODE_ENV: "development" }),
    false
  );
  assert.equal(isLegacyPlaintextPasswordAllowed({ NODE_ENV: "development" }), false);
});

test("plaintext credentials only work with explicit non-production legacy flag", () => {
  const plainStored = "legacy-plaintext-secret";
  assert.equal(
    verifyPassword(plainStored, plainStored, {
      NODE_ENV: "development",
      ALLOW_LEGACY_PLAINTEXT_PASSWORDS: "true",
    }),
    true
  );
  assert.equal(
    verifyPassword("nope", plainStored, {
      NODE_ENV: "development",
      ALLOW_LEGACY_PLAINTEXT_PASSWORDS: "true",
    }),
    false
  );
});

test("verifyPassword and helpers never log password material", () => {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalErr = console.error;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const secret = "DoNotLogThisPasswordValue99";
    const stored = hashPassword(secret);
    verifyPassword(secret, stored, { NODE_ENV: "production" });
    verifyPassword(secret, secret, { NODE_ENV: "production" });
  } finally {
    console.log = originalLog;
    console.error = originalErr;
  }
  const joined = lines.join("\n");
  assert.equal(joined.includes("DoNotLogThisPasswordValue99"), false);
  assert.equal(joined.includes("s1:"), false);
});

console.log(`\nPassword hash containment tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
