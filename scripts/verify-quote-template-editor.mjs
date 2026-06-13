#!/usr/bin/env node
/**
 * Quote Template Workspace — full-screen editor (no stacked cards).
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
  const sales = read("src/components/SalesTeamApp.tsx");
  const workspace = read("src/components/quoteAuthoring/QuoteTemplateWorkspace.tsx");

  console.log("\n1) Workspace replaces card grid");
  check("QuoteTemplateWorkspace exists", workspace.includes("selectedTemplatePageId"));
  check("SalesTeamApp uses QuoteTemplateWorkspace", sales.includes("<QuoteTemplateWorkspace"));
  check("Old QuoteTemplateStudio not used", !sales.includes("<QuoteTemplateStudio"));
  check("No Visual Proposal Template Pages heading", !sales.includes("Visual Proposal Template Pages"));
  check("No stacked page card map", !/quoteTemplatePages[\s\S]{0,200}\.map\(\(page/.test(sales));

  console.log("\n2) Subcomponents");
  check("TemplatePageSidebar", existsSync(join(ROOT, "src/components/quoteAuthoring/TemplatePageSidebar.tsx")));
  check("TemplatePageEditor", existsSync(join(ROOT, "src/components/quoteAuthoring/TemplatePageEditor.tsx")));
  check("TemplateA4Preview", existsSync(join(ROOT, "src/components/quoteAuthoring/TemplateA4Preview.tsx")));

  console.log("\n3) Single-page editor + large preview");
  check("Only one page editor path", workspace.includes("activePage && pageState"));
  check("Editor min 600px", read("src/components/quoteAuthoring/TemplatePageEditor.tsx").includes("minHeight={600}"));
  check("Preview min 420px wide", read("src/components/quoteAuthoring/TemplateA4Preview.tsx").includes("min-w-[420px]"));
  check("Preview zoom controls", read("src/components/quoteAuthoring/TemplateA4Preview.tsx").includes("Fit"));

  console.log("\n4) Top bar actions");
  check("Save Page visible", workspace.includes("Save Page"));
  check("Preview button", workspace.includes("Preview"));
  check("Print Test", workspace.includes("Print Test"));
  check("Download Test PDF", workspace.includes("Download Test PDF"));

  console.log("\n5) Sidebar pages");
  const nav = read("src/lib/quoteTemplateNav.ts");
  check("Cover Page in nav builder", nav.includes("Cover Page"));
  check("Global PDF Settings", nav.includes("Global PDF Settings"));

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
