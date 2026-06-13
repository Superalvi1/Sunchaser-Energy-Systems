#!/usr/bin/env node
/**
 * Verify final quotation PDFs use server Playwright binary routes, not browser print.
 * Usage: node scripts/verify-final-pdf-download-paths.mjs [baseUrl] [leadId] [quoteId]
 */
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE = process.argv[2] || process.env.API_BASE_URL || "http://localhost:3000";
const LEAD_ID = process.argv[3] || process.env.VERIFY_LEAD_ID || "";
const QUOTE_ID = process.argv[4] || process.env.VERIFY_QUOTE_ID || "";

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

async function resolveLeadAndQuote() {
  let leadId = LEAD_ID;
  let quoteId = QUOTE_ID;
  if (!leadId) {
    try {
      const leadsRes = await fetch(`${BASE}/api/leads`);
      if (!leadsRes.ok) return null;
      const leads = await leadsRes.json();
      const withManual = (leads || []).find(
        (l) =>
          Array.isArray(l.quotes) &&
          l.quotes.some(
            (q) =>
              q.quote_type === "manual_boq" &&
              (q.boqRows || q.boqItems || []).some((r) => r && r.type === "item")
          )
      );
      if (!withManual) return null;
      leadId = withManual.id;
      quoteId = withManual.quotes.find((q) => q.quote_type === "manual_boq")?.id || "";
    } catch {
      return null;
    }
  }
  return { leadId, quoteId };
}

async function main() {
  console.log("\n1) Server PDF binary routes");
  const server = read("server.ts");
  check("template /download route", server.includes("/api/export/pdf/template-preview/:templateId/download"));
  check("manual /download route", server.includes("/api/export/pdf/manual-quote/:leadId/download"));
  check("debug-html route", server.includes("/api/export/pdf/manual-quote/:leadId/debug-html"));
  check("sendQuotationPdfResponse helper", server.includes("sendQuotationPdfResponse"));
  check("formatQuotationPdfError used", server.includes("formatQuotationPdfError"));

  const ctx = await resolveLeadAndQuote();
  if (!ctx) {
    console.log("\n2) Live API checks (skipped — no lead/quote; pass static checks only)");
  } else {
    const { leadId, quoteId } = ctx;
    const q = quoteId ? `?quoteId=${encodeURIComponent(quoteId)}` : "";

    console.log("\n2) Template test PDF endpoint");
    const tmplRes = await fetch(`${BASE}/api/export/pdf/template-preview/tmpl-1/download?scope=full`);
    const tmplBuf = Buffer.from(await tmplRes.arrayBuffer());
    const tmplCt = tmplRes.headers.get("content-type") || "";
    const tmplCd = tmplRes.headers.get("content-disposition") || "";
    check("template returns application/pdf", tmplCt.includes("application/pdf"), tmplCt);
    check("template Content-Disposition attachment", tmplCd.includes("attachment"));
    check("template starts with %PDF", tmplBuf.slice(0, 5).toString() === "%PDF-");

    console.log("\n3) Manual quote PDF endpoint");
    const manualRes = await fetch(`${BASE}/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}/download${q}`);
    const manualBuf = Buffer.from(await manualRes.arrayBuffer());
    const manualCt = manualRes.headers.get("content-type") || "";
    const manualCd = manualRes.headers.get("content-disposition") || "";
    check("manual returns application/pdf", manualCt.includes("application/pdf"), `${manualCt} status=${manualRes.status}`);
    check("manual Content-Disposition attachment", manualCd.includes("attachment"));
    check("manual starts with %PDF", manualRes.ok && manualBuf.slice(0, 5).toString() === "%PDF-");

    console.log("\n4) HTML preview routes still work");
    const htmlPreview = await fetch(`${BASE}/api/export/pdf/manual-quote/${encodeURIComponent(leadId)}${q}`);
    const htmlText = await htmlPreview.text();
    check("manual HTML preview 200", htmlPreview.ok);
    check("HTML preview is not PDF", !htmlText.startsWith("%PDF"));
    check("HTML preview has action bar", htmlText.includes("sunchaserDownloadPdf"));

    const tmplHtml = await fetch(`${BASE}/api/export/pdf/template-preview/tmpl-1`);
    check("template HTML preview 200", tmplHtml.ok);
  }

  console.log("\n5) Frontend download wiring");
  const sales = read("src/components/SalesTeamApp.tsx");
  const workspace = read("src/components/quoteAuthoring/QuoteTemplateWorkspace.tsx");
  const exportLib = read("src/lib/quotePdfExport.ts");
  check("downloadManualQuotePdf helper", exportLib.includes("manualQuotePdfDownloadUrl"));
  check("downloadTemplateTestPdf helper", exportLib.includes("template-preview"));
  check("SalesTeamApp uses downloadManualQuotePdf", sales.includes("downloadManualQuotePdf("));
  check("Workspace uses downloadTemplateTestPdf", workspace.includes("downloadTemplateTestPdf("));
  check("Download PDF not window.open manual route", !/Download PDF[\s\S]{0,120}window\.open\([^)]*manual-quote[^)]*\)/.test(sales));
  check("handleDownloadManualQuotePDF has no window.print", !/handleDownloadManualQuotePDF[\s\S]{0,800}window\.print/.test(sales));
  check("Workspace download has no window.print", !/handleDownloadTestPdf[\s\S]{0,400}window\.print/.test(workspace));

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
