/**
 * AI-03 panel accessibility + mobile layout invariants (source-level).
 * Run: npm run test:whatsapp-ai-draft
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "AiDraftPanel.tsx"), "utf8");
const view = readFileSync(join(here, "ConversationView.tsx"), "utf8");
const composer = readFileSync(join(here, "Composer.tsx"), "utf8");

await test("panel exposes accessible labels and busy state", () => {
  assert.ok(panel.includes('aria-label="AI Reply Assistant"'));
  assert.ok(panel.includes("Generate AI Draft"));
  assert.ok(panel.includes("aria-busy"));
  assert.ok(panel.includes("Editable AI draft — human review required"));
  assert.ok(panel.includes("Copy draft to composer"));
  assert.ok(panel.includes("Discard AI draft"));
  assert.ok(panel.includes("Regenerate AI draft"));
});

await test("human-review label and escalation/confidence display present", () => {
  assert.ok(panel.includes("human review required"));
  assert.ok(panel.includes("Confidence:"));
  assert.ok(panel.includes("Escalation suggested"));
  assert.ok(panel.includes("never auto-sends"));
});

await test("mobile layout remains usable (touch targets + wrap)", () => {
  assert.ok(panel.includes("flex-wrap"));
  assert.ok(panel.includes("min-h-10") || panel.includes("min-h-9"));
  assert.ok(panel.includes("w-full"));
  // Inbox page already toggles list/thread panes; panel must not force fixed width.
  assert.equal(/w-\[(3|4|5)\d{2}px\]/.test(panel), false);
});

await test("Send remains a separate Composer action", () => {
  assert.ok(composer.includes('aria-label={sending ? "Sending message" : "Send message"}'));
  assert.ok(composer.includes("Send"));
  assert.equal(/Generate AI Draft/.test(composer), false);
  assert.ok(view.includes("<Composer"));
  assert.ok(view.includes("onSend={onSend}"));
});

await test("AI Reply Assistant always mounts for selected conversation", () => {
  assert.ok(view.includes("isAiDraftUiEnabled"));
  assert.ok(view.includes("<AiDraftPanel"));
  assert.ok(view.includes("canGenerateDraft"));
  assert.ok(view.includes("AI Reply Assistant") || panel.includes("AI Reply Assistant"));
});

if (failed > 0) {
  console.error(`\n${failed} ai-draft layout test(s) failed`);
  process.exit(1);
}
console.log("\nAll ai-draft layout tests passed");
