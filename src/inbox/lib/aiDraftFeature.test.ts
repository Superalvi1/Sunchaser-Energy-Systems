/**
 * AI-03 client feature flag + privacy invariants.
 * Run: npm run test:whatsapp-ai-draft
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAiDraftUiEnabled } from "./aiDraftFeature.ts";

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
const inboxRoot = join(here, "..");

await test("feature disabled by default", () => {
  assert.equal(isAiDraftUiEnabled({}), false);
  assert.equal(
    isAiDraftUiEnabled({ VITE_WHATSAPP_AI_QUERY_DRAFT_ENABLED: "" }),
    false
  );
  assert.equal(
    isAiDraftUiEnabled({ VITE_WHATSAPP_AI_QUERY_DRAFT_ENABLED: "false" }),
    false
  );
});

await test("feature enabled only when explicitly true", () => {
  assert.equal(
    isAiDraftUiEnabled({ VITE_WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true" }),
    true
  );
});

await test("no persistent-browser PII for drafts (localStorage/sessionStorage)", () => {
  const files = [
    join(inboxRoot, "hooks/useAiDraft.ts"),
    join(inboxRoot, "components/AiDraftPanel.tsx"),
    join(inboxRoot, "components/ConversationView.tsx"),
    join(inboxRoot, "api/inboxApi.ts"),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Flag real API usage only (comments may mention the forbidden APIs).
    assert.equal(
      /\b(?:localStorage|sessionStorage)\s*\./.test(source),
      false,
      `${file} must not touch browser storage for drafts`
    );
  }
});

await test("ConversationView does not auto-generate on open", () => {
  const source = readFileSync(
    join(inboxRoot, "components/ConversationView.tsx"),
    "utf8"
  );
  // Generate only via explicit handlers — no useEffect calling generate.
  const effects = [...source.matchAll(/useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\},/g)];
  for (const match of effects) {
    const body = match[1] ?? "";
    assert.equal(
      /aiDraft\.generate|runGenerate\s*\(/.test(body),
      false,
      "useEffect must not auto-generate drafts"
    );
  }
  assert.ok(source.includes("onGenerate={runGenerate}"));
});

await test("copy-to-composer never calls onSend", () => {
  const source = readFileSync(
    join(inboxRoot, "components/ConversationView.tsx"),
    "utf8"
  );
  const copyBlock = source.slice(
    source.indexOf("onCopyToComposer"),
    source.indexOf("onCopyToComposer") + 350
  );
  assert.equal(/onSend\(/.test(copyBlock), false);
  assert.ok(copyBlock.includes("setComposerSeed"));
});

if (failed > 0) {
  console.error(`\n${failed} ai-draft feature test(s) failed`);
  process.exit(1);
}
console.log("\nAll ai-draft feature tests passed");
