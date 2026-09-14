from pathlib import Path
import re

pdf = Path('src/lib/quotePdfExport.ts')
s = pdf.read_text()

s = s.replace('import { Directory, Filesystem } from "@capacitor/filesystem";\nimport { Share } from "@capacitor/share";\n', '')
if 'import { Browser } from "@capacitor/browser";' not in s:
    s = s.replace('import { Capacitor } from "@capacitor/core";\n', 'import { Capacitor } from "@capacitor/core";\nimport { Browser } from "@capacitor/browser";\n')
s = re.sub(r'async function blobToBase64\(blob: Blob\): Promise<string> \{.*?\n\}\n\n', '', s, count=1, flags=re.S)
pattern = r'\n  if \(Capacitor\.isNativePlatform\(\)\) \{.*?\n  return;\n\}\n\n  const objectUrl = URL\.createObjectURL\(blob\);'
replacement = '\n  if (Capacitor.isNativePlatform()) {\n    throw new Error("Android PDF export must use the external browser handoff.");\n  }\n\n  const objectUrl = URL.createObjectURL(blob);'
s, n = re.subn(pattern, replacement, s, count=1, flags=re.S)
if n != 1 and 'Android PDF export must use the external browser handoff.' not in s:
    raise SystemExit('Could not replace native blob/share path')
helper_marker = 'export function ephemeralManualQuotePdfDownloadUrl(): string {'
helper = '''async function openAndroidStagedPdf(stagePath: string, init?: RequestInit): Promise<void> {\n  const res = await authorizedFetch(stagePath, init);\n  if (!res.ok) {\n    const text = await res.text().catch(() => "");\n    throw new Error(friendlyPdfError(res.status, text));\n  }\n  const staged = await res.json() as { downloadUrl?: string };\n  if (!staged.downloadUrl) throw new Error("PDF staging did not return a download link.");\n  const url = staged.downloadUrl.startsWith("http")\n    ? staged.downloadUrl\n    : `${API_BASE_URL}${staged.downloadUrl}`;\n  await Browser.open({ url });\n}\n\n'''
if 'openAndroidStagedPdf' not in s:
    idx = s.index(helper_marker)
    s = s[:idx] + helper + s[idx:]
start = s.index('export async function downloadEphemeralManualQuotePdf')
end = s.index('/** Direct PDF file download', start)
quick = '''export async function downloadEphemeralManualQuotePdf(payload: unknown): Promise<void> {\n  if (Capacitor.isNativePlatform()) {\n    await openAndroidStagedPdf('/api/export/pdf/manual-quote?stage=1', {\n      method: "POST",\n      headers: { "Content-Type": "application/json" },\n      body: JSON.stringify(payload),\n    });\n    return;\n  }\n  const res = await authorizedFetch(ephemeralManualQuotePdfDownloadUrl(), {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify(payload),\n  });\n  if (!res.ok) {\n    const text = await res.text().catch(() => "");\n    throw new Error(friendlyPdfError(res.status, text));\n  }\n  await triggerBlobDownload(res);\n}\n\n'''
s = s[:start] + quick + s[end:]
start = s.index('export async function downloadManualQuotePdf')
end = s.index('/** Direct AutoSizer PDF file download', start)
manual = '''export async function downloadManualQuotePdf(leadId: string, quoteId?: string): Promise<void> {\n  if (Capacitor.isNativePlatform()) {\n    await openAndroidStagedPdf('/api/export/pdf/stage-saved-quote', {\n      method: "POST",\n      headers: { "Content-Type": "application/json" },\n      body: JSON.stringify({ leadId, quoteId, quoteType: "manual_boq" }),\n    });\n    return;\n  }\n  const res = await authorizedFetch(manualQuotePdfDownloadUrl(leadId, quoteId));\n  if (!res.ok) {\n    const text = await res.text().catch(() => "");\n    throw new Error(friendlyPdfError(res.status, text));\n  }\n  await triggerBlobDownload(res);\n}\n\n'''
s = s[:start] + manual + s[end:]
start = s.index('export async function downloadAutoSizerQuotePdf')
end = s.index('export function manualQuotePdfDebugHtmlUrl', start)
auto = '''export async function downloadAutoSizerQuotePdf(leadId: string, quoteId?: string): Promise<void> {\n  if (Capacitor.isNativePlatform()) {\n    await openAndroidStagedPdf('/api/export/pdf/stage-saved-quote', {\n      method: "POST",\n      headers: { "Content-Type": "application/json" },\n      body: JSON.stringify({ leadId, quoteId, quoteType: "auto_sizer" }),\n    });\n    return;\n  }\n  const res = await authorizedFetch(autoSizerQuotePdfDownloadUrl(leadId, quoteId));\n  if (!res.ok) {\n    const text = await res.text().catch(() => "");\n    throw new Error(friendlyPdfError(res.status, text));\n  }\n  await triggerBlobDownload(res);\n}\n\n'''
s = s[:start] + auto + s[end:]
pdf.write_text(s)

