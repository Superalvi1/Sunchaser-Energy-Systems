from pathlib import Path
import re

pdf = Path("src/lib/quotePdfExport.ts")
s = pdf.read_text()

s = s.replace(
    'import { Directory, Filesystem } from "@capacitor/filesystem";\nimport { Share } from "@capacitor/share";\nimport { API_BASE_URL, authorizedFetch } from "../services/api";',
    'import { Directory, Filesystem } from "@capacitor/filesystem";\nimport { FileTransfer } from "@capacitor/file-transfer";\nimport { FileViewer } from "@capacitor/file-viewer";\nimport { API_BASE_URL, authorizedFetch, getStoredAuthToken } from "../services/api";'
)

s = re.sub(
    r'async function blobToBase64\(blob: Blob\): Promise<string> \{.*?\n\}\n\n',
    '',
    s,
    count=1,
    flags=re.S,
)

helper_marker = 'function safePdfFilename(filename: string): string {'
helper_end = s.index('\n}\n\nasync function triggerBlobDownload', s.index(helper_marker)) + 3
if 'async function nativeDownloadAndOpenPdf' not in s:
    native_helpers = r'''

function absoluteApiUrl(pathOrUrl: string): string {
  return pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE_URL}${pathOrUrl}`;
}

function nativeAuthHeaders(): Record<string, string> {
  const token = getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function nativeDownloadAndOpenPdf(url: string, filename: string): Promise<void> {
  const safeName = safePdfFilename(filename);
  const uniqueName = `${Date.now()}-${safeName}`;
  let targetUri: string;

  try {
    await Filesystem.mkdir({
      path: "Sunchaser",
      directory: Directory.Documents,
      recursive: true,
    });
    const target = await Filesystem.getUri({
      path: `Sunchaser/${uniqueName}`,
      directory: Directory.Documents,
    });
    targetUri = target.uri;
  } catch {
    const target = await Filesystem.getUri({
      path: uniqueName,
      directory: Directory.Cache,
    });
    targetUri = target.uri;
  }

  let localPath = targetUri;
  try {
    const result = await FileTransfer.downloadFile({
      url: absoluteApiUrl(url),
      path: targetUri,
      headers: nativeAuthHeaders(),
      progress: false,
      method: "GET",
      readTimeout: 120000,
      connectTimeout: 60000,
    });
    localPath = result.path || targetUri;
  } catch (error: any) {
    console.error("Native PDF transfer failed", error);
    throw new Error(error?.message || "Could not download the generated PDF to this device.");
  }

  try {
    await FileViewer.openDocumentFromLocalPath({ path: localPath });
  } catch (error: any) {
    console.error("Native PDF viewer failed", error);
    throw new Error(
      "PDF downloaded successfully, but Android could not open it. Check the Sunchaser folder in Documents."
    );
  }
}
'''
    s = s[:helper_end] + native_helpers + s[helper_end:]

native_block_pattern = r'\n  if \(Capacitor\.isNativePlatform\(\)\) \{.*?\n  return;\n\}\n\n  const objectUrl = URL\.createObjectURL\(blob\);'
s, n = re.subn(
    native_block_pattern,
    '\n  if (Capacitor.isNativePlatform()) {\n    throw new Error("This Android PDF export must use the native downloader.");\n  }\n\n  const objectUrl = URL.createObjectURL(blob);',
    s,
    count=1,
    flags=re.S,
)
if n != 1 and 'This Android PDF export must use the native downloader.' not in s:
    raise SystemExit('Could not replace old native blob/share path')

