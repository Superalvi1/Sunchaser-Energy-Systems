from pathlib import Path

server = Path('server.ts')
s = server.read_text()
needle = '''    if (req.query.download === "1") {\n      if (rendered.exportBlocked) {\n        return res.status(409).type("text/plain").send(\n          rendered.exportBlockReason || "Quotation cannot be exported in the standard 3-page format."\n        );\n      }\n      const filename = buildQuotationPdfFilename(lead, quoteForExport);\n      await sendQuotationPdfResponse(res, rendered.html, filename);\n      return;\n    }\n    res.send(rendered.html);'''
replacement = '''    if (req.query.stage === "1") {\n      if (rendered.exportBlocked) {\n        return res.status(409).type("text/plain").send(\n          rendered.exportBlockReason || "Quotation cannot be exported in the standard 3-page format."\n        );\n      }\n      const filename = buildQuotationPdfFilename(lead, quoteForExport);\n      const pdfBuffer = await renderQuotationHtmlToPdf(rendered.html);\n      const token = stageQuotationPdf(pdfBuffer, filename);\n      return res.json({\n        downloadUrl: `/api/export/pdf/staged-public/${token}`,\n        filename,\n        expiresInSeconds: 120,\n      });\n    }\n    if (req.query.download === "1") {\n      if (rendered.exportBlocked) {\n        return res.status(409).type("text/plain").send(\n          rendered.exportBlockReason || "Quotation cannot be exported in the standard 3-page format."\n        );\n      }\n      const filename = buildQuotationPdfFilename(lead, quoteForExport);\n      await sendQuotationPdfResponse(res, rendered.html, filename);\n      return;\n    }\n    res.send(rendered.html);'''
if needle not in s:
    if 'downloadUrl: `/api/export/pdf/staged-public/${token}`' not in s[s.index('app.post("/api/export/pdf/manual-quote"'):s.index('function buildTemplatePreviewMockData')]:
        raise SystemExit('Quick stage insertion point not found')
else:
    s = s.replace(needle, replacement, 1)
server.write_text(s)

test = Path('src/lib/quickQuotationMode.test.ts')
t = test.read_text()
old = '''check("Quick PDF posts current editor payload to ephemeral manual PDF route", () => {\n  assert.match(pdf, /ephemeralManualQuotePdfDownloadUrl/);\n  assert.match(pdf, /manual-quote\\?download=1/);\n  assert.match(pdf, /method: "POST"/);\n  assert.match(sales, /downloadEphemeralManualQuotePdf\\(quickQuotePayloadRef\\.current\\)/);\n});'''
new = '''check("Quick PDF stages Android export and keeps browser download route", () => {\n  assert.match(pdf, /manual-quote\\?stage=1/);\n  assert.match(pdf, /manual-quote\\?download=1/);\n  assert.match(pdf, /method: "POST"/);\n  assert.match(sales, /downloadEphemeralManualQuotePdf\\(quickQuotePayloadRef\\.current\\)/);\n  const start = server.indexOf('app.post("/api/export/pdf/manual-quote"');\n  const end = server.indexOf("function buildTemplatePreviewMockData", start);\n  const route = server.slice(start, end);\n  assert.match(route, /req\\.query\\.stage === "1"/);\n  assert.match(route, /stageQuotationPdf\\(pdfBuffer, filename\\)/);\n  assert.match(route, /downloadUrl: `\\/api\\/export\\/pdf\\/staged-public\\/\\$\\{token\\}`/);\n});'''
if old in t:
    t = t.replace(old, new, 1)
elif 'Quick PDF stages Android export and keeps browser download route' not in t:
    raise SystemExit('Quick PDF test insertion point not found')
test.write_text(t)
