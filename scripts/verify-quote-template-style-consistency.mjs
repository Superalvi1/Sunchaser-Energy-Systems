#!/usr/bin/env node
/** Verify quote template style consistency: sanitize, typography vars, watermark inheritance. */
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
  const authoring = read("src/lib/quoteAuthoring.ts");
  const layout = read("src/lib/quotePdfLayout.ts");
  const render = read("src/lib/quoteTemplatePageRender.ts");
  const editor = read("src/components/quoteAuthoring/QuoteRichTextEditor.tsx");
  const server = read("server.ts");

  console.log("\n1) Sanitizer + paste");
  check("sanitizeQuoteEditorHtml exists", authoring.includes("export function sanitizeQuoteEditorHtml"));
  check("Editor paste handler", editor.includes("onPaste={handlePaste}"));
  check("Save uses sanitizer", read("src/components/SalesTeamApp.tsx").includes("sanitizeQuoteEditorHtml(state.body_html"));

  console.log("\n2) Typography CSS variables");
  check("--quote-font-family in layout", layout.includes("--quote-font-family"));
  check("--quote-body-color default #1f2937", layout.includes("#1f2937"));
  check("quoteTemplateBodyCss underline reset", authoring.includes("text-decoration: none"));
  check("h3 uses heading color var", authoring.includes("color: var(--quote-heading-color"));

  console.log("\n3) Watermark inheritance");
  check("resolvePageWatermark exported", layout.includes("export function resolvePageWatermark"));
  check("Server uses resolvePageWatermark", server.includes("resolvePageWatermark(ext.watermark"));
  check("Preview watermark helper", render.includes("resolvePreviewWatermarkStyle"));
  check("Using Global Watermark label", read("src/components/quoteAuthoring/QuoteTemplatePageSettingsPanel.tsx").includes("Using Global Watermark"));

  console.log("\n4) Runtime sanitizer behavior");
  const runtime = spawnSync(join(ROOT, "node_modules/.bin/tsx"), ["scripts/_verify-sanitizer-runtime.ts"], {
    cwd: ROOT,
    stdio: "pipe",
  });
  const runtimeOk = runtime.status === 0;
  if (!runtimeOk) console.error(runtime.stdout?.toString() || runtime.stderr?.toString());
  check("Runtime sanitizer strips underline/fonts/anchors", runtimeOk);

  console.log("\n5) npm run build");
  const vite = spawnSync(join(ROOT, "node_modules/.bin/vite"), ["build"], { cwd: ROOT, stdio: "pipe" });
  const esbuild = spawnSync(
    join(ROOT, "node_modules/.bin/esbuild"),
    ["server.ts", "--bundle", "--platform=node", "--format=cjs", "--packages=external", "--sourcemap", "--outfile=dist/server.cjs"],
    { cwd: ROOT, stdio: "pipe" }
  );
  const buildOk = vite.status === 0 && esbuild.status === 0;
  if (!buildOk) console.error(vite.stderr?.toString() || esbuild.stderr?.toString());
  check("npm run build passes", buildOk);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
