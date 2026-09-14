import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sales = readFileSync(join(here, "../components/SalesTeamApp.tsx"), "utf8");
const pdf = readFileSync(join(here, "quotePdfExport.ts"), "utf8");
const server = readFileSync(join(here, "../../server.ts"), "utf8");

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

check("Quick Quotation has a dedicated no-CRM sentinel and visible entry", () => {
  assert.match(sales, /QUICK_QUOTE_LEAD_ID = "__quick_quotation_no_crm__"/);
  assert.match(sales, /data-testid="quick-quotation-no-lead"/);
  assert.match(sales, /No CRM lead .* no customer record .* PDF only/);
});

check("Quick Quotation exits before CRM create\/update quote persistence", () => {
  const marker = "quickQuotePayloadRef.current = quoteData";
  const idx = sales.indexOf(marker);
  const saveIdx = sales.indexOf("let savedQuoteId = editingQuoteId", idx);
  assert.ok(idx >= 0 && saveIdx > idx);
  const quick = sales.slice(idx - 100, saveIdx);
  assert.doesNotMatch(quick, /\/api\/leads\//);
});

check("Quick PDF stages Android export and keeps browser download route", () => {
  assert.match(pdf, /manual-quote\?stage=1/);
  assert.match(pdf, /manual-quote\?download=1/);
  assert.match(pdf, /method: "POST"/);
  assert.match(sales, /downloadEphemeralManualQuotePdf\(quickQuotePayloadRef\.current\)/);
  const start = server.indexOf('app.post("/api/export/pdf/manual-quote"');
  const end = server.indexOf("function buildTemplatePreviewMockData", start);
  const route = server.slice(start, end);
  assert.match(route, /req\.query\.stage === "1"/);
  assert.match(route, /stageQuotationPdf\(pdfBuffer, filename\)/);
  assert.match(route, /downloadUrl: `\/api\/export\/pdf\/staged-public\/\$\{token\}`/);
});

check("server ephemeral manual quote can return PDF without saving lead or quote", () => {
  const start = server.indexOf('app.post("/api/export/pdf/manual-quote"');
  const end = server.indexOf("function buildTemplatePreviewMockData", start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /req\.query\.download === "1"/);
  assert.match(route, /sendQuotationPdfResponse/);
  assert.doesNotMatch(route, /persistQuotationToSupabase/);
  assert.doesNotMatch(route, /create-quote/);
});

check("native PDF path uses one-time Browser handoff and no file/share bridge", () => {
  assert.match(pdf, /Browser\.open/);
  assert.match(pdf, /openAndroidStagedPdf/);
  assert.doesNotMatch(pdf, /Share\.share/);
  assert.doesNotMatch(pdf, /Filesystem\.writeFile/);
  assert.doesNotMatch(pdf, /FileTransfer\.downloadFile/);
  assert.doesNotMatch(pdf, /FileViewer\.openDocumentFromLocalPath/);
});

check("server issues short-lived one-time public PDF URLs for Android browser", () => {
  assert.match(server, /staged-public\/:token/);
  assert.match(server, /takeStagedQuotationPdf/);
  assert.match(server, /STAGED_QUOTATION_PDF_TTL_MS = 2 \* 60 \* 1000/);
  assert.match(server, /Cache-Control", "no-store"/);
});

check("browser PDF path still uses standard anchor download", () => {
  assert.match(pdf, /URL\.createObjectURL\(blob\)/);
  assert.match(pdf, /anchor\.download = filename/);
});

console.log(`\nquick quotation mode tests: ${passed} passed`);
