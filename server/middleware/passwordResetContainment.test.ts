/**
 * P0 password-reset containment — tokens must never appear in API responses or auth email logs.
 */
import assert from "node:assert/strict";
import { requestPasswordReset, sendAuthEmail } from "../../userAuthDb.ts";

const savedUrl = process.env.SUPABASE_URL;
const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

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

const mockDb: any = {
  users: [
    {
      id: "u-reset-1",
      username: "demo.user",
      name: "Demo User",
      email: "demo.user@example.com",
      role: "Sales Executive",
      account_status: "Approved",
      password_hash: "x",
      email_verified: true,
    },
  ],
};

await test("forgot-password returns identical generic success without resetUrl/token for unknown email", async () => {
  const result = await requestPasswordReset("nobody@example.com", mockDb);
  assert.equal(result.ok, true);
  assert.match(String(result.message), /if that email exists/i);
  assert.equal((result as any).resetUrl, undefined);
  assert.equal((result as any).token, undefined);
  assert.equal((result as any).reset_token, undefined);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("reset-password"), false);
  assert.equal(serialized.includes("token="), false);
});

await test("forgot-password returns identical generic success without resetUrl/token for known email", async () => {
  const result = await requestPasswordReset("demo.user@example.com", mockDb);
  assert.equal(result.ok, true);
  assert.match(String(result.message), /if that email exists/i);
  assert.equal((result as any).resetUrl, undefined);
  assert.equal((result as any).token, undefined);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("token="), false);
  assert.equal(serialized.includes("resetUrl"), false);
  // Token should be stored server-side only
  assert.ok(mockDb.users[0].reset_token);
  assert.ok(String(mockDb.users[0].reset_token).length >= 16);
});

await test("sendAuthEmail never logs recipient address, token, or reset URL", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    const secretToken = "aabbccddeeff00112233445566778899";
    const resetUrl = `https://app.example/reset-password?token=${secretToken}`;
    await sendAuthEmail(
      "secret.user@example.com",
      "Reset your Sunchaser password",
      `<p>Reset password: <a href="${resetUrl}">${resetUrl}</a></p>`
    );
  } finally {
    console.log = original;
  }
  const joined = lines.join("\n");
  assert.equal(joined.includes("secret.user@example.com"), false);
  assert.equal(joined.includes("aabbccddeeff00112233445566778899"), false);
  assert.equal(joined.includes("reset-password?token="), false);
  assert.match(joined, /\[Auth Email\]/);
});

if (savedUrl) process.env.SUPABASE_URL = savedUrl;
else delete process.env.SUPABASE_URL;
if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
else delete process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log(`\nPassword reset containment tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