server = Path('server.ts')
sv = server.read_text()
helper_marker = 'async function sendQuotationPdfResponse('
if 'const stagedQuotationPdfs = new Map' not in sv:
    stage_helpers = '''const STAGED_QUOTATION_PDF_TTL_MS = 2 * 60 * 1000;\nconst stagedQuotationPdfs = new Map<string, { buffer: Buffer; filename: string; expiresAt: number }>();\n\nfunction cleanupStagedQuotationPdfs(now = Date.now()): void {\n  for (const [token, entry] of stagedQuotationPdfs.entries()) {\n    if (entry.expiresAt <= now) stagedQuotationPdfs.delete(token);\n  }\n}\n\nfunction stageQuotationPdf(buffer: Buffer, filename: string): string {\n  cleanupStagedQuotationPdfs();\n  const token = randomUUID();\n  stagedQuotationPdfs.set(token, { buffer, filename, expiresAt: Date.now() + STAGED_QUOTATION_PDF_TTL_MS });\n  return token;\n}\n\nfunction takeStagedQuotationPdf(token: string) {\n  cleanupStagedQuotationPdfs();\n  const entry = stagedQuotationPdfs.get(token);\n  if (!entry) return null;\n  stagedQuotationPdfs.delete(token);\n  return entry;\n}\n\n'''
    idx = sv.index(helper_marker)
    sv = sv[:idx] + stage_helpers + sv[idx:]
route_start = sv.index('app.post("/api/export/pdf/manual-quote"')
route_end = sv.index('function buildTemplatePreviewMockData', route_start)
route = sv[route_start:route_end]
route = route.replace('hideActionBar: req.query.download === "1",', 'hideActionBar: req.query.download === "1" || req.query.stage === "1",')
if 'req.query.stage === "1"' not in route:
    marker = '    if (req.query.download === "1") {'
    branch = '''    if (req.query.stage === "1") {\n      if (rendered.exportBlocked) {\n        return res.status(409).type("text/plain").send(rendered.exportBlockReason || "Quotation cannot be exported in the standard 3-page format.");\n      }\n      const filename = buildQuotationPdfFilename(lead, quoteForExport);\n      const pdfBuffer = await renderQuotationHtmlToPdf(rendered.html);\n      const token = stageQuotationPdf(pdfBuffer, filename);\n      return res.json({ downloadUrl: `/api/export/pdf/staged-public/${token}`, filename, expiresInSeconds: 120 });\n    }\n\n'''
    if marker not in route:
        raise SystemExit('Could not find quick quotation download branch')
    route = route.replace(marker, branch + marker, 1)
