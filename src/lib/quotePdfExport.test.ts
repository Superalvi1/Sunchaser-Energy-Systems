/**
 * AutoSizer PDF must use authorizedFetch — never a direct browser navigation
 * to the protected Render route.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  autoSizerQuotePdfDownloadUrl,
  autoSizerQuotePdfPreviewUrl,
  isAutoSizerQuoteType,
  manualQuotePdfDownloadUrl,
  manualQuotePdfPreviewUrl,
} from "./quotePdfExport.ts";
import { compileThreePageQuotationHtml } from "./quoteThreePageRender.ts";
import { quotePdfDeckPreviewScripts } from "./quotePdfRender.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("AutoSizer preview helper URL is the protected preview route", () => {
  const url = autoSizerQuotePdfPreviewUrl("lead-1", "quote-9");
  assert.match(url, /\/api\/export\/pdf\/auto-sizer\/lead-1\?quoteId=quote-9/);
  assert.doesNotMatch(url, /\/download/);
});

check("AutoSizer download helper URL is the protected download route", () => {
  const url = autoSizerQuotePdfDownloadUrl("lead-1", "quote-9");
  assert.match(url, /\/api\/export\/pdf\/auto-sizer\/lead-1\/download\?quoteId=quote-9/);
});

check("manual PDF URLs remain on the manual-quote routes", () => {
  assert.match(manualQuotePdfPreviewUrl("lead-1", "q-m"), /\/api\/export\/pdf\/manual-quote\/lead-1/);
  assert.match(manualQuotePdfDownloadUrl("lead-1", "q-m"), /\/api\/export\/pdf\/manual-quote\/lead-1\/download/);
  assert.doesNotMatch(manualQuotePdfDownloadUrl("lead-1", "q-m"), /auto-sizer/);
});

check("quote type routing sends AutoSizer vs Manual to the correct helper", () => {
  assert.equal(isAutoSizerQuoteType("auto_sizer"), true);
  assert.equal(isAutoSizerQuoteType("manual_boq"), false);
  const exportSrc = readFileSync(join(__dirname, "quotePdfExport.ts"), "utf8");
  assert.match(exportSrc, /downloadAutoSizerQuotePdf/);
  assert.match(exportSrc, /downloadManualQuotePdf/);
  assert.match(exportSrc, /if \(isAutoSizerQuoteType\(quoteType\)\) \{\s*return downloadAutoSizerQuotePdf/);
  assert.match(exportSrc, /return downloadManualQuotePdf/);
});

check("AutoSizer preview and download helpers use authorizedFetch", () => {
  const exportSrc = readFileSync(join(__dirname, "quotePdfExport.ts"), "utf8");
  const previewFn = exportSrc.slice(
    exportSrc.indexOf("export async function openAutoSizerQuotePrintPreview"),
    exportSrc.indexOf("export async function downloadQuotePdfByType")
  );
  const downloadFn = exportSrc.slice(
    exportSrc.indexOf("export async function downloadAutoSizerQuotePdf"),
    exportSrc.indexOf("export function manualQuotePdfDebugHtmlUrl")
  );
  assert.match(previewFn, /authorizedFetch\(autoSizerQuotePdfPreviewUrl/);
  assert.match(downloadFn, /authorizedFetch\(autoSizerQuotePdfDownloadUrl/);
  assert.doesNotMatch(previewFn, /window\.location/);
  assert.doesNotMatch(downloadFn, /window\.open\(`\$\{API_BASE_URL\}/);
});

check("SalesTeamApp no longer navigates the browser to the AutoSizer PDF URL", () => {
  const sales = readFileSync(join(__dirname, "../components/SalesTeamApp.tsx"), "utf8");
  assert.doesNotMatch(sales, /window\.open\(\s*`\$\{API_BASE_URL\}\/api\/export\/pdf\/auto-sizer/);
  assert.match(sales, /handleDownloadAutoSizerQuotePDF/);
  assert.match(sales, /handlePrintAutoSizerQuotePDF/);
  assert.match(sales, /handleDownloadQuoteVersionPDF/);
  assert.match(sales, /downloadQuotePdfByType/);
  assert.match(sales, /openQuotePrintPreviewByType/);
});

check("Generated Quotes routes AutoSizer versions to AutoSizer helpers", () => {
  const sales = readFileSync(join(__dirname, "../components/SalesTeamApp.tsx"), "utf8");
  const versionChunk = sales.slice(
    sales.indexOf("handleDownloadQuoteVersionPDF"),
    sales.indexOf("handlePrintQuoteVersionPDF") + 450
  );
  assert.match(versionChunk, /quote\.quote_type === "auto_sizer"/);
  assert.match(versionChunk, /handleDownloadAutoSizerQuotePDF/);
  assert.match(versionChunk, /handleDownloadManualQuotePDF/);
});

check("server AutoSizer PDF routes remain staff-protected", () => {
  const server = readFileSync(join(__dirname, "../../server.ts"), "utf8");
  const preview = server.slice(
    server.indexOf('app.get("/api/export/pdf/auto-sizer/:leadId"'),
    server.indexOf('app.get("/api/export/pdf/auto-sizer/:leadId/download"')
  );
  const download = server.slice(
    server.indexOf('app.get("/api/export/pdf/auto-sizer/:leadId/download"'),
    server.indexOf('app.post("/api/export/pdf/manual-quote"')
  );
  assert.match(preview, /resolveStaffActor\(req, res\)/);
  assert.match(preview, /guardSalesOwnedResourceText/);
  assert.match(download, /resolveStaffActor\(req, res\)/);
  assert.match(download, /guardSalesOwnedResourceText/);
  assert.doesNotMatch(preview, /if \(!staff\) return res\.status\(200\)/);
});

check("3-page preview HTML does not fetch the protected /download route", () => {
  const rendered = compileThreePageQuotationHtml(
    { id: "q-1", clientName: "Test", boqRows: [], systemType: "Hybrid", systemSizekW: 10 },
    { id: "lead-1", name: "Test" },
    { companyTerms: [{ termText: "Quotation validity: 3 days from date of issuance." }] }
  );
  assert.doesNotMatch(rendered.html, /sunchaserDownloadPdf/);
  assert.doesNotMatch(rendered.html, /pathname\.replace/);
  assert.doesNotMatch(rendered.html, /\/download'\s*\+/);
  assert.match(rendered.html, /sunchaserPrintDeck/);
});

check("legacy deck preview scripts no longer request the protected download URL", () => {
  const scripts = quotePdfDeckPreviewScripts();
  assert.doesNotMatch(scripts, /path \+ '\/download'/);
  assert.doesNotMatch(scripts, /localStorage\.getItem\('sunchaser_auth_token'\)/);
});

console.log(`\nquote PDF export tests: ${pass} passed`);
