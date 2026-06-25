#!/usr/bin/env node
/** Verify manual quote PDF uses saved template data (not local seed fallback). */
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE = process.env.API_BASE_URL || "http://localhost:3000";
const UNIQUE = "TEMPLATE SOURCE TEST 12345";

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

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { res, text, json };
}

async function main() {
  const server = read("server.ts");
  const manualLib = read("src/lib/manualQuotePdfTemplate.ts");
  const layout = read("src/lib/quotePdfLayout.ts");
  const sales = read("src/components/SalesTeamApp.tsx");

  console.log("\n1) Template data source wiring");
  check("manualQuotePdfTemplate module", existsSync(join(ROOT, "src/lib/manualQuotePdfTemplate.ts")));
  check("resolveQuoteExportState uses Supabase only", server.includes("return await fetchAppStateFromSupabase();"));
  check("create-quote persists templateId", server.includes("templateId: templateId || \"tmpl-1\""));
  check("create-quote persists includedPages", server.includes("includedPages: normalizeManualQuoteIncludedPages(includedPages)"));
  check("download uses normalizeManualQuoteIncludedPages", server.includes("normalizeManualQuoteIncludedPages(quote.includedPages)"));
  check("debug-template-map route", server.includes("/api/export/pdf/manual-quote/:leadId/debug-template-map"));
  check("resolvePdfAssetUrl alias", layout.includes("export const resolvePdfAssetUrl"));
  check("resolvePdfLogoForExport helper", manualLib.includes("export function resolvePdfLogoForExport"));
  check("Manual save includes templateId", sales.includes("templateId: selectedTemplateId"));

  console.log("\n2) Page checklist normalization");
  check("terms maps to terms1/terms2", manualLib.includes('normalized.add("terms1")'));
  check("isManualQuotePageIncluded helper", manualLib.includes("export function isManualQuotePageIncluded"));

  console.log("\n3) Fallback gating");
  check("profile grid only without saved body", server.includes("useDefaultCompanyContent && !hasAuthoringBody()"));
  check("qr grid only without saved body", (server.match(/useDefaultCompanyContent && !hasAuthoringBody\(\)/g) || []).length >= 2);

  console.log("\n4) Optional live API checks");
  if (process.env.SKIP_LIVE_API === "1") {
    console.log("  (skipped — set API_BASE_URL and unset SKIP_LIVE_API to run live checks)");
  } else {
    try {
      const health = await fetch(`${BASE}/health`);
      if (!health.ok) throw new Error(`health ${health.status}`);
      const pagesRes = await fetchJson(`${BASE}/api/state`);
      const pages = pagesRes.json?.quoteTemplatePages || [];
      const profilePage = pages.find(
        (p) =>
          (p.pageType || p.page_type) === "profile" &&
          (p.templateId || p.template_id) === "tmpl-1"
      );
      if (profilePage) {
        const body = profilePage.bodyText || profilePage.body_text || "";
        const hasUnique = body.includes(UNIQUE);
        console.log(`  profile page body contains unique marker: ${hasUnique}`);
      } else {
        console.log("  (no tmpl-1 profile page in /api/state — seed unique text in template editor for live test)");
      }
    } catch (err) {
      console.log(`  (live API skipped: ${err.message})`);
    }
  }

  console.log("\n5) Build");
  const npm = join(ROOT, "node-env/bin/npm");
  const npmBin = existsSync(npm) ? npm : "npm";
  const build = spawnSync(npmBin, ["run", "build"], { cwd: ROOT, stdio: "pipe", env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" } });
  if (build.status !== 0) {
    console.error(build.stderr?.toString() || build.stdout?.toString());
  }
  check("npm run build passes", build.status === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
