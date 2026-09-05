/**
 * AutoSizer PDF must use authorizedFetch — never a direct browser navigation
 * to the protected Render route. Preview must open a blank window before
 * awaiting network so the user gesture is not lost.
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
const exportSrc = readFileSync(join(__dirname, "quotePdfExport.ts"), "utf8");
const salesSrc = readFileSync(join(__dirname, "../components/SalesTeamApp.tsx"), "utf8");
const serverSrc = readFileSync(join(__dirname, "../../server.ts"), "utf8");

function sliceBetween(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  assert.ok(to > from, `missing end marker after ${start}: ${end}`);
  return src.slice(from, to);
}

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
  assert.match(exportSrc, /if \(isAutoSizerQuoteType\(quoteType\)\) \{\s*return downloadAutoSizerQuotePdf/);
  assert.match(exportSrc, /return downloadManualQuotePdf/);
  const previewByType = sliceBetween(
    exportSrc,
    "export async function openQuotePrintPreviewByType",
    "export function printProposalPreviewIframe"
  );
  assert.match(previewByType, /return openAutoSizerQuotePrintPreview/);
  assert.match(previewByType, /return openManualQuotePrintPreview/);
});

check("AutoSizer download uses authorizedFetch and does not navigate directly", () => {
  const downloadFn = sliceBetween(
    exportSrc,
    "export async function downloadAutoSizerQuotePdf",
    "export function manualQuotePdfDebugHtmlUrl"
  );
  assert.match(downloadFn, /authorizedFetch\(autoSizerQuotePdfDownloadUrl/);
  assert.doesNotMatch(downloadFn, /window\.location/);
  assert.doesNotMatch(downloadFn, /window\.open\(`\$\{API_BASE_URL\}/);
  assert.match(downloadFn, /triggerBlobDownload/);
});

check("AutoSizer preview uses authorizedFetch via the shared helper", () => {
  const previewFn = sliceBetween(
    exportSrc,
    "export async function openAutoSizerQuotePrintPreview",
    "export async function downloadQuotePdfByType"
  );
  assert.match(previewFn, /fetchAndWriteQuotePreview\(autoSizerQuotePdfPreviewUrl/);
  assert.doesNotMatch(previewFn, /window\.location/);
  const helper = sliceBetween(
    exportSrc,
    "async function fetchAndWriteQuotePreview",
    "export async function downloadManualQuotePdf"
  );
  assert.match(helper, /authorizedFetch\(url\)/);
});

check("blank preview window is opened before awaited network work", () => {
  const helper = sliceBetween(
    exportSrc,
    "async function fetchAndWriteQuotePreview",
    "export async function downloadManualQuotePdf"
  );
  const openIdx = helper.search(/window\.open\(\s*""\s*,\s*"_blank"\s*\)/);
  const awaitIdx = helper.search(/await\s+authorizedFetch\(url\)/);
  assert.ok(openIdx >= 0, "blank window.open is present");
  assert.ok(awaitIdx >= 0, "authorizedFetch await is present");
  assert.ok(openIdx < awaitIdx, "window.open must run before the first authorizedFetch await");
  assert.doesNotMatch(helper, /noopener/);
});

check("failed preview fetch closes the pre-opened window", () => {
  const helper = sliceBetween(
    exportSrc,
    "async function fetchAndWriteQuotePreview",
    "export async function downloadManualQuotePdf"
  );
  assert.match(helper, /catch\s*\(err\)/);
  assert.match(helper, /win\.close\(\)/);
});

check("Manual preview still works through shared safe helper", () => {
  const manualFn = sliceBetween(
    exportSrc,
    "export async function openManualQuotePrintPreview",
    "export async function openAutoSizerQuotePrintPreview"
  );
  assert.match(manualFn, /fetchAndWriteQuotePreview\(manualQuotePdfPreviewUrl/);
});

check("SalesTeamApp no longer navigates the browser to the AutoSizer PDF URL", () => {
  assert.doesNotMatch(salesSrc, /window\.open\(\s*`\$\{API_BASE_URL\}\/api\/export\/pdf\/auto-sizer/);
  assert.match(salesSrc, /handleDownloadAutoSizerQuotePDF/);
  assert.match(salesSrc, /handlePrintAutoSizerQuotePDF/);
  assert.match(salesSrc, /handleDownloadQuoteVersionPDF/);
  assert.match(salesSrc, /downloadQuotePdfByType/);
  assert.match(salesSrc, /openQuotePrintPreviewByType/);
});

check("Generated Quotes routes AutoSizer versions to AutoSizer helpers", () => {
  const versionChunk = salesSrc.slice(
    salesSrc.indexOf("handleDownloadQuoteVersionPDF"),
    salesSrc.indexOf("handlePrintQuoteVersionPDF") + 450
  );
  assert.match(versionChunk, /quote\.quote_type === "auto_sizer"/);
  assert.match(versionChunk, /handleDownloadAutoSizerQuotePDF/);
  assert.match(versionChunk, /handleDownloadManualQuotePDF/);
});

check("server AutoSizer PDF routes remain staff-protected", () => {
  const preview = sliceBetween(
    serverSrc,
    'app.get("/api/export/pdf/auto-sizer/:leadId"',
    'app.get("/api/export/pdf/auto-sizer/:leadId/download"'
  );
  const download = sliceBetween(
    serverSrc,
    'app.get("/api/export/pdf/auto-sizer/:leadId/download"',
    'app.post("/api/export/pdf/manual-quote"'
  );
  assert.match(preview, /resolveStaffActor\(req, res\)/);
  assert.match(preview, /guardSalesOwnedResourceText/);
  assert.match(download, /resolveStaffActor\(req, res\)/);
  assert.match(download, /guardSalesOwnedResourceText/);
  assert.doesNotMatch(preview, /if \(!staff\) return res\.status\(200\)/);
});

check("standard 3-page HTML has no unauthenticated Download action", () => {
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

check("unrelated legacy Proposal Deck renderer is not degraded", () => {
  const scripts = quotePdfDeckPreviewScripts();
  assert.match(scripts, /async function sunchaserDownloadPdf/);
  assert.match(scripts, /path \+ '\/download'/);
  assert.match(scripts, /localStorage\.getItem\('sunchaser_auth_token'\)/);
  assert.doesNotMatch(scripts, /Download PDF from Sunchaser CRM/);
});

console.log(`\nquote PDF export tests: ${pass} passed`);
