#!/usr/bin/env node
/**
 * Premium Quote Template Editor — full-screen studio UX verification.
 */
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

async function main() {
  console.log("\n1-2) Full-screen template studio components");
  const studio = read("src/components/quoteAuthoring/QuoteTemplateStudio.tsx");
  const sales = read("src/components/SalesTeamApp.tsx");
  check("QuoteTemplateStudio exists", studio.includes("export default function QuoteTemplateStudio"));
  check("SalesTeamApp uses QuoteTemplateStudio", sales.includes("<QuoteTemplateStudio"));
  check("Cramped per-page card grid removed from templates module", !sales.includes("Visual Proposal Template Pages"));

  console.log("\n3-4) Sidebar navigation + large editor");
  check("Global PDF Settings nav", studio.includes("Global PDF Settings"));
  check("Cover Page nav label helper", read("src/lib/quoteTemplateNav.ts").includes("Cover Page"));
  check("BOQ Page nav item", studio.includes("BOQ Page"));
  check("Large rich text editor", studio.includes("minHeight={420}"));
  check("Sticky toolbar enabled", studio.includes("stickyToolbar"));

  console.log("\n5-7) Preview + font size");
  const previewModal = read("src/components/quoteAuthoring/QuoteTemplatePreviewModal.tsx");
  const richEditor = read("src/components/quoteAuthoring/QuoteRichTextEditor.tsx");
  check("Preview modal 90% size", previewModal.includes("90vw") && previewModal.includes("90vh"));
  check("Zoom controls", previewModal.includes("50%") && previewModal.includes("Fit Width"));
  check("Live A4 preview panel", studio.includes("Live A4 Preview"));
  check("Font size control in editor", richEditor.includes("FONT_SIZES"));

  console.log("\n8-11) Page actions + persistence API");
  check("Save Page button", studio.includes("Save Page"));
  check("Reset Page", studio.includes("Reset Page"));
  check("Duplicate Page", studio.includes("Duplicate"));
  check("Move up/down", studio.includes("Move up"));
  check("Enable/disable", studio.includes("is_enabled"));
  check("serializeQuotePageBody on save", sales.includes("serializeQuotePageBody"));
  check("bodyHtml saved", sales.includes("bodyHtml: state.body_html"));

  console.log("\n12) Global settings panel");
  const globalPanel = read("src/components/quoteAuthoring/QuoteTemplateGlobalSettingsPanel.tsx");
  check("Global watermark upload", globalPanel.includes("Upload watermark"));
  check("Page margins fields", globalPanel.includes("Page Margins"));
  check("PDF quality setting", globalPanel.includes("PDF Quality"));

  console.log("\n13) npm run build");
  const viteBin = join(ROOT, "node_modules/.bin/vite");
  const esbuildBin = join(ROOT, "node_modules/.bin/esbuild");
  const vite = spawnSync(viteBin, ["build"], { cwd: ROOT, stdio: "pipe" });
  const esbuild = spawnSync(
    esbuildBin,
    ["server.ts", "--bundle", "--platform=node", "--format=cjs", "--packages=external", "--sourcemap", "--outfile=dist/server.cjs"],
    { cwd: ROOT, stdio: "pipe" }
  );
  const buildOk = vite.status === 0 && esbuild.status === 0;
  if (!buildOk) {
    console.error(vite.stderr?.toString() || esbuild.stderr?.toString());
  }
  check("npm run build passes", buildOk);
  check("dist/index.html produced", existsSync(join(ROOT, "dist/index.html")));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
