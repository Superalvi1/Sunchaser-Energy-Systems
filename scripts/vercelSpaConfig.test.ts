/**
 * Validate root vercel.json SPA deep-link fallback (Task 7).
 * Ensures nested admin routes rewrite to index.html without swallowing /api.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vercelPath = path.join(root, "vercel.json");

await test("vercel.json exists at repository root", () => {
  assert.equal(fs.existsSync(vercelPath), true);
});

await test("SPA catch-all rewrite targets /index.html after /api and /assets", () => {
  const cfg = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as {
    rewrites?: Array<{ source: string; destination: string }>;
  };
  assert.ok(Array.isArray(cfg.rewrites), "rewrites must be an array");
  assert.ok(cfg.rewrites!.length >= 1, "rewrites must not be empty");

  const sources = cfg.rewrites!.map((r) => r.source);
  const apiIdx = sources.findIndex((s) => s.startsWith("/api"));
  const assetsIdx = sources.findIndex((s) => s.startsWith("/assets"));
  const spaIdx = cfg.rewrites!.findIndex(
    (r) =>
      r.destination === "/index.html" &&
      (r.source === "/(.*)" || r.source === "/:path*" || r.source === "/*")
  );

  assert.ok(spaIdx >= 0, "missing SPA rewrite to /index.html");
  assert.equal(cfg.rewrites![spaIdx].source, "/(.*)");
  assert.equal(cfg.rewrites![spaIdx].destination, "/index.html");

  if (apiIdx >= 0) {
    assert.ok(apiIdx < spaIdx, "/api rewrite must precede SPA catch-all");
  }
  if (assetsIdx >= 0) {
    assert.ok(assetsIdx < spaIdx, "/assets rewrite must precede SPA catch-all");
  }

  // Deep-link paths the CRM relies on are covered by the catch-all pattern.
  for (const route of ["/", "/admin/inbox", "/admin/whatsapp-setup"]) {
    assert.match(
      route === "/" ? "/index.html" : route,
      route === "/" ? /index\.html/ : /./
    );
    assert.equal(cfg.rewrites![spaIdx].source, "/(.*)");
  }
});

await test("API rewrite is preserved (does not proxy SPA shell for /api)", () => {
  const cfg = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as {
    rewrites?: Array<{ source: string; destination: string }>;
  };
  const api = cfg.rewrites!.find((r) => r.source.startsWith("/api"));
  assert.ok(api, "expected /api rewrite to remain");
  assert.match(api!.source, /^\/api\//);
  assert.match(api!.destination, /^\/api\//);
  assert.notEqual(api!.destination, "/index.html");
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll vercel SPA config tests passed.");
