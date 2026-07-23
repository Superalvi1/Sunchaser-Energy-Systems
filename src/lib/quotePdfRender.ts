/** Server-side HTML → PDF via Playwright Chromium. */

import { PDF_ENGINE_MISSING_MESSAGE, formatQuotationPdfError } from "./quotePdfErrors.ts";
import { getQuotePdfAppBaseUrl } from "./quotePdfLayout.ts";

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
  headless: true as const,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};

export function getPlaywrightBrowsersPath(): string {
  return process.env.PLAYWRIGHT_BROWSERS_PATH ?? "0";
}

function playwrightInstallEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: getPlaywrightBrowsersPath(),
  };
}

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
          env: playwrightInstallEnv(),
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
  return /executable doesn't exist|please run the following command|playwright install|browserType\.launch|ENOENT/i.test(msg);
}

export type PdfEngineDiagnostic = {
  platform: string;
  arch: string;
  nodeVersion: string;
  playwrightVersion: string | null;
  playwrightImportOk: boolean;
  playwrightBrowsersPath: string;
  chromiumExecutablePath: string | null;
  chromiumExecutableExists: boolean;
  browserLaunchSuccess: boolean;
  browserLaunchError: string | null;
  hostingHint: string;
  renderGitCommit: string | null;
};

export async function diagnosePdfEngine(): Promise<PdfEngineDiagnostic> {
  const fs = await import("node:fs");
  const { createRequire } = await import("node:module");
  const require = createRequire(__filename);

  let playwrightVersion: string | null = null;
  try {
    playwrightVersion = require("playwright/package.json").version as string;
  } catch {
    /* optional */
  }

  let chromium: typeof import("playwright").chromium | null = null;
  let playwrightImportOk = false;
  let chromiumExecutablePath: string | null = null;
  let chromiumExecutableExists = false;
  let browserLaunchSuccess = false;
  let browserLaunchError: string | null = null;

  try {
    ({ chromium } = await import("playwright"));
    playwrightImportOk = true;
    try {
      chromiumExecutablePath = chromium.executablePath();
      chromiumExecutableExists = fs.existsSync(chromiumExecutablePath);
    } catch (pathErr: any) {
      browserLaunchError = String(pathErr?.message || pathErr);
    }

    if (!chromiumExecutableExists) {
      try {
        await installChromiumAtRuntime();
        chromiumExecutablePath = chromium.executablePath();
        chromiumExecutableExists = fs.existsSync(chromiumExecutablePath);
      } catch (installErr: any) {
        browserLaunchError = String(installErr?.message || installErr);
      }
    }

    if (chromiumExecutableExists && chromium) {
      let browser;
      try {
        browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
        await browser.close();
        browserLaunchSuccess = true;
        browserLaunchError = null;
      } catch (launchErr: any) {
        browserLaunchError = String(launchErr?.message || launchErr);
      }
    }
  } catch (importErr: any) {
    browserLaunchError = String(importErr?.message || importErr);
  }

  const hostingHint = process.env.RENDER
    ? "render"
    : process.env.VERCEL
      ? "vercel"
      : process.env.RAILWAY_ENVIRONMENT
        ? "railway"
        : "unknown";

  console.log("[PDF ENGINE DIAGNOSTIC]", {
    platform: process.platform,
    playwrightBrowsersPath: getPlaywrightBrowsersPath(),
    chromiumExecutablePath,
    chromiumExecutableExists,
    browserLaunchSuccess,
    browserLaunchError,
    hostingHint,
  });

  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    playwrightVersion,
    playwrightImportOk,
    playwrightBrowsersPath: getPlaywrightBrowsersPath(),
    chromiumExecutablePath,
    chromiumExecutableExists,
    browserLaunchSuccess,
    browserLaunchError,
    hostingHint,
    renderGitCommit: process.env.RENDER_GIT_COMMIT || null,
  };
}

export async function renderQuotationHtmlToPdf(
  html: string,
  options?: { javaScriptEnabled?: boolean }
): Promise<Buffer> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(PDF_ENGINE_MISSING_MESSAGE);
  }

  let browser;
  try {
    browser = await chromium.launch({
      ...CHROMIUM_LAUNCH_OPTIONS,
      env: playwrightInstallEnv(),
    });
  } catch (err) {
    if (!isMissingBrowserError(err)) throw err;
    console.warn("[PDF] Chromium missing at launch — attempting runtime install…", {
      path: getPlaywrightBrowsersPath(),
      message: String((err as any)?.message || err),
    });
    await installChromiumAtRuntime();
    browser = await chromium.launch({
      ...CHROMIUM_LAUNCH_OPTIONS,
      env: playwrightInstallEnv(),
    });
  }

  try {
    const javaScriptEnabled = options?.javaScriptEnabled !== false;
    const context = await browser.newContext({ javaScriptEnabled });
    const page = await context.newPage();
    const pdfBaseUrl = getQuotePdfAppBaseUrl();
    await page.setContent(html, {
      waitUntil: javaScriptEnabled ? "networkidle" : "load",
      timeout: 120_000,
      baseURL: pdfBaseUrl,
    });
    await page.emulateMedia({ media: "print" });
    if (javaScriptEnabled) {
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });
      await page.waitForTimeout(350);
    } else {
      await page.waitForTimeout(200);
    }

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      displayHeaderFooter: false,
    });
    await page.close();
    await context.close();
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
            var token = null;
            try { token = localStorage.getItem('sunchaser_auth_token'); } catch (_err) {}
            var headers = token ? { Authorization: 'Bearer ' + token } : {};
            var res = await fetch(url, { headers: headers });
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