quick_start = s.index('export async function downloadEphemeralManualQuotePdf')
quick_end = s.index('/** Direct PDF file download', quick_start)
quick_fn = '''export async function downloadEphemeralManualQuotePdf(payload: unknown): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const stageRes = await authorizedFetch(`${API_BASE_URL}/api/export/pdf/manual-quote?stage=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!stageRes.ok) {
      const text = await stageRes.text().catch(() => "");
      throw new Error(friendlyPdfError(stageRes.status, text));
    }
    const staged = await stageRes.json() as { downloadUrl?: string; filename?: string };
    if (!staged.downloadUrl) throw new Error("PDF staging did not return a download URL.");
    await nativeDownloadAndOpenPdf(
      staged.downloadUrl,
      staged.filename || "Sunchaser-Quotation.pdf"
    );
    return;
  }

  const res = await authorizedFetch(ephemeralManualQuotePdfDownloadUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}

'''
s = s[:quick_start] + quick_fn + s[quick_end:]

manual_start = s.index('export async function downloadManualQuotePdf')
manual_end = s.index('/** Direct AutoSizer PDF file download', manual_start)
manual_fn = '''export async function downloadManualQuotePdf(leadId: string, quoteId?: string): Promise<void> {
  const url = manualQuotePdfDownloadUrl(leadId, quoteId);
  if (Capacitor.isNativePlatform()) {
    await nativeDownloadAndOpenPdf(url, "Sunchaser-Quotation.pdf");
    return;
  }
  const res = await authorizedFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}

'''
s = s[:manual_start] + manual_fn + s[manual_end:]

auto_start = s.index('export async function downloadAutoSizerQuotePdf')
auto_end = s.index('export function manualQuotePdfDebugHtmlUrl', auto_start)
auto_fn = '''export async function downloadAutoSizerQuotePdf(leadId: string, quoteId?: string): Promise<void> {
  const url = autoSizerQuotePdfDownloadUrl(leadId, quoteId);
  if (Capacitor.isNativePlatform()) {
    await nativeDownloadAndOpenPdf(url, "Sunchaser-AutoSizer-Quotation.pdf");
    return;
  }
  const res = await authorizedFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(friendlyPdfError(res.status, text));
  }
  await triggerBlobDownload(res);
}

'''
s = s[:auto_start] + auto_fn + s[auto_end:]
pdf.write_text(s)

server = Path('server.ts')
sv = server.read_text()
helper_marker = 'async function sendQuotationPdfResponse('
if 'const stagedQuotationPdfs = new Map' not in sv:
    stage_helpers = '''const STAGED_QUOTATION_PDF_TTL_MS = 5 * 60 * 1000;\nconst stagedQuotationPdfs = new Map<string, { buffer: Buffer; filename: string; expiresAt: number }>();\n\nfunction cleanupStagedQuotationPdfs(now = Date.now()): void {\n  for (const [token, entry] of stagedQuotationPdfs.entries()) {\n    if (entry.expiresAt <= now) stagedQuotationPdfs.delete(token);\n  }\n}\n\nfunction stageQuotationPdf(buffer: Buffer, filename: string): string {\n  cleanupStagedQuotationPdfs();\n  const token = randomUUID();\n  stagedQuotationPdfs.set(token, {\n    buffer,\n    filename,\n    expiresAt: Date.now() + STAGED_QUOTATION_PDF_TTL_MS,\n  });\n  return token;\n}\n\nfunction takeStagedQuotationPdf(token: string) {\n  cleanupStagedQuotationPdfs();\n  const entry = stagedQuotationPdfs.get(token);\n  if (!entry) return null;\n  stagedQuotationPdfs.delete(token);\n  return entry;\n}\n\n'''
    idx = sv.index(helper_marker)
    sv = sv[:idx] + stage_helpers + sv[idx:]

