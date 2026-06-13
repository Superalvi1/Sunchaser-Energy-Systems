export const PDF_ENGINE_MISSING_MESSAGE =
  "PDF engine is not installed on server. Redeploy with: npx playwright install chromium --with-deps";

export function formatQuotationPdfError(err: unknown): string {
  const msg = String((err as any)?.message || err || "");
  if (/executable doesn't exist|please run the following command|playwright install|browserType\.launch/i.test(msg)) {
    return PDF_ENGINE_MISSING_MESSAGE;
  }
  if (/Playwright is required/i.test(msg)) {
    return PDF_ENGINE_MISSING_MESSAGE;
  }
  return msg || "PDF generation failed.";
}
