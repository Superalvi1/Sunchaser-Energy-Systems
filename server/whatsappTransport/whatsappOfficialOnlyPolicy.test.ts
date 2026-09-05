/**
 * POLICY GUARD — Sunchaser CRM uses the OFFICIAL Meta WhatsApp Cloud API only.
 *
 * Unofficial WhatsApp Web / QR-session automation libraries are prohibited:
 * they violate WhatsApp's Terms of Service, risk the business number being
 * banned, and pair a linked device against the owner's WhatsApp account.
 *
 * This test fails if any prohibited library, QR pairing endpoint, or the
 * removed connector directory is reintroduced.
 *
 * Deterministic repository scan — no network, no runtime dependency.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

/** Package names that must never appear in dependencies. */
const PROHIBITED_PACKAGES = [
  "@whiskeysockets/baileys",
  "baileys",
  "whatsapp-web.js",
  "wppconnect",
  "@wppconnect-team/wppconnect",
  "venom-bot",
  "@open-wa/wa-automate",
];

/** Source substrings that indicate an unofficial WhatsApp Web integration. */
const PROHIBITED_SOURCE_MARKERS = [
  "@whiskeysockets/baileys",
  "whatsapp-web.js",
  "wppconnect",
  "useMultiFileAuthState",
  "makeWASocket",
  "fetchLatestBaileysVersion",
];

/** QR pairing HTTP surfaces that must not exist. */
const PROHIBITED_ROUTE_MARKERS = [
  "/api/whatsapp-web",
  "createWhatsAppWebRouter",
  "getSharedWhatsAppWebSession",
  "persistWhatsAppWebInbound",
  "sendWhatsAppWebPlainText",
  "WHATSAPP_WEB_QR_ENABLED",
  "WHATSAPP_WEB_AUTH_DIR",
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "android",
  "ios",
  "backups",
  "scratch",
  "sunchaser-crm",
  "node-env",
]);

/**
 * Files that legitimately name the prohibited strings because they assert their
 * ABSENCE. Kept to an explicit, minimal allowlist.
 */
const POLICY_ASSERTION_FILES = new Set(
  [
    path.resolve(here, "whatsappOfficialOnlyPolicy.test.ts"),
    path.resolve(here, "whatsappInboxProductionWiring.test.ts"),
    path.resolve(here, "../unifiedMessaging/transportContract.test.ts"),
  ].map((f) => path.normalize(f))
);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

await test("package.json declares no unofficial WhatsApp library", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };
  for (const banned of PROHIBITED_PACKAGES) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(allDeps, banned),
      false,
      `package.json must not depend on "${banned}" — Sunchaser uses the official Meta Cloud API only`
    );
  }
});

await test("no source file imports or uses an unofficial WhatsApp Web library", () => {
  const files = collectSourceFiles(repoRoot).filter((f) => !POLICY_ASSERTION_FILES.has(path.normalize(f)));
  assert.ok(files.length > 100, "expected to scan a meaningful number of files");
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const marker of PROHIBITED_SOURCE_MARKERS) {
      assert.equal(
        source.includes(marker),
        false,
        `${path.relative(repoRoot, file)} references prohibited WhatsApp Web marker "${marker}"`
      );
    }
  }
});

await test("no executable QR pairing endpoint or connector wiring remains", () => {
  const files = collectSourceFiles(repoRoot).filter((f) => !POLICY_ASSERTION_FILES.has(path.normalize(f)));
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const marker of PROHIBITED_ROUTE_MARKERS) {
      assert.equal(
        source.includes(marker),
        false,
        `${path.relative(repoRoot, file)} references removed WhatsApp Web surface "${marker}"`
      );
    }
  }
});

await test("the unofficial connector directory does not exist", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, "server/whatsappWeb")),
    false,
    "server/whatsappWeb/ must not be reintroduced"
  );
});

await test("official Meta Cloud API stack is still present", () => {
  const required = [
    "server/whatsappTransport/whatsappWebhookRoutes.ts",
    "server/whatsappTransport/whatsappGraphClient.ts",
    "server/whatsappTransport/whatsappConnectionService.ts",
    "server/whatsappTransport/whatsappTokenCrypto.ts",
    "server/whatsappTransport/whatsappInboxRoutes.ts",
    "server/whatsappTransport/whatsappInboxSendTransport.ts",
    "src/inbox/lib/metaEmbeddedSignup.ts",
  ];
  for (const rel of required) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, rel)),
      `official Meta stack file missing: ${rel}`
    );
  }
  const server = fs.readFileSync(path.join(repoRoot, "server.ts"), "utf8");
  assert.ok(
    server.includes("createWhatsAppWebhookRouter"),
    "official Meta webhook router must remain mounted"
  );
  assert.ok(
    server.includes('"/api/inbox"') && server.includes("createWhatsAppInboxRouter"),
    "official CRM inbox routes must remain mounted"
  );
});

if (failed > 0) {
  console.error(`\n${failed} WhatsApp official-only policy test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp official-only policy tests passed");
