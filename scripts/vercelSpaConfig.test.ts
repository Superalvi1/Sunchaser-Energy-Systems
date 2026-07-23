/**
 * Validate root vercel.json SPA deep-link fallback.
 * Ensures nested admin routes rewrite to index.html without swallowing /api or /assets.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Rewrite = { source: string; destination: string };

type VercelConfig = {
  rewrites?: Rewrite[];
};

const EXPECTED_API_SOURCE = "/api/:path*";
const EXPECTED_API_DESTINATION = "/api/:path*";
const EXPECTED_ASSETS_SOURCE = "/assets/:path*";
const EXPECTED_ASSETS_DESTINATION = "/assets/:path*";
const EXPECTED_SPA_SOURCE = "/(.*)";
const EXPECTED_SPA_DESTINATION = "/index.html";

let failed = 0;

async function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

/**
 * Shared assertions used for both live vercel.json and negative fixtures.
 */
function assertSpaRewriteProtection(cfg: VercelConfig): void {
  assert.ok(Array.isArray(cfg.rewrites), "rewrites must be an array");
  assert.ok(cfg.rewrites!.length >= 1, "rewrites must not be empty");

  const rewrites = cfg.rewrites!;
  const apiIdx = rewrites.findIndex((r) => r.source.startsWith("/api"));
  const assetsIdx = rewrites.findIndex((r) => r.source.startsWith("/assets"));
  const spaIdx = rewrites.findIndex(
    (r) =>
      r.source === EXPECTED_SPA_SOURCE &&
      r.destination === EXPECTED_SPA_DESTINATION
  );

  assert.ok(apiIdx >= 0, "expected /api rewrite to exist");
  assert.equal(rewrites[apiIdx].source, EXPECTED_API_SOURCE);
  assert.equal(rewrites[apiIdx].destination, EXPECTED_API_DESTINATION);
  assert.notEqual(rewrites[apiIdx].destination, EXPECTED_SPA_DESTINATION);

  assert.ok(assetsIdx >= 0, "expected /assets rewrite to exist");
  assert.equal(rewrites[assetsIdx].source, EXPECTED_ASSETS_SOURCE);
  assert.equal(rewrites[assetsIdx].destination, EXPECTED_ASSETS_DESTINATION);
  assert.notEqual(rewrites[assetsIdx].destination, EXPECTED_SPA_DESTINATION);
  assert.match(rewrites[assetsIdx].destination, /^\/assets\//);

  assert.ok(spaIdx >= 0, "missing SPA rewrite to /index.html");
  assert.equal(rewrites[spaIdx].source, EXPECTED_SPA_SOURCE);
  assert.equal(rewrites[spaIdx].destination, EXPECTED_SPA_DESTINATION);

  assert.ok(apiIdx < spaIdx, "/api rewrite must precede SPA catch-all");
  assert.ok(assetsIdx < spaIdx, "/assets rewrite must precede SPA catch-all");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vercelPath = path.join(root, "vercel.json");

await test("vercel.json exists at repository root", () => {
  assert.equal(fs.existsSync(vercelPath), true);
});

await test("live vercel.json protects /api and /assets from SPA fallback", () => {
  const cfg = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as VercelConfig;
  assertSpaRewriteProtection(cfg);
});

await test("SPA catch-all remains exactly /(.*) → /index.html", () => {
  const cfg = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as VercelConfig;
  const spa = cfg.rewrites!.find(
    (r) =>
      r.source === EXPECTED_SPA_SOURCE || r.destination === EXPECTED_SPA_DESTINATION
  );
  assert.ok(spa, "SPA rewrite missing");
  assert.equal(spa!.source, EXPECTED_SPA_SOURCE);
  assert.equal(spa!.destination, EXPECTED_SPA_DESTINATION);
});

await test("negative: /assets/:path* → /index.html fails validation", () => {
  const broken: VercelConfig = {
    rewrites: [
      { source: EXPECTED_API_SOURCE, destination: EXPECTED_API_DESTINATION },
      {
        source: EXPECTED_ASSETS_SOURCE,
        destination: EXPECTED_SPA_DESTINATION,
      },
      {
        source: EXPECTED_SPA_SOURCE,
        destination: EXPECTED_SPA_DESTINATION,
      },
    ],
  };

  assert.throws(
    () => assertSpaRewriteProtection(broken),
    (err: unknown) =>
      err instanceof assert.AssertionError &&
      // Broken fixture deliberately points assets at the SPA shell.
      broken.rewrites![1].destination === EXPECTED_SPA_DESTINATION
  );
});

await test("negative: missing /assets rewrite fails validation", () => {
  const broken: VercelConfig = {
    rewrites: [
      { source: EXPECTED_API_SOURCE, destination: EXPECTED_API_DESTINATION },
      {
        source: EXPECTED_SPA_SOURCE,
        destination: EXPECTED_SPA_DESTINATION,
      },
    ],
  };
  assert.throws(() => assertSpaRewriteProtection(broken));
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll vercel SPA config tests passed.");