sv = sv[:route_start] + route + sv[route_end:]
if 'app.post("/api/export/pdf/stage-saved-quote"' not in sv:
    marker = 'app.get("/api/export/pdf/manual-quote/:leadId/debug-template-map"'
    idx = sv.index(marker)
    saved_route = '''app.post("/api/export/pdf/stage-saved-quote", async (req, res) => {\n  const staff = resolveStaffActor(req, res);\n  if (!staff) return;\n  try {\n    const leadId = String(req.body?.leadId || "");\n    const quoteId = req.body?.quoteId ? String(req.body.quoteId) : "";\n    if (!leadId) return res.status(400).json({ error: "leadId is required" });\n    if (!(await guardSalesOwnedResource(req, res, "manual_quote_export", leadId))) return;\n    loadDb();\n    let activeState: Database = db;\n    if (isSupabaseActive()) activeState = await fetchAppStateFromSupabase();\n    const lead = activeState.leads.find((item: any) => String(item.id) === leadId);\n    if (!lead) return res.status(404).json({ error: "Lead not found" });\n    const quotes = (activeState.quotes || []).filter((q: any) => String(q.lead_id) === leadId);\n    const quote = quoteId ? quotes.find((q: any) => String(q.id) === quoteId) : quotes[quotes.length - 1];\n    if (!quote) return res.status(404).json({ error: "Save a quote first." });\n    const rendered = compileManualQuoteExportHtml(activeState, quote, lead, { hideActionBar: true });\n    if (rendered.exportBlocked) return res.status(409).json({ error: rendered.exportBlockReason || "Quotation cannot be exported." });\n    const filename = buildQuotationPdfFilename(lead, quote);\n    const pdfBuffer = await renderQuotationHtmlToPdf(rendered.html);\n    const token = stageQuotationPdf(pdfBuffer, filename);\n    return res.json({ downloadUrl: `/api/export/pdf/staged-public/${token}`, filename, expiresInSeconds: 120 });\n  } catch (err: any) {\n    console.error("[PDF STAGE SAVED QUOTE]", err);\n    return res.status(500).json({ error: formatQuotationPdfError(err) });\n  }\n});\n\n'''
    sv = sv[:idx] + saved_route + sv[idx:]
if 'app.get("/api/export/pdf/staged-public/:token"' not in sv:
    marker = 'app.get("/api/export/pdf/manual-quote/:leadId/debug-template-map"'
    idx = sv.index(marker)
    public_route = '''app.get("/api/export/pdf/staged-public/:token", (req, res) => {\n  const staged = takeStagedQuotationPdf(String(req.params.token || ""));\n  if (!staged) {\n    return res.status(404).type("text/plain").send("This PDF link has expired or was already used. Generate it again.");\n  }\n  res.setHeader("Content-Type", "application/pdf");\n  res.setHeader("Content-Disposition", `attachment; filename="${staged.filename.replace(/[^\\w.\\-]+/g, "_")}"`);\n  res.setHeader("Cache-Control", "no-store");\n  res.setHeader("Pragma", "no-cache");\n  return res.send(staged.buffer);\n});\n\n'''
    sv = sv[:idx] + public_route + sv[idx:]
server.write_text(sv)

test = Path('src/lib/quickQuotationMode.test.ts')
t = test.read_text()
t = re.sub(r'check\("native PDF path writes a file and opens Android save/share sheet".*?\n\}\);', '''check("native PDF path uses one-time Browser handoff and no file/share bridge", () => {\n  assert.match(pdf, /Browser\\.open/);\n  assert.match(pdf, /openAndroidStagedPdf/);\n  assert.doesNotMatch(pdf, /Share\\.share/);\n  assert.doesNotMatch(pdf, /Filesystem\\.writeFile/);\n  assert.doesNotMatch(pdf, /FileTransfer\\.downloadFile/);\n  assert.doesNotMatch(pdf, /FileViewer\\.openDocumentFromLocalPath/);\n});''', t, count=1, flags=re.S)
if 'staged-public' not in t:
    t = t.replace('check("browser PDF path still uses standard anchor download"', '''check("server issues short-lived one-time public PDF URLs for Android browser", () => {\n  assert.match(server, /staged-public\\/:token/);\n  assert.match(server, /takeStagedQuotationPdf/);\n  assert.match(server, /STAGED_QUOTATION_PDF_TTL_MS = 2 \\* 60 \\* 1000/);\n  assert.match(server, /Cache-Control", "no-store"/);\n});\n\ncheck("browser PDF path still uses standard anchor download"''')
test.write_text(t)

gradle = Path('android/app/build.gradle')
g = gradle.read_text().replace('versionCode 12', 'versionCode 14').replace('versionName "1.0.9"', 'versionName "1.0.11"')
gradle.write_text(g)