route_start = sv.index('app.post("/api/export/pdf/manual-quote"')
route_end = sv.index('function buildTemplatePreviewMockData', route_start)
route = sv[route_start:route_end]
route = route.replace(
    'hideActionBar: req.query.download === "1",',
    'hideActionBar: req.query.download === "1" || req.query.stage === "1",'
)
if 'req.query.stage === "1"' not in route:
    marker = '    if (req.query.download === "1") {'
    stage_branch = '''    if (req.query.stage === "1") {\n      if (rendered.exportBlocked) {\n        return res.status(409).type("text/plain").send(\n          rendered.exportBlockReason || "Quotation cannot be exported in the standard 3-page format."\n        );\n      }\n      const filename = buildQuotationPdfFilename(lead, quoteForExport);\n      const pdfBuffer = await renderQuotationHtmlToPdf(rendered.html);\n      const token = stageQuotationPdf(pdfBuffer, filename);\n      return res.json({\n        downloadUrl: `/api/export/pdf/staged/${token}`,\n        filename,\n        expiresInSeconds: STAGED_QUOTATION_PDF_TTL_MS / 1000,\n      });\n    }\n\n'''
    if marker not in route:
        raise SystemExit('Could not find manual quote download branch')
    route = route.replace(marker, stage_branch + marker, 1)
sv = sv[:route_start] + route + sv[route_end:]

if 'app.get("/api/export/pdf/staged/:token"' not in sv:
    marker = 'app.get("/api/export/pdf/manual-quote/:leadId/debug-template-map"'
    idx = sv.index(marker)
    staged_route = '''app.get("/api/export/pdf/staged/:token", (req, res) => {\n  const staff = resolveStaffActor(req, res);\n  if (!staff) return;\n  const staged = takeStagedQuotationPdf(String(req.params.token || ""));\n  if (!staged) {\n    return res.status(404).type("text/plain").send("This PDF download has expired. Generate it again.");\n  }\n  res.setHeader("Content-Type", "application/pdf");\n  res.setHeader("Content-Disposition", `attachment; filename="${staged.filename.replace(/[^\\w.\\-]+/g, "_")}"`);\n  res.setHeader("Cache-Control", "no-store");\n  return res.send(staged.buffer);\n});\n\n'''
    sv = sv[:idx] + staged_route + sv[idx:]
server.write_text(sv)

test = Path('src/lib/quickQuotationMode.test.ts')
t = test.read_text()
t = re.sub(
    r'check\("Quick PDF posts current editor payload to ephemeral manual PDF route".*?\n\}\);',
    '''check("Quick PDF stages on Android and downloads natively without CRM persistence", () => {\n  assert.match(pdf, /manual-quote\\?stage=1/);\n  assert.match(pdf, /FileTransfer\\.downloadFile/);\n  assert.match(pdf, /FileViewer\\.openDocumentFromLocalPath/);\n  assert.match(sales, /downloadEphemeralManualQuotePdf\\(quickQuotePayloadRef\\.current\\)/);\n});''',
    t,
    count=1,
    flags=re.S,
)
t = re.sub(
    r'check\("native PDF path writes a file and opens Android save/share sheet".*?\n\}\);',
    '''check("native PDF path streams with FileTransfer instead of blob/Base64/Share", () => {\n  assert.match(pdf, /FileTransfer\\.downloadFile/);\n  assert.match(pdf, /FileViewer\\.openDocumentFromLocalPath/);\n  assert.match(pdf, /Directory\\.Documents/);\n  assert.doesNotMatch(pdf, /Share\\.share/);\n  assert.doesNotMatch(pdf, /blobToBase64/);\n});''',
    t,
    count=1,
    flags=re.S,
)
if 'server staged PDF route is authenticated and one-time' not in t:
    insert = '''\ncheck("server staged PDF route is authenticated and one-time", () => {\n  assert.match(server, /app\\.get\\("\\/api\\/export\\/pdf\\/staged\\/:token"/);\n  assert.match(server, /resolveStaffActor\\(req, res\\)/);\n  assert.match(server, /takeStagedQuotationPdf/);\n  assert.match(server, /Cache-Control", "no-store"/);\n});\n'''
    t = t.replace('check("browser PDF path still uses standard anchor download"', insert + '\ncheck("browser PDF path still uses standard anchor download"')
test.write_text(t)

gradle = Path('android/app/build.gradle')
g = gradle.read_text().replace('versionCode 12', 'versionCode 13').replace('versionName "1.0.9"', 'versionName "1.0.10"')
gradle.write_text(g)
