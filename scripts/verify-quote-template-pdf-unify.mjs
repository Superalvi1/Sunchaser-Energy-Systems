#!/usr/bin/env node
/** Verify quote template preview + PDF export use unified rendering and save-before-download. */
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
  const server = read("server.ts");
  const workspace = read("src/components/quoteAuthoring/QuoteTemplateWorkspace.tsx");
  const preview = read("src/components/quoteAuthoring/QuotePageLivePreview.tsx");
  const render = read("src/lib/quoteTemplatePageRender.ts");
  const layout = read("src/lib/quotePdfLayout.ts");
  const exportLib = read("src/lib/quotePdfExport.ts");

  console.log("\n1) Shared renderer");
  check("quoteTemplatePageRender exists", existsSync(join(ROOT, "src/lib/quoteTemplatePageRender.ts")));
  check("renderQuoteTemplatePage exported", render.includes("export function renderQuoteTemplatePage"));
  check("Live preview uses shared renderer", preview.includes("renderQuoteTemplatePage"));
  check("Server uses hasTemplatePageBodyContent", server.includes("hasTemplatePageBodyContent"));

  console.log("\n2) bodyHtml + typography in PDF compile");
  check("richBody helper in compile", server.includes("const richBody = ()"));
  check("No stale p.bodyText-only gate", !server.includes("p.bodyText ? rich(p.bodyText)"));

  console.log("\n3) A4 shell CSS");
  check("@page margin 0", layout.includes("margin: 0;") && layout.includes("@page"));
  check("210mm page width", layout.includes("width: 210mm"));
  check("Safe padding 18mm", layout.includes("18mm 18mm 16mm 18mm"));

  console.log("\n4) PDF download route");
  check("template download route", server.includes("/api/export/pdf/template-preview/:templateId/download"));
  check("Content-Type application/pdf", server.includes('Content-Type", "application/pdf"'));
  check("buildTemplateTestPdfFilename", server.includes("buildTemplateTestPdfFilename"));
  check("downloadTemplateTestPdf client helper", exportLib.includes("downloadTemplateTestPdf"));

  console.log("\n5) Save before download UX");
  check("Saving template status", workspace.includes("Saving template..."));
  check("Generating PDF status", workspace.includes("Generating PDF..."));
  check("Unsaved changes label", workspace.includes("Unsaved changes"));
  check("Save & Download Test PDF button", workspace.includes("Save & Download Test PDF"));
  check("Silent save option", read("src/components/SalesTeamApp.tsx").includes("silent?: boolean"));

  console.log("\n6) npm run build");
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
