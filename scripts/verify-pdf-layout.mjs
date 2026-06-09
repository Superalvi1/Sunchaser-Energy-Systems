#!/usr/bin/env node
/**
 * Verify quotation PDF pagination, A4 sizing, and footer layout.
 * Usage: API_BASE=http://localhost:3000 node scripts/verify-pdf-layout.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "scratch", "pdf-layout-audit");
const BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/$/, "");

function pass(id, ok, msg) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${msg}`);
  return ok;
}

async function fetchPreviewHtml() {
  const res = await fetch(`${BASE}/api/export/pdf/template-preview/tmpl-1`);
  if (!res.ok) throw new Error(`Preview HTTP ${res.status}`);
  return res.text();
}

function assertCssRules(html) {
  let ok = true;
  ok &= pass("css @page A4 20mm", /@page\s*\{[^}]*size:\s*A4[^}]*margin:\s*20mm/s.test(html), "A4 + 20mm margin");
  ok &= pass("css page break-after", /\.page\s*\{[^}]*break-after:\s*page/s.test(html), ".page { break-after: page }");
  ok &= pass("css section break-inside", /\.section[^}]*break-inside:\s*avoid/s.test(html), ".section { break-inside: avoid }");
  ok &= pass("css footer not absolute", !/\.page-footer[^}]*position:\s*absolute/s.test(html), "footer uses flow layout");
  ok &= pass("css footer margin-top auto", /\.page-footer[^}]*margin-top:\s*auto/s.test(html), "footer pinned via flex");
  ok &= pass("css page overflow visible", /\.page\s*\{[^}]*overflow:\s*visible/s.test(html), "content not clipped");
  ok &= pass("css cover flex-start", /\.page\.cover[^}]*justify-content:\s*flex-start/s.test(html), "cover avoids space-between gaps");
  ok &= pass("html page count", (html.match(/class="page/g) || []).length >= 9, `${(html.match(/class="page/g) || []).length} pages`);
  ok &= pass("html page-footer count", (html.match(/class="page-footer/g) || []).length >= 1, `${(html.match(/class="page-footer/g) || []).length} footers`);
  return ok;
}

async function renderPdfArtifacts(html, label) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.warn("SKIP pdf render: install playwright (npx playwright install chromium)");
    return null;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  const pdfPath = path.join(OUT_DIR, `${label}.pdf`);
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
  });

  const pages = await page.locator(".page").all();
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({
      path: path.join(OUT_DIR, `${label}-page-${String(i + 1).padStart(2, "0")}.png`),
    });
  }
  await page.screenshot({ path: path.join(OUT_DIR, `${label}-full.png`), fullPage: true });
  await browser.close();
  return { pdfPath, pageCount: pages.length };
}

(async () => {
  console.log(`\n=== PDF layout verify @ ${BASE} ===\n`);
  let ok = true;
  try {
    const html = await fetchPreviewHtml();
    ok &= assertCssRules(html);
    const rendered = await renderPdfArtifacts(html, "after-fix");
    if (rendered) {
      ok &= pass("pdf page elements", rendered.pageCount >= 9, `${rendered.pageCount} .page nodes rendered`);
      ok &= pass("pdf artifact", fs.existsSync(rendered.pdfPath), rendered.pdfPath);
      console.log(`\nArtifacts: ${OUT_DIR}\n`);
    }
  } catch (err) {
    ok = false;
    console.error("FAIL:", err.message);
  }
  process.exit(ok ? 0 : 1);
})();
