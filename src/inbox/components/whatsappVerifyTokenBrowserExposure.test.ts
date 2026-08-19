/**
 * Contract tests: WHATSAPP_WEBHOOK_VERIFY_TOKEN must never be exposed in the browser UI.
 * Run via: npm run test:whatsapp-inbox-ui
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));

function readComponent(name: string): string {
  return fs.readFileSync(path.join(here, name), "utf8");
}

await test("setup page does not render or copy the verify token secret", () => {
  const src = readComponent("WhatsAppSetupPage.tsx");
  assert.equal(src.includes("webhookVerifyTokenConfigured"), true);
  assert.equal(/\bwebhookVerifyToken\b/.test(src), false);
  assert.equal(src.includes("Copy token"), false);
  assert.equal(src.includes("markCopied(\"token\")"), false);
  assert.equal(
    /diagnostics\.webhookVerifyToken(?!Configured)/.test(src),
    false
  );
  assert.match(
    src,
    /Copy the value directly from Render environment variable/
  );
  assert.match(src, /WHATSAPP_WEBHOOK_VERIFY_TOKEN into Meta/);
  assert.match(src, /webhookVerifyTokenConfigured \? "Yes" : "No"/);
  assert.match(src, /Copy URL/);
  assert.match(src, /webhookCallbackUrl/);
});

await test("connection panel does not retain or display the verify token secret", () => {
  const src = readComponent("WhatsAppConnectionPanel.tsx");
  assert.equal(/\bwebhookVerifyToken\b/.test(src), false);
  assert.equal(/\bverifyToken\b/.test(src), false);
  assert.equal(src.includes("setVerifyToken"), false);
  assert.equal(src.includes("Verify Token"), false);
  assert.match(src, /webhookCallbackUrl/);
  assert.match(src, /Webhook callback URL/);
});

await test("setup page shows Meta Business Diagnostics without secrets", () => {
  const src = readComponent("WhatsAppSetupPage.tsx");
  assert.match(src, /Meta Business Diagnostics/);
  assert.match(
    src,
    /Sunchaser CRM uses/
  );
  assert.match(src, /business_management/);
  assert.match(src, /data-testid="meta-business-diagnostics"/);
  assert.equal(src.includes("accessToken"), false);
  assert.equal(src.includes("appSecret"), false);
  assert.equal(src.includes("system-user"), false);
  assert.equal(/\baccess_token\b/.test(src), false);
});

await test("inbox types expose configured flag only, never the secret field", () => {
  const types = fs.readFileSync(
    path.join(here, "..", "types.ts"),
    "utf8"
  );
  const diagBlock = types.slice(
    types.indexOf("export type WhatsAppOnboardingDiagnostics"),
    types.indexOf("export type WhatsAppConnectionTestResult")
  );
  assert.match(diagBlock, /webhookVerifyTokenConfigured:\s*boolean/);
  assert.equal(/\bwebhookVerifyToken:\s*/.test(diagBlock), false);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp verify-token browser exposure tests passed.");
