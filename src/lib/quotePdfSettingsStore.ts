/** Global quotation PDF settings persistence helpers (save/load only). */

export const QUOTE_PDF_GLOBAL_WATERMARK_KEY = "quote_pdf_global_watermark";
export const QUOTE_ASSETS_BUCKET = "quote-assets";

export type GlobalWatermarkValue = {
  imageUrl?: string;
  globalWatermarkFile?: string;
  opacity?: number;
  position?: "center" | "cover" | "contain";
  repeat?: "no-repeat" | "repeat";
};

export function getSupabaseProjectUrlFromEnv(): string {
  let url = process.env.SUPABASE_URL || "";
  if (url.endsWith("/rest/v1/")) url = url.slice(0, -"/rest/v1/".length);
  else if (url.endsWith("/rest/v1")) url = url.slice(0, -"/rest/v1".length);
  return url.replace(/\/$/, "");
}

export function getQuoteAssetPublicUrl(storagePath: string, baseUrl?: string): string {
  const normalized = String(storagePath || "").trim().replace(/^\/+/, "");
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/uploads/")) return normalized;

  const projectUrl = (baseUrl || getSupabaseProjectUrlFromEnv()).replace(/\/$/, "");
  if (projectUrl) {
    return `${projectUrl}/storage/v1/object/public/${QUOTE_ASSETS_BUCKET}/${normalized}`;
  }
  return `/uploads/quote-assets/${normalized}`;
}

export function resolveGlobalWatermarkImageUrl(
  wm: GlobalWatermarkValue | null | undefined,
  baseUrl?: string
): string {
  if (!wm) return "";
  const file = String(wm.globalWatermarkFile || "").trim();
  if (file) {
    return getQuoteAssetPublicUrl(file, baseUrl);
  }
  return String(wm.imageUrl || "").trim();
}

export function normalizeGlobalWatermark(
  raw: unknown
): GlobalWatermarkValue | null {
  if (!raw || typeof raw !== "object") return null;
  const wm = raw as GlobalWatermarkValue;
  const globalWatermarkFile = String(wm.globalWatermarkFile || "").trim();
  const imageUrl = String(wm.imageUrl || "").trim();
  if (!globalWatermarkFile && !imageUrl) return null;
  return {
    imageUrl: imageUrl || undefined,
    globalWatermarkFile: globalWatermarkFile || undefined,
    opacity: wm.opacity ?? 0.08,
    position: wm.position || "center",
    repeat: wm.repeat || "no-repeat",
  };
}

export function withResolvedGlobalWatermark(
  wm: GlobalWatermarkValue | null | undefined,
  baseUrl?: string
): GlobalWatermarkValue | null {
  const normalized = normalizeGlobalWatermark(wm);
  if (!normalized) return null;
  const resolvedUrl = resolveGlobalWatermarkImageUrl(normalized, baseUrl);
  if (!resolvedUrl) return null;
  return { ...normalized, imageUrl: resolvedUrl };
}

export function resolveStoredGlobalWatermark(
  pdfRow: Record<string, unknown> | null | undefined,
  settingsRows?: Array<{ key?: string; value?: unknown }>,
  baseUrl?: string
): GlobalWatermarkValue | null {
  const fromRow = withResolvedGlobalWatermark(
    (pdfRow?.global_watermark ||
      pdfRow?.globalWatermark ||
      (pdfRow?.global_pdf_header as any)?.watermark ||
      (pdfRow?.globalPdfHeader as any)?.watermark) as GlobalWatermarkValue,
    baseUrl
  );
  if (fromRow) return fromRow;

  const setting = (settingsRows || []).find(
    (s) => s.key === QUOTE_PDF_GLOBAL_WATERMARK_KEY
  );
  return withResolvedGlobalWatermark(setting?.value as GlobalWatermarkValue, baseUrl);
}

export function applyGlobalWatermarkToPdfSettingsRow<T extends Record<string, unknown>>(
  row: T,
  watermark: GlobalWatermarkValue | null,
  baseUrl?: string
): T {
  const resolved = withResolvedGlobalWatermark(watermark, baseUrl);
  if (!resolved) {
    return { ...row, globalWatermark: null, globalWatermarkFile: null };
  }
  const header =
    row.globalPdfHeader && typeof row.globalPdfHeader === "object"
      ? { ...(row.globalPdfHeader as object), watermark: resolved }
      : { watermark: resolved };
  return {
    ...row,
    globalWatermark: resolved,
    globalWatermarkFile: resolved.globalWatermarkFile || null,
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
  };

  const jsonbRow = {
    id: data.id,
    global_pdf_header: headerWithWatermark,
    global_pdf_footer: data.globalPdfFooter || data.global_pdf_footer || null,
    global_watermark: watermarkPayload,
  };

  return { scalarRow, jsonbRow, watermarkPayload };
}
