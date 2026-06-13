/** Server-side HTML → PDF via Playwright Chromium. */

import { PDF_ENGINE_MISSING_MESSAGE, formatQuotationPdfError } from "./quotePdfErrors.ts";

export { PDF_ENGINE_MISSING_MESSAGE, formatQuotationPdfError };

export function buildTemplateTestPdfFilename(title?: string, scope: "page" | "full" = "full"): string {
  if (scope === "page" && title) {
    const safe = String(title)
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 48) || "page";
    return `template-page-${safe}.pdf`;
  }
  return "sunchaser-template-test.pdf";
}

export function buildQuotationPdfFilename(lead: any, quote: any): string {
  const client = String(quote?.clientName || lead?.name || "Client").trim();
  const safe = client
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48) || "Client";
  const kwRaw = quote?.systemSizekW ?? lead?.systemSizekW;
  const kw = kwRaw != null && kwRaw !== "" ? `${Number(kwRaw)}kW` : "";
  return `Sunchaser-Quotation-${safe}${kw ? `-${kw}` : ""}.pdf`;
}

const CHROMIUM_LAUNCH_OPTIONS = {
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
} as const;

let chromiumInstallPromise: Promise<void> | null = null;

/** One-shot runtime install for hosts where the build-phase browser cache is missing (e.g. Render). */
async function installChromiumAtRuntime(): Promise<void> {
  if (!chromiumInstallPromise) {
    chromiumInstallPromise = (async () => {
      const { spawn } = await import("node:child_process");
      console.warn("[PDF] Chromium executable missing — running `playwright install chromium`…");
      await new Promise<void>((resolve, reject) => {
        const child = spawn("npx", ["playwright", "install", "chromium", "--with-deps"], {
          stdio: "inherit",
          env: process.env,
        });
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`playwright install exited with code ${code}`))
        );
      });
      console.warn("[PDF] Chromium runtime install complete.");
    })().catch((err) => {
      chromiumInstallPromise = null;
      throw err;
    });
  }
  return chromiumInstallPromise;
}

function isMissingBrowserError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  return /executable doesn't exist|please run the following command|playwright install/i.test(msg);
}

export async function renderQuotationHtmlToPdf(html: string): Promise<Buffer> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(PDF_ENGINE_MISSING_MESSAGE);
  }

  let browser;
  try {
    browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
  } catch (err) {
    if (!isMissingBrowserError(err)) throw err;
    await installChromiumAtRuntime();
    browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 120_000 });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    await page.waitForTimeout(350);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      displayHeaderFooter: false,
    });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export function quotePdfDeckActionBarCss(): string {
  return `
        .action-bar-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .btn-download {
          background-color: #0f172a;
          color: #ffffff;
          border: 1px solid #334155;
          padding: 8px 18px;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
        }
        .btn-download:hover { background-color: #1e293b; }
        .btn-download:disabled { opacity: 0.55; cursor: wait; }
  `;
}

/** Safe print + blob download for HTML preview pages. */
export function quotePdfDeckPreviewScripts(): string {
  return `
      <script>
        function sunchaserPrintDeck() {
          var run = function () {
            requestAnimationFrame(function () {
              setTimeout(function () { window.print(); }, 150);
            });
          };
          var fontReady = document.fonts && document.fonts.ready
            ? document.fonts.ready
            : Promise.resolve();
          fontReady.then(run).catch(run);
        }
        async function sunchaserDownloadPdf() {
          var btn = document.querySelector('.btn-download');
          if (btn) btn.disabled = true;
          try {
            var path = window.location.pathname.replace(/\\/$/, '');
            var url = path + '/download' + window.location.search;
            var res = await fetch(url);
            if (!res.ok) {
              var errText = await res.text();
              throw new Error(errText || ('Download failed (' + res.status + ')'));
            }
            var blob = await res.blob();
            var name = 'Sunchaser-Quotation.pdf';
            var cd = res.headers.get('Content-Disposition') || '';
            var match = cd.match(/filename="?([^";]+)"?/i);
            if (match) name = match[1];
            var a = document.createElement('a');
            var objectUrl = URL.createObjectURL(blob);
            a.href = objectUrl;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
          } catch (err) {
            alert((err && err.message) || 'PDF download failed');
          } finally {
            if (btn) btn.disabled = false;
          }
        }
      </script>
  `;
}
