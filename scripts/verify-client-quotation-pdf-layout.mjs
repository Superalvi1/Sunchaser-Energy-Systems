#!/usr/bin/env node
/**
 * Verify client quotation PDF layout (Dr Abdullah 8kW manual quote).
 * Usage: node scripts/verify-client-quotation-pdf-layout.mjs [baseUrl]
 */
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE = process.argv[2] || process.env.API_BASE_URL || "http://localhost:3000";
const LEAD_ID = process.env.LEAD_ID || "lead-daae923a-a996-4d38-9678-346b582da906";
const QUOTE_ID = process.env.QUOTE_ID || "q-84a262e6-61f7-472b-b3a6-35d71ddcf020";

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  const q = `?quoteId=${encodeURIComponent(QUOTE_ID)}`;
  const downloadUrl = `${BASE}/api/export/pdf/manual-quote/${encodeURIComponent(LEAD_ID)}/download${q}`;
  const debugUrl = `${BASE}/api/export/pdf/manual-quote/${encodeURIComponent(LEAD_ID)}/debug-html${q}`;

  console.log("\n1) PDF download endpoint");
  let res;
  let buf = Buffer.alloc(0);
  try {
    res = await fetch(downloadUrl);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.log("  (skipped live PDF — server unreachable)");
    res = { status: 0, headers: { get: () => "" } };
  }
  if (res.status) {
    const ct = res.headers.get("content-type") || "";
    const cd = res.headers.get("content-disposition") || "";
    check("HTTP 200", res.status === 200, String(res.status));
    check("Content-Type application/pdf", ct.includes("application/pdf"), ct);
    check("starts with %PDF", buf.slice(0, 5).toString() === "%PDF-");
    check("Content-Disposition attachment", cd.includes("attachment"));
  }

  console.log("\n2) HTML layout (debug-html)");
  let html = "";
  try {
    html = await fetch(debugUrl).then((r) => r.text());
  } catch {
    html = "";
  }
  if (html) {
  const pageCount = (html.match(/<div class="page/g) || []).length;
  check("6+ pages in deck", pageCount >= 6, `count=${pageCount}`);

  const boqPages = (html.match(/<div class="page boq-page/g) || []).length;
  check("2+ BOQ pages when rows overflow", boqPages >= 2, `boqPages=${boqPages}`);

  const boqChunks = html.split('<div class="page boq-page');
  const sparseBoq = boqChunks.slice(1).some((chunk) => {
    const rows = (chunk.match(/class="boq-item-row"/g) || []).length;
    const subs = (chunk.match(/class="boq-section-subtotal"/g) || []).length;
    return rows + subs <= 2 && !chunk.includes("Final Price");
  });
  check("No sparse BOQ-only page (1-2 rows without totals)", !sparseBoq);

  check("Absolute logo URLs in HTML", !html.includes('src="/assets/sunchaser-logo.png"'));
  check("page-safe-area shell", html.includes("page-safe-area"));
  check("Thank You closing section", html.includes("Thank You"));
  check("Closing thank-you message", html.includes("Thank you for choosing"));
  } else {
    console.log("  (skipped live HTML — server unreachable)");
  }

  console.log("\n3) Source wiring");
  const layout = readFileSync(join(ROOT, "src/lib/quotePdfLayout.ts"), "utf8");
  const boq = readFileSync(join(ROOT, "src/lib/quoteBoqPdf.ts"), "utf8");
  const render = readFileSync(join(ROOT, "src/lib/quotePdfRender.ts"), "utf8");
  check("resolveQuotePdfAssetUrl", layout.includes("resolveQuotePdfAssetUrl"));
  check("paginateBoqRowsForPdf", boq.includes("paginateBoqRowsForPdf"));
  check("Playwright baseURL", render.includes("baseURL: pdfBaseUrl"));

  console.log("\n4) npm run build");
  const vite = spawnSync(join(ROOT, "node_modules/.bin/vite"), ["build"], { cwd: ROOT, stdio: "pipe" });
  const esbuild = spawnSync(
    join(ROOT, "node_modules/.bin/esbuild"),
    ["server.ts", "--bundle", "--platform=node", "--format=cjs", "--packages=external", "--sourcemap", "--outfile=dist/server.cjs"],
    { cwd: ROOT, stdio: "pipe" }
  );
  check("build passes", vite.status === 0 && esbuild.status === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
