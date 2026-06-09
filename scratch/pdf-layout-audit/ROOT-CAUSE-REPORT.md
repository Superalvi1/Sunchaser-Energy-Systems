# PDF Layout Audit — Root Cause Report

## Pipeline

Quotation PDFs are **HTML-first**: `compileSunchaserPDFHtml()` in `server.ts` builds a multi-page HTML deck. Clients save/print via browser PDF (Chrome, Safari/iPhone, Android, Adobe). There is **no Puppeteer/jsPDF/html2pdf** step in this path.

## Symptoms (mobile PDF viewers)

| Symptom | Root cause |
|--------|------------|
| Footer overlapping content | `.page` used fixed `height: 297mm` + `overflow: hidden` while footer sat in the same flex column as body. Overflow clipped body text and footer visually collided with content on strict mobile renderers. |
| Header/footer colliding between pages | `@page { margin: 0 }` combined with per-page `padding: 15–22mm` and `page-break-after: always` on fixed-height boxes — double layout model. Mobile engines placed breaks at CSS box boundaries, not printable area boundaries. |
| Large white gaps (especially cover) | `.page { justify-content: space-between }` plus cover inline `justify-content: space-between` stretched sparse cover content across full 297mm. |
| Content cut before page end | `overflow: hidden` on `.page` truncated BOQ/terms when content exceeded the fixed box. |
| Incorrect page breaks | Missing `break-after` / `break-inside` controls; only legacy `page-break-*` on fixed-height containers. |

## Fixes applied

1. **`quotePdfShellCss()`** (`src/lib/quotePdfLayout.ts`) — canonical shell:
   - `@page { size: A4; margin: 20mm; }`
   - `.page { break-after: page; overflow: visible; flex column; min-height for screen preview }`
   - `.section` / `.card` / `.grid-2` / headers: `break-inside: avoid`
   - `.page-footer { position: static; margin-top: auto; flex-shrink: 0 }` — **no `position: absolute`**
   - Print media: zero page padding, `min-height: 257mm` (printable area), remove shadows

2. **`server.ts`** — removed conflicting inline `height/min-height/padding` on page divs; cover uses `cover-main` / `cover-footer-block` with `justify-content: flex-start`; footer inline styles trimmed to dynamic colors only.

3. **`quoteAuthoring.ts`** — authoring pages inherit shell flex; explicit `break-after: page` in print.

## Verification artifacts

| Artifact | Path |
|----------|------|
| Before HTML (production) | `scratch/pdf-layout-audit/before-preview.html` |
| After HTML (patched shell CSS) | `scratch/pdf-layout-audit/after-preview.html` |
| Before PDF + screenshot | `scratch/pdf-layout-audit/before-fix.pdf`, `before-fix-full.png` |
| After PDF + screenshot | `scratch/pdf-layout-audit/after-fix.pdf`, `after-fix-full.png` |

**Page counts (tmpl-1 preview, production data):** 6 logical `.page` divs → before PDF 6 pages, after PDF 7 pages (one page of previously clipped content now flows instead of being hidden).

Re-run audit locally:

```bash
node scratch/pdf-layout-audit/generate-after-preview.mjs
node scratch/pdf-layout-audit/capture-chrome.mjs
API_BASE=http://localhost:3000 node scripts/verify-pdf-layout.mjs
```

## Viewer notes

- **Chrome PDF / Adobe**: Respect `@page` margins and `break-after` reliably.
- **iPhone/Android**: Benefit most from removing fixed height + `overflow: hidden` and using flow footers with reserved flex space.
- **Cover whitespace**: Reduced via `flex-start` layout and tighter cover meta margins (`35px → 20px`, `40px → 16px`).
