/** Global quotation PDF settings persistence helpers (save/load only). */

export const QUOTE_PDF_GLOBAL_WATERMARK_KEY = "quote_pdf_global_watermark";

export type GlobalWatermarkValue = {
  imageUrl?: string;
  opacity?: number;
  position?: "center" | "cover" | "contain";
  repeat?: "no-repeat" | "repeat";
};

export function normalizeGlobalWatermark(
  raw: unknown
): GlobalWatermarkValue | null {
  if (!raw || typeof raw !== "object") return null;
  const wm = raw as GlobalWatermarkValue;
  const imageUrl = String(wm.imageUrl || "").trim();
  if (!imageUrl) return null;
  return {
    imageUrl,
    opacity: wm.opacity ?? 0.08,
    position: wm.position || "center",
    repeat: wm.repeat || "no-repeat",
  };
}

export function resolveStoredGlobalWatermark(
  pdfRow: Record<string, unknown> | null | undefined,
  settingsRows?: Array<{ key?: string; value?: unknown }>
): GlobalWatermarkValue | null {
  const fromRow = normalizeGlobalWatermark(
    pdfRow?.global_watermark ||
      pdfRow?.globalWatermark ||
      (pdfRow?.global_pdf_header as any)?.watermark ||
      (pdfRow?.globalPdfHeader as any)?.watermark
  );
  if (fromRow) return fromRow;

  const setting = (settingsRows || []).find(
    (s) => s.key === QUOTE_PDF_GLOBAL_WATERMARK_KEY
  );
  return normalizeGlobalWatermark(setting?.value);
}

export function applyGlobalWatermarkToPdfSettingsRow<T extends Record<string, unknown>>(
  row: T,
  watermark: GlobalWatermarkValue | null
): T {
  if (!watermark) {
    return { ...row, globalWatermark: null };
  }
  const header =
    row.globalPdfHeader && typeof row.globalPdfHeader === "object"
      ? { ...(row.globalPdfHeader as object), watermark }
      : { watermark };
  return {
    ...row,
    globalWatermark: watermark,
    globalPdfHeader: header,
  };
}

export function buildQuotePdfSettingsSupabasePayload(data: Record<string, unknown>) {
  const headerPayload =
    (data.globalPdfHeader as Record<string, unknown> | null | undefined) ||
    (data.global_pdf_header as Record<string, unknown> | null | undefined) ||
    null;
  const watermarkPayload = normalizeGlobalWatermark(
    data.globalWatermark || data.global_watermark || headerPayload?.watermark
  );
  const headerWithWatermark =
    watermarkPayload && headerPayload
      ? { ...headerPayload, watermark: watermarkPayload }
      : watermarkPayload && !headerPayload
        ? { watermark: watermarkPayload }
        : headerPayload;

  const scalarRow = {
    id: data.id,
    company_name: data.companyName || data.company_name,
    office_address: data.officeAddress || data.office_address,
    hotline_phones: data.hotlinePhones || data.hotline_phones,
    billing_email: data.billingEmail || data.billing_email,
    website_url: data.websiteUrl || data.website_url,
    logo_url: data.logoUrl || data.logo_url || "",
    use_default_company_content: !!(data.useDefaultCompanyContent ?? data.use_default_company_content),
  };

  const jsonbRow = {
    id: data.id,
    global_pdf_header: headerWithWatermark,
    global_pdf_footer: data.globalPdfFooter || data.global_pdf_footer || null,
    global_watermark: watermarkPayload,
  };

  return { scalarRow, jsonbRow, watermarkPayload };
}
